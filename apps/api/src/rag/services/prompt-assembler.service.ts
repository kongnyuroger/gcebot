import { Injectable } from '@nestjs/common';
import { SearchResult } from './vector-search.service';

export interface PromptUserContext {
  level: string;
  subject: string;
  language: string;
}

export interface AssembledPrompt {
  systemPrompt: string;
  userMessage: string;
}

const LANGUAGE_LABELS: Record<string, string> = {
  EN: 'English',
  FR: 'French',
};

const DOC_TYPE_LABELS: Record<string, string> = {
  SYLLABUS: 'Syllabus',
  PAST_PAPER: 'Past Paper',
  TEXTBOOK: 'Textbook',
  MARKING_SCHEME: 'Marking Scheme',
};

const LEVEL_LABELS: Record<string, string> = {
  O_LEVEL: 'O-Level',
  A_LEVEL: 'A-Level',
};

@Injectable()
export class PromptAssemblerService {
  assemblePrompt(
    query: string,
    results: SearchResult[],
    userContext: PromptUserContext,
  ): AssembledPrompt {
    const languageLabel = LANGUAGE_LABELS[userContext.language] ?? userContext.language;
    const levelLabel = LEVEL_LABELS[userContext.level] ?? userContext.level;
    const contextBlock = results
      .map((result, index) => `[${index + 1}] ${result.content} ${this.formatCitation(result)}`)
      .join('\n');

    const systemPrompt = `You are GCEBot, an expert and patient tutor helping Cameroonian students prepare for the GCE ${levelLabel} ${userContext.subject} examination.

RULES:
1. Answer ONLY using the provided context below. If the answer is not in the context, say: 'I don't have that information in my study materials. Try rephrasing your question or ask about a different topic.'
2. Explain concepts clearly, as if teaching a student who is seeing this for the first time.
3. Use examples from the Cameroonian context where possible.
4. At the end of your answer, cite your source: [Source: {docType}, {year}]
5. Respond in ${languageLabel}.
6. For mathematical expressions, write them in plain text (e.g., 'x squared' not 'x²').
7. Keep answers concise but complete — students are reading on a phone screen.

CONTEXT:
---
${contextBlock}
---`;

    return { systemPrompt, userMessage: query };
  }

  private formatCitation(result: SearchResult): string {
    const docTypeLabel = DOC_TYPE_LABELS[result.docType] ?? result.docType;
    return result.year ? `[Source: ${docTypeLabel}, ${result.year}]` : `[Source: ${docTypeLabel}]`;
  }
}
