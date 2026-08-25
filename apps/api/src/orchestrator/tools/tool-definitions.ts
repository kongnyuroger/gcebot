import { LLMTool } from '../../rag/services/llm.service';

// Single source of truth for tool name strings, shared with ToolExecutorService
// (step 4) - avoids the two drifting apart via a typo in a bare string literal.
export const TOOL_NAMES = {
  ANSWER_QUESTION: 'answer_question',
  GET_PRACTICE_QUESTION: 'get_practice_question',
  GRADE_ANSWER: 'grade_answer',
  START_MOCK_EXAM: 'start_mock_exam',
  SHOW_PROGRESS: 'show_progress',
  UPDATE_PROFILE: 'update_profile',
  START_SUBSCRIPTION: 'start_subscription',
} as const;

export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES];

// Deviates from the original spec in two places, both deliberate and tied to
// how the underlying services actually work (see feature/agent-orchestrator
// planning discussion):
//   - get_practice_question has no `difficulty` param - nothing in the
//     ingested data model (EmbeddingChunk metadata) carries a difficulty
//     rating, so a param with nothing to map to would just be a schema that
//     lies to the model. `year` and `type` are real, queryable fields instead.
//   - grade_answer takes no `question_id`. Grading has never looked a
//     question up by id at grading time - it reads whichever question is
//     currently active in the student's session (set when
//     get_practice_question last ran), exactly like the existing
//     PracticeModeHandler.handleAnswer flow. The model already has the
//     question in its own conversation context, but the STORED session
//     question is the source of truth for grading, not model-supplied text -
//     this also guards against grading the wrong question if the
//     conversation drifted.
export const ORCHESTRATOR_TOOLS: LLMTool[] = [
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.ANSWER_QUESTION,
      description:
        "Explain a concept or answer a factual/academic question using the student's course " +
        'material (grounded in their textbooks, syllabuses, and past papers). Use this for ' +
        'explanatory or informational questions - "what is...", "explain...", "why does...", ' +
        '"how do I...". This is NOT for serving a practice question to attempt (use ' +
        'get_practice_question for that) and NOT for grading an answer the student already gave ' +
        '(use grade_answer for that).',
      parameters: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: "The student's question, in their own words.",
          },
          subject: {
            type: 'string',
            description:
              'The GCE subject this question is about, e.g. "Biology", "Physics". Omit if not ' +
              "clearly stated - it will be inferred automatically from the student's session or " +
              'registered subjects.',
          },
        },
        required: ['question'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.GET_PRACTICE_QUESTION,
      description:
        'Serve one real, past GCE exam question for the student to attempt. Use this when the ' +
        'student asks to practice, wants a question to try, or wants to test themselves - not ' +
        'for explaining a concept.',
      parameters: {
        type: 'object',
        properties: {
          subject: {
            type: 'string',
            description:
              'The subject to practice, e.g. "Biology". Ask the student only if genuinely ' +
              'unclear which of their registered subjects they mean.',
          },
          topic: {
            type: 'string',
            description: 'A specific topic within the subject, e.g. "Osmosis". Omit for any topic.',
          },
          year: {
            type: 'integer',
            description:
              'A specific exam year the student asked for, e.g. 2023. Omit for any year.',
          },
          type: {
            type: 'string',
            enum: ['MCQ', 'STRUCTURED'],
            description:
              'Multiple-choice ("MCQ") or structured/essay ("STRUCTURED"). Omit if the student ' +
              'has no preference.',
          },
        },
        required: ['subject'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.GRADE_ANSWER,
      description:
        "Grade the student's answer to whichever practice question was most recently served via " +
        'get_practice_question, and give feedback. Use this only when the student is replying ' +
        'with an attempted answer to that question - there must be an active, ungraded question ' +
        'for this to work.',
      parameters: {
        type: 'object',
        properties: {
          studentAnswer: {
            type: 'string',
            description:
              "The student's answer exactly as given - a single letter (A/B/C/D) for " +
              'multiple-choice, or their full written answer for structured/essay questions.',
          },
        },
        required: ['studentAnswer'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.START_MOCK_EXAM,
      description:
        'Begin a full timed mock exam for one subject, simulating real exam conditions. This is ' +
        'a PREMIUM/FAMILY-tier feature, gated server-side - ALWAYS call this when the student ' +
        'asks, even if you think they might be on a lower tier; never guess or tell them they ' +
        "need to upgrade on your own. The tool's result will tell you definitively whether it " +
        'started or whether they need to upgrade, and you should relay that warmly as a next ' +
        'step, never as a failure. Use only when the student explicitly asks for a mock exam or ' +
        'timed test, not for a single practice question.',
      parameters: {
        type: 'object',
        properties: {
          subject: {
            type: 'string',
            description: 'The subject to sit the mock exam for, e.g. "Chemistry".',
          },
        },
        required: ['subject'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.SHOW_PROGRESS,
      description:
        "Look up the student's practice history and stats: overall accuracy, current streak, " +
        "and weakest topics. Use this when the student asks how they're doing, wants to see " +
        'their progress, or asks what they should focus on studying next.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.UPDATE_PROFILE,
      description:
        "Update the student's stored profile: exam level, registered subjects, or preferred " +
        "language. Use this when the student says they're changing level, adding or dropping a " +
        'subject, or wants to switch between English and French. Only include the fields that ' +
        'are actually changing.',
      parameters: {
        type: 'object',
        properties: {
          level: {
            type: 'string',
            enum: ['O_LEVEL', 'A_LEVEL'],
            description: 'The exam level the student is now preparing for.',
          },
          subjects: {
            type: 'array',
            items: { type: 'string' },
            description:
              "The student's full updated subject list - this REPLACES the existing list " +
              'entirely, so include every subject they should have, not just the new one(s).',
          },
          language: {
            type: 'string',
            enum: ['EN', 'FR'],
            description: 'Preferred language for the bot to reply in.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.START_SUBSCRIPTION,
      description:
        "Begin a mobile money payment to upgrade the student's subscription tier. Use this only " +
        'when the student explicitly asks to subscribe, upgrade, or pay.',
      parameters: {
        type: 'object',
        properties: {
          tier: {
            type: 'string',
            enum: ['BASIC', 'PREMIUM', 'FAMILY'],
            description: 'The tier the student wants to subscribe to.',
          },
        },
        required: ['tier'],
      },
    },
  },
];
