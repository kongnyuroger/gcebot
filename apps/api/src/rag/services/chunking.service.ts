import { Injectable } from '@nestjs/common';
import { get_encoding } from 'tiktoken';

export interface ChunkMetadata {
  documentId: string;
  subject: string;
  level: string;
  year?: number;
  docType: string;
  // Optional document-level fallback used when a chunk has no auto-detected
  // topic (e.g. a syllabus with no "SECTION A"/"Question N"-style markers).
  topic?: string;
}

export interface ChunkWithMetadata {
  content: string;
  tokenCount: number;
  metadata: ChunkMetadata & { topic?: string; chunkIndex: number };
}

interface ParagraphUnit {
  text: string;
  topic?: string;
}

interface AtomicUnit {
  text: string;
  tokenCount: number;
  topic?: string;
}

// Target chunk size is 500-800 tokens; the packer greedily fills each chunk up
// to TARGET_MAX_TOKENS, which naturally lands most chunks in the upper part of
// that range (only the final chunk of a document may end up smaller).
const TARGET_MAX_TOKENS = 800;
const OVERLAP_TOKENS = 65; // ~10% of the 500-800 target range's midpoint
const OVERLAP_SAFETY_CEILING = TARGET_MAX_TOKENS / 2;

// GCE papers mark structure with lines like "SECTION A", "Question 1", or an
// ALL-CAPS topic phrase ("ORGANIC CHEMISTRY OF LIFE") standing alone on a line.
const TOPIC_PATTERNS: RegExp[] = [
  /^SECTION\s+[A-Z0-9]+$/i,
  /^Question\s+\d+[a-z]?$/i,
  /^[A-Z][A-Z\s&/-]{4,}$/,
];

@Injectable()
export class ChunkingService {
  chunkText(text: string, metadata: ChunkMetadata): ChunkWithMetadata[] {
    const encoding = get_encoding('cl100k_base');

    try {
      const countTokens = (value: string) => encoding.encode(value).length;
      const paragraphs = this.splitIntoParagraphs(text);
      const atomicUnits = this.toAtomicUnits(paragraphs, countTokens);
      return this.packIntoChunks(atomicUnits, metadata);
    } finally {
      encoding.free();
    }
  }

  private splitIntoParagraphs(text: string): ParagraphUnit[] {
    const blocks = text.split(/\n{2,}/);
    const units: ParagraphUnit[] = [];
    let currentTopic: string | undefined;

    for (const block of blocks) {
      const lines = block
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      let buffer: string[] = [];
      const flush = () => {
        if (buffer.length > 0) {
          units.push({ text: buffer.join(' '), topic: currentTopic });
          buffer = [];
        }
      };

      for (const line of lines) {
        const detected = this.detectTopic(line);
        if (detected) {
          flush();
          currentTopic = detected;
        }
        buffer.push(line);
      }
      flush();
    }

    return units;
  }

  private detectTopic(line: string): string | undefined {
    return TOPIC_PATTERNS.some((pattern) => pattern.test(line)) ? line : undefined;
  }

  private toAtomicUnits(
    paragraphs: ParagraphUnit[],
    countTokens: (value: string) => number,
  ): AtomicUnit[] {
    const units: AtomicUnit[] = [];

    for (const paragraph of paragraphs) {
      const tokenCount = countTokens(paragraph.text);

      if (tokenCount <= TARGET_MAX_TOKENS) {
        units.push({ text: paragraph.text, tokenCount, topic: paragraph.topic });
        continue;
      }

      // Paragraph alone exceeds the target chunk size - fall back to sentences.
      for (const sentence of this.splitBySentences(paragraph.text)) {
        const sentenceTokens = countTokens(sentence);

        if (sentenceTokens <= TARGET_MAX_TOKENS) {
          units.push({ text: sentence, tokenCount: sentenceTokens, topic: paragraph.topic });
          continue;
        }

        // A single sentence is still too large (rare) - fall back to words.
        for (const wordGroup of this.splitByWordBudget(sentence, countTokens)) {
          units.push({
            text: wordGroup,
            tokenCount: countTokens(wordGroup),
            topic: paragraph.topic,
          });
        }
      }
    }

    return units;
  }

  private splitBySentences(text: string): string[] {
    const matches = text.match(/[^.!?]+[.!?]+(\s+|$)/g);
    if (!matches) {
      return [text];
    }
    return matches.map((sentence) => sentence.trim()).filter((sentence) => sentence.length > 0);
  }

  private splitByWordBudget(text: string, countTokens: (value: string) => number): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    const groups: string[] = [];
    let current: string[] = [];

    for (const word of words) {
      const candidate = [...current, word].join(' ');
      if (current.length > 0 && countTokens(candidate) > TARGET_MAX_TOKENS) {
        groups.push(current.join(' '));
        current = [word];
      } else {
        current.push(word);
      }
    }
    if (current.length > 0) {
      groups.push(current.join(' '));
    }
    return groups;
  }

  private packIntoChunks(units: AtomicUnit[], metadata: ChunkMetadata): ChunkWithMetadata[] {
    const chunks: ChunkWithMetadata[] = [];
    let currentUnits: AtomicUnit[] = [];
    let currentTokens = 0;
    let chunkIndex = 0;

    const finalizeChunk = (): AtomicUnit[] => {
      if (currentUnits.length === 0) {
        return [];
      }

      const content = currentUnits.map((unit) => unit.text).join('\n\n');
      const topic = currentUnits.find((unit) => unit.topic)?.topic ?? metadata.topic;

      chunks.push({
        content,
        tokenCount: currentTokens,
        metadata: { ...metadata, topic, chunkIndex: chunkIndex++ },
      });

      // Carry the trailing ~OVERLAP_TOKENS worth of units into the next chunk.
      // Capped at OVERLAP_SAFETY_CEILING so that a single outsized unit (only
      // possible via the word-boundary emergency fallback) can't alone eat most
      // of the next chunk's budget before any new content is even added.
      const tail: AtomicUnit[] = [];
      let tailTokens = 0;
      for (let i = currentUnits.length - 1; i >= 0 && tailTokens < OVERLAP_TOKENS; i--) {
        const unit = currentUnits[i];
        if (tailTokens + unit.tokenCount > OVERLAP_SAFETY_CEILING) {
          break;
        }
        tail.unshift(unit);
        tailTokens += unit.tokenCount;
      }
      return tail;
    };

    for (const unit of units) {
      if (currentUnits.length > 0 && currentTokens + unit.tokenCount > TARGET_MAX_TOKENS) {
        const tail = finalizeChunk();
        currentUnits = tail;
        currentTokens = tail.reduce((sum, u) => sum + u.tokenCount, 0);
      }

      currentUnits.push(unit);
      currentTokens += unit.tokenCount;
    }

    if (currentUnits.length > 0) {
      finalizeChunk();
    }

    return chunks;
  }
}
