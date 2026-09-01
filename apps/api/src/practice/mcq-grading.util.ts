// Shared MCQ-grading helpers, used by both PracticeModeHandler (single-question
// practice) and MockGradingService (full-paper exam grading) - extracted here
// once a second real caller needed the identical logic, rather than
// duplicated across both.

// Strips the leading "Question N." / "Paper N." boundary markers off a raw
// chunk before display, since delivery already renders its own "Question X"
// header - keeping it in the body would be redundant.
export const QUESTION_PREFIX_PATTERN =
  /^\s*(?:question\s*\d+|\d+[.)])\s*\.?\s*(?:paper\s*\d+\.?\s*)?/i;

// Matches an option like "A. x=5" or "B) 10" on its own line (content that
// preserves line breaks), or, for the flat single-line PDF extraction real
// ingested past papers actually have ("A MDR. B IR. C PC. D MAR." - no
// newlines, and often no ".)" after the letter at all), preceded by a
// colon/period/question-mark + a space. \b around the letter is required:
// without it, a lone capital letter right after ". " also matches the start
// of an ordinary word (". Decoded" would otherwise register a "D" option
// and swallow the real ones). The lookahead cuts each option's captured
// text off at the next option boundary (or end of string/newline) rather
// than running to end-of-line, since flat text has no line to stop at.
// Deliberately does not try to catch a first option separated from the stem
// by nothing but a bare space (e.g. "...network A reliability.") - that
// boundary is far too common in ordinary English to use safely - but B/C/D
// are reliably punctuation-preceded either way. Verified against real
// ingested content across every formatting style actually seen.
const OPTION_LINE_PATTERN =
  /(?:^|\n|[:.?]\s)\s*\b([A-D])\b[.)]?\s*([^\n]+?)(?=\s*[.?!]\s+\b[A-D]\b[.)]?\s|\s*$|\n)/g;

// A bare letter answer, optionally wrapped in punctuation: "A", "a)", "(A)", "A.".
const BARE_LETTER_PATTERN = /^\(?([A-D])\)?\.?$/i;

// Best-effort extraction of the correct letter from marking scheme text -
// real scheme phrasing is unknown until content is actually ingested, so this
// covers the common phrasings ("Correct answer: A", "Answer: B", "Ans: C").
const CORRECT_ANSWER_PATTERNS = [
  /correct\s+answer\s*(?:is|:)?\s*\(?([A-D])\)?/i,
  /\banswer\s*(?:is|:)?\s*\(?([A-D])\)?/i,
  /\bans\s*(?:is|:)?\s*\(?([A-D])\)?/i,
];

// Mirrors QUESTION_START_PATTERN in past-question.service.ts (kept as its
// own copy rather than a cross-module import - both are small, single-use
// regexes serving different purposes in their own file). Used to recover a
// question's number from its own text at grading time, since
// SessionContext only carries the question's text, not its number.
const QUESTION_NUMBER_PATTERN = /^\s*(?:question\s*(\d+)|(\d+)[.)])/i;

// Some marking schemes are ingested as a single compact answer-key table -
// "1. B 11. D 21. A ... 50. C" - rather than one scheme entry per question
// with prose like "Correct answer: B" (confirmed live: a real ingested GCE
// Computer Science marking scheme is exactly this shape). Neither
// CORRECT_ANSWER_PATTERNS above nor QUESTION_START_PATTERN-style per-chunk
// matching can ever find anything in this format, since it isn't
// question-specific prose and doesn't start with the target question's own
// number. This scans the whole chunk for every "N. <letter>" entry and
// looks up one specific question's letter within it.
const ANSWER_KEY_ENTRY_PATTERN = /\b(\d{1,3})\.\s*([A-D])\b/g;

export function extractQuestionNumber(questionText: string): string | null {
  const match = questionText.match(QUESTION_NUMBER_PATTERN);
  return match ? (match[1] ?? match[2]) : null;
}

// Exported separately (not folded silently into extractCorrectAnswerLetter)
// so callers that only need "does this chunk have an answer-key entry for
// question N at all" - PastQuestionService.findMarkingSchemeChunkId, which
// is choosing WHICH chunk to associate, not yet extracting a letter from it -
// don't have to care about the prose-pattern path too.
export function extractAnswerKeyLetter(
  schemeContent: string,
  questionNumber: string,
): string | null {
  ANSWER_KEY_ENTRY_PATTERN.lastIndex = 0;
  for (const match of schemeContent.matchAll(ANSWER_KEY_ENTRY_PATTERN)) {
    if (match[1] === questionNumber) {
      return match[2];
    }
  }
  return null;
}

export function parseOptions(questionText: string): Record<string, string> {
  const options: Record<string, string> = {};
  for (const match of questionText.matchAll(OPTION_LINE_PATTERN)) {
    options[match[1].toUpperCase()] = match[2].trim();
  }
  return options;
}

export function normalizeStudentAnswer(
  rawAnswer: string,
  options: Record<string, string>,
): string | null {
  const bareLetterMatch = rawAnswer.match(BARE_LETTER_PATTERN);
  if (bareLetterMatch) {
    return bareLetterMatch[1].toUpperCase();
  }

  const lowerAnswer = rawAnswer.toLowerCase();
  for (const [letter, text] of Object.entries(options)) {
    const lowerText = text.toLowerCase();
    if (
      lowerText === lowerAnswer ||
      lowerText.includes(lowerAnswer) ||
      lowerAnswer.includes(lowerText)
    ) {
      return letter;
    }
  }

  return null;
}

// questionNumber is optional so existing prose-scheme callers/tests that
// never pass it keep working unchanged - it's only consulted as a fallback
// for the answer-key-table format, which needs to know WHICH entry to read.
export function extractCorrectAnswerLetter(
  schemeContent: string,
  questionNumber?: string,
): string | null {
  for (const pattern of CORRECT_ANSWER_PATTERNS) {
    const match = schemeContent.match(pattern);
    if (match) {
      return match[1].toUpperCase();
    }
  }
  return questionNumber ? extractAnswerKeyLetter(schemeContent, questionNumber) : null;
}

// A real per-question scheme chunk has at most one or two incidental
// "N. <letter>"-shaped substrings; an answer-key table has dozens (one per
// question in the paper). Used to recognize when there is no real prose to
// show as an "explanation" at all - without this, a correct-answer message
// for a table-format scheme would show the ENTIRE raw table (confirmed
// live: "✅ Correct! GCE A/L 0795 COMPUTER SCIENCE 2018 PAPER 1 ANSWER
// GUIDE 1. B 11. D 21. A ...") instead of a clean message.
const ANSWER_KEY_TABLE_MIN_ENTRIES = 5;

function looksLikeAnswerKeyTable(content: string): boolean {
  const entries = content.match(ANSWER_KEY_ENTRY_PATTERN) ?? [];
  return entries.length >= ANSWER_KEY_TABLE_MIN_ENTRIES;
}

export function extractSchemeExplanation(schemeContent: string): string {
  if (looksLikeAnswerKeyTable(schemeContent)) {
    return 'See the marking scheme for details.';
  }
  const stripped = schemeContent.replace(QUESTION_PREFIX_PATTERN, '').trim();
  return stripped.length > 0 ? stripped : 'See the marking scheme for details.';
}
