import { SUBJECTS_BY_LEVEL } from '@gcebot/shared';
import { parseSubjectSelections } from './subjects.constants';

describe('parseSubjectSelections', () => {
  const oLevel = SUBJECTS_BY_LEVEL.O_LEVEL;

  it('matches comma-separated numbers to subjects by 1-based index', () => {
    const result = parseSubjectSelections('1,3,5', oLevel);
    expect(result).toEqual({
      matched: ['Biology', 'Mathematics', 'English Language'],
      unmatched: [],
    });
  });

  it('matches subject names case-insensitively', () => {
    const result = parseSubjectSelections('biology, PHYSICS', oLevel);
    expect(result).toEqual({ matched: ['Biology', 'Physics'], unmatched: [] });
  });

  it('handles a mix of numbers and names in one reply', () => {
    const result = parseSubjectSelections('1, Physics, 7', oLevel);
    expect(result).toEqual({ matched: ['Biology', 'Physics', 'Economics'], unmatched: [] });
  });

  it('tolerates whitespace around tokens', () => {
    const result = parseSubjectSelections('  1 ,  3  ,5  ', oLevel);
    expect(result.matched).toEqual(['Biology', 'Mathematics', 'English Language']);
  });

  it('splits a space-separated run of pure numbers when there are no commas at all', () => {
    const result = parseSubjectSelections('1 3 5', oLevel);
    expect(result.matched).toEqual(['Biology', 'Mathematics', 'English Language']);
  });

  it('does not split a multi-word subject name on its internal spaces', () => {
    const result = parseSubjectSelections('English Language', oLevel);
    expect(result).toEqual({ matched: ['English Language'], unmatched: [] });
  });

  it('reports out-of-range numbers and unrecognized names as unmatched, without dropping valid tokens', () => {
    const result = parseSubjectSelections('1, 99, banana', oLevel);
    expect(result).toEqual({ matched: ['Biology'], unmatched: ['99', 'banana'] });
  });

  it('deduplicates the same subject picked twice in one reply', () => {
    const result = parseSubjectSelections('1, Biology, 1', oLevel);
    expect(result).toEqual({ matched: ['Biology'], unmatched: [] });
  });

  it('rejects index 0 and negative-looking tokens as unmatched', () => {
    const result = parseSubjectSelections('0, -1', oLevel);
    expect(result.matched).toEqual([]);
    expect(result.unmatched).toContain('0');
  });

  it('returns everything unmatched for pure gibberish', () => {
    const result = parseSubjectSelections('what are my options?', oLevel);
    expect(result.matched).toEqual([]);
    expect(result.unmatched.length).toBeGreaterThan(0);
  });
});
