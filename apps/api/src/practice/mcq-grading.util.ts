// Shared MCQ-grading helpers, used by both PracticeModeHandler (single-question
// practice) and MockGradingService (full-paper exam grading) - extracted here
// once a second real caller needed the identical logic, rather than
// duplicated across both.

// Strips the leading "Question N." / "Paper N." boundary markers off a raw
// chunk before display, since delivery already renders its own "Question X"
// header - keeping it in the body would be redundant.
export const QUESTION_PREFIX_PATTERN =
  /^\s*(?:question\s*\d+|\d+[.)])\s*\.?\s*(?:paper\s*\d+\.?\s*)?/i;

// Matches option lines like "A. x=5" or "B) 10" at the start of a line.
const OPTION_LINE_PATTERN = /(?:^|\n)\s*([A-D])[.)]\s*([^\n]+)/g;

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
