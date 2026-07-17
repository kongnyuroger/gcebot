import { Injectable } from '@nestjs/common';

const MAX_MESSAGE_LENGTH = 4096;
// Reserves room for the "(NN/NN) " prefix added to each part when a response
// gets split, so content + prefix together never exceed MAX_MESSAGE_LENGTH.
const PREFIX_BUDGET = 20;
const CONTENT_BUDGET = MAX_MESSAGE_LENGTH - PREFIX_BUDGET;

@Injectable()
export class ResponseFormatterService {
  formatForWhatsApp(text: string): string[] {
    const cleaned = this.stripMarkdown(text);

    if (cleaned.length <= MAX_MESSAGE_LENGTH) {
      return [cleaned];
    }

    const parts = this.splitIntoParts(cleaned);

    if (parts.length <= 1) {
      return parts;
    }

    return parts.map((part, index) => `(${index + 1}/${parts.length}) ${part}`);
  }

  private splitIntoParts(text: string): string[] {
    const paragraphs = text.split(/\n{2,}/);
    const parts: string[] = [];
    let current = '';

    const flush = () => {
      if (current.length > 0) {
        parts.push(current);
        current = '';
      }
    };

    for (const paragraph of paragraphs) {
      const candidate = current.length > 0 ? `${current}\n\n${paragraph}` : paragraph;

      if (candidate.length <= CONTENT_BUDGET) {
        current = candidate;
        continue;
      }

      flush();

      if (paragraph.length <= CONTENT_BUDGET) {
        current = paragraph;
      } else {
        // A single paragraph alone exceeds the budget - fall back to sentences.
        parts.push(...this.splitBySentenceBudget(paragraph));
      }
    }
    flush();

    return parts;
  }

  private splitBySentenceBudget(text: string): string[] {
    const sentences = this.extractSentences(text);
    const parts: string[] = [];
    let current = '';

    for (const sentence of sentences) {
      const candidate = current + sentence;

      if (candidate.length <= CONTENT_BUDGET) {
        current = candidate;
        continue;
      }

      if (current.length > 0) {
        parts.push(current);
        current = '';
      }

      if (sentence.length <= CONTENT_BUDGET) {
        current = sentence;
      } else {
        // A single sentence is still too large (rare, e.g. no punctuation at
        // all) - hard-slice it rather than emit an oversized part.
        for (let i = 0; i < sentence.length; i += CONTENT_BUDGET) {
          parts.push(sentence.slice(i, i + CONTENT_BUDGET));
        }
      }
    }
    if (current.length > 0) {
      parts.push(current);
    }

    return parts;
  }

  private extractSentences(text: string): string[] {
    // The regex only matches text ending in ./!/? - a trailing fragment with
    // no terminal punctuation (e.g. a "[Source: ..., YYYY]" citation with
    // nothing after it, which is exactly how Rule 4 in the assembled prompt
    // has the LLM end its answers) would otherwise be silently dropped rather
    // than carried into its own part.
    const matches = text.match(/[^.!?]+[.!?]+(\s+|$)/g) ?? [];
    const remainder = text.slice(matches.join('').length);
    return remainder.length > 0 ? [...matches, remainder] : matches.length > 0 ? matches : [text];
  }

  private stripMarkdown(text: string): string {
    let result = text;

    // Fenced code blocks: strip any language tag after the opening ``` - WhatsApp
    // renders ```...``` as monospace but would show a stray language name otherwise.
    result = result.replace(/```[a-zA-Z0-9_+-]*\n?/g, '```');

    // Inline code `text` -> WhatsApp has no single-backtick format, only the
    // triple-backtick block renders as monospace.
    result = result.replace(/(?<!`)`([^`\n]+)`(?!`)/g, '```$1```');

    // Markdown links [text](url) -> plain text, keeping the URL for reference.
    result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');

    // Headers (#, ##, ...) -> WhatsApp bold, since WhatsApp has no header syntax.
    result = result.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');

    // Standard markdown bold **text** -> WhatsApp bold *text* (WhatsApp uses a
    // single asterisk, not double).
    result = result.replace(/\*\*([^*]+)\*\*/g, '*$1*');

    // Underscore italic _text_ already matches WhatsApp's own italic syntax -
    // left as-is; no transformation needed.

    return result;
  }
}
