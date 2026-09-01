import {
  parseOptions,
  normalizeStudentAnswer,
  extractQuestionNumber,
  extractAnswerKeyLetter,
  extractCorrectAnswerLetter,
  extractSchemeExplanation,
} from './mcq-grading.util';

describe('parseOptions', () => {
  it('parses options on their own line (content that preserves line breaks)', () => {
    const options = parseOptions(
      'Question 1. Solve for x: 2x + 5 = 15\nA. x=5\nB. x=10\nC. x=3\nD. x=7',
    );

    expect(options).toEqual({ A: 'x=5', B: 'x=10', C: 'x=3', D: 'x=7' });
  });

  it('parses options from flat single-line text with no punctuation after the letter', () => {
    const options = parseOptions('9. Decoded instruction is stored in: A MDR. B IR. C PC. D MAR.');

    expect(options).toEqual({ A: 'MDR', B: 'IR', C: 'PC', D: 'MAR.' });
  });

  it('does not mistake a capital letter inside an ordinary word for an option marker', () => {
    // ". D" here is the start of "Decoded", not an option - a naive
    // "preceded by period+space" check without a word-boundary requirement
    // would swallow this as option D and lose the real options entirely.
    const options = parseOptions('9. Decoded instruction is stored in: A MDR. B IR. C PC. D MAR.');

    expect(options.D).toBe('MAR.');
    expect(Object.keys(options)).toHaveLength(4);
  });

  it('still finds B/C/D when the first option runs off the stem with no punctuation at all', () => {
    // A real ingested formatting style with no separator before option A -
    // deliberately not handled (a bare space is too common in ordinary
    // English to use as a boundary), but B/C/D alone are enough for
    // PastQuestionService's MCQ_OPTION_PATTERN to classify this correctly.
    const options = parseOptions(
      '43. Viruses are an issue of network A reliability. B feasibility. C security. D performance.',
    );

    expect(options.B).toBe('feasibility');
    expect(options.C).toBe('security');
    expect(options.D).toBe('performance.');
  });

  it('returns an empty object for a structured/essay question with no options', () => {
    const options = parseOptions('5. Explain the process of osmosis in detail.');

    expect(options).toEqual({});
  });
});

describe('normalizeStudentAnswer', () => {
  const options = { A: 'MDR', B: 'IR', C: 'PC', D: 'MAR.' };

  it('recognizes a bare letter answer regardless of whether options were parsed', () => {
    expect(normalizeStudentAnswer('A', {})).toBe('A');
    expect(normalizeStudentAnswer('b', options)).toBe('B');
  });

  it("matches the student's answer against option text when they type the option instead of the letter", () => {
    expect(normalizeStudentAnswer('MDR', options)).toBe('A');
    expect(normalizeStudentAnswer('mar', options)).toBe('D');
  });

  it('returns null for an answer that matches neither a letter nor any option text', () => {
    expect(normalizeStudentAnswer('banana', options)).toBeNull();
  });
});

describe('extractQuestionNumber', () => {
  it('reads the number off a "Question N" prefix', () => {
    expect(extractQuestionNumber('Question 9. Decoded instruction is stored in: ...')).toBe('9');
  });

  it('reads the number off a bare "N." prefix', () => {
    expect(extractQuestionNumber('9. Decoded instruction is stored in: ...')).toBe('9');
  });

  it('returns null when the text has no leading question number', () => {
    expect(extractQuestionNumber('Decoded instruction is stored in: ...')).toBeNull();
  });
});

describe('extractAnswerKeyLetter', () => {
  // A real ingested GCE marking scheme is exactly this shape: one compact
  // table for the whole paper rather than prose per question.
  const answerKeyTable =
    'GCE A/L 0795 COMPUTER SCIENCE 2018 PAPER 1 ANSWER GUIDE ' +
    '1. B 11. D 21. A 31. B 41. D 2. D 12. D 22. A 32. D 42. D ' +
    '9. D 10. D 20. C 30. D 40. D 50. C';

  it('looks up the letter for a specific question number within the table', () => {
    expect(extractAnswerKeyLetter(answerKeyTable, '9')).toBe('D');
    expect(extractAnswerKeyLetter(answerKeyTable, '21')).toBe('A');
    expect(extractAnswerKeyLetter(answerKeyTable, '50')).toBe('C');
  });

  it('returns null for a question number not present in the table', () => {
    expect(extractAnswerKeyLetter(answerKeyTable, '99')).toBeNull();
  });
});

describe('extractCorrectAnswerLetter', () => {
  it('still prefers prose phrasing ("Correct answer: X") when present, unchanged', () => {
    expect(extractCorrectAnswerLetter('Correct answer: B. Because...')).toBe('B');
  });

  it('falls back to the answer-key table when no prose pattern matches and a question number is given', () => {
    const answerKeyTable = 'ANSWER GUIDE 1. B 9. D 21. A';

    expect(extractCorrectAnswerLetter(answerKeyTable, '9')).toBe('D');
  });

  it('returns null when neither prose nor a question number/table entry is available', () => {
    expect(extractCorrectAnswerLetter('ANSWER GUIDE 1. B 9. D 21. A')).toBeNull();
    expect(extractCorrectAnswerLetter('ANSWER GUIDE 1. B 9. D 21. A', '99')).toBeNull();
  });
});

describe('extractSchemeExplanation', () => {
  it('strips the leading question prefix from real per-question prose, unchanged', () => {
    expect(extractSchemeExplanation('Question 3. Award 1 mark for CO2, 1 for O2.')).toBe(
      'Award 1 mark for CO2, 1 for O2.',
    );
  });

  it('falls back to a generic message for a compact answer-key table instead of dumping it raw', () => {
    // Confirmed live: without this, a correct-answer message for a real
    // ingested marking scheme showed the entire "GCE A/L 0795 COMPUTER
    // SCIENCE 2018 PAPER 1 ANSWER GUIDE 1. B 11. D 21. A ..." table verbatim.
    const answerKeyTable =
      'GCE A/L 0795 COMPUTER SCIENCE 2018 PAPER 1 ANSWER GUIDE ' +
      '1. B 11. D 21. A 31. B 41. D 2. D 12. D 22. A 32. D 42. D ' +
      '9. D 10. D 20. C 30. D 40. D 50. C';

    expect(extractSchemeExplanation(answerKeyTable)).toBe('See the marking scheme for details.');
  });

  it('returns the generic message when there is nothing left after stripping the prefix', () => {
    expect(extractSchemeExplanation('Question 3.')).toBe('See the marking scheme for details.');
  });
});
