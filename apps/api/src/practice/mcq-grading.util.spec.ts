import { parseOptions, normalizeStudentAnswer } from './mcq-grading.util';

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
