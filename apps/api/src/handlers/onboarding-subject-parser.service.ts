import { Injectable } from '@nestjs/common';
import type { Subject } from '@gcebot/shared';
import { Language, Level } from '../../generated/prisma';
import { LlmService, LLMTool } from '../rag/services/llm.service';
import { SUBJECTS_BY_LEVEL } from './subjects.constants';

export type OnboardingSubjectParseResult =
  | { matched: true; subjects: string[] }
  // clarification is the model's own natural-language follow-up question,
  // in the student's language - null when the model gave no usable text
  // (either it produced no content at all, an OpenAI-protocol impossibility
  // per generateWithTools's own guarantee, or it called the tool but every
  // returned name was outside the valid list). Callers substitute their own
  // localized generic fallback (i18n, not this LLM-facing service) for null.
  | { matched: false; clarification: string | null };

const LEVEL_LABELS: Record<Level, string> = {
  O_LEVEL: 'O-Level',
  A_LEVEL: 'A-Level',
};

const LANGUAGE_LABELS: Record<Language, string> = {
  EN: 'English',
  FR: 'French',
};

const SET_SUBJECTS_TOOL: LLMTool = {
  type: 'function',
  function: {
    name: 'set_subjects',
    description:
      "Record the student's subjects once you can confidently map their message to one or more " +
      'of the valid subjects listed in the system prompt.',
    parameters: {
      type: 'object',
      properties: {
        subjects: {
          type: 'array',
          items: { type: 'string' },
          description:
            "The student's complete intended subject list, using the EXACT names from the valid " +
            'list only.',
        },
      },
      required: ['subjects'],
    },
  },
};

// Handles free-form subject phrasing ("doing bio, chem and add maths") that
// OnboardingHandler's fast regex path (subjects.constants.ts's
// parseSubjectSelections - exact numbers/names only) can't confidently
// resolve. Kept as its own small tool-calling call rather than folded into
// the main orchestrator: onboarding runs before a real user profile exists,
// with different validation needs (subjects must come from exactly this
// level's list, and the result always REPLACES rather than being one of
// several possible actions), so a dedicated one-tool prompt is simpler than
// stretching the general-purpose orchestrator to cover it.
@Injectable()
export class OnboardingSubjectParserService {
  constructor(private readonly llmService: LlmService) {}

  async parseFreeform(
    text: string,
    level: Level,
    language: Language,
    alreadySelected: string[],
  ): Promise<OnboardingSubjectParseResult> {
    const validSubjects: Subject[] = SUBJECTS_BY_LEVEL[level];
    const validNames = validSubjects.map((subject) => subject.name);

    const response = await this.llmService.generateWithTools(
      [
        {
          role: 'system',
          content: this.buildSystemPrompt(level, language, validNames, alreadySelected),
        },
        { role: 'user', content: text },
      ],
      [SET_SUBJECTS_TOOL],
      { complexity: 'simple' },
    );

    const call = response.toolCalls[0];
    if (!call) {
      return { matched: false, clarification: response.message.content };
    }

    const requested = this.extractRequestedSubjects(call.arguments);
    const valid = requested.filter((name) => validNames.includes(name));

    if (valid.length === 0) {
      return { matched: false, clarification: null };
    }

    return { matched: true, subjects: valid };
  }

  private buildSystemPrompt(
    level: Level,
    language: Language,
    validNames: string[],
    alreadySelected: string[],
  ): string {
    const levelLabel = LEVEL_LABELS[level] ?? level;
    const languageLabel = LANGUAGE_LABELS[language] ?? language;
    const alreadySelectedLine =
      alreadySelected.length > 0
        ? `\nThe student has already selected: ${alreadySelected.join(', ')}. Their new message may add to, remove from, or fully replace this - use your judgment on what they mean, then call set_subjects with their COMPLETE final list (not just what changed).`
        : '';

    return `You are helping a Cameroonian GCE ${levelLabel} student choose their exam subjects on WhatsApp. Reply in ${languageLabel}.

Valid subjects for this level (use these EXACT names only): ${validNames.join(', ')}.
${alreadySelectedLine}

Call set_subjects once you can confidently map their message to one or more of the valid subjects above - they may use abbreviations, misspellings, or casual local phrasing, so use your best judgment on which real subject they mean, but only ever return names from the valid list above. If their message doesn't contain any recognizable subject from that list, do NOT call the tool - reply in plain, friendly text asking them to name their subjects instead.`;
  }

  private extractRequestedSubjects(rawArguments: string): string[] {
    try {
      const parsed: unknown = JSON.parse(rawArguments);
      const subjects =
        typeof parsed === 'object' && parsed !== null
          ? (parsed as Record<string, unknown>).subjects
          : undefined;
      return Array.isArray(subjects)
        ? subjects.filter((s): s is string => typeof s === 'string')
        : [];
    } catch {
      return [];
    }
  }
}
