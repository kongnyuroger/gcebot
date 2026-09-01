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

export function extractCorrectAnswerLetter(schemeContent: string): string | null {
  for (const pattern of CORRECT_ANSWER_PATTERNS) {
    const match = schemeContent.match(pattern);
    if (match) {
      return match[1].toUpperCase();
    }
  }
  return null;
}

export function extractSchemeExplanation(schemeContent: string): string {
  const stripped = schemeContent.replace(QUESTION_PREFIX_PATTERN, '').trim();
  return stripped.length > 0 ? stripped : 'See the marking scheme for details.';
}
