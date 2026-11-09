// @vitest-environment node
import { assignLineups } from '../../../tools/lineup/assign';

const ids = ['ana', 'ben', 'cho', 'dev', 'eli'];

test('one lineup per id with 3 distinct options including itself, answer pointing at it', () => {
  const lineups = assignLineups(ids, 7);
  expect(lineups).toHaveLength(5);
  for (const l of lineups) {
    expect(l.options).toHaveLength(3);
    expect(new Set(l.options).size).toBe(3);
    expect(l.options[l.answer]).toBe(l.photo);
  }
});

test('deterministic for a seed, different for another', () => {
  expect(assignLineups(ids, 7)).toEqual(assignLineups(ids, 7));
  expect(JSON.stringify(assignLineups(ids, 7))).not.toBe(JSON.stringify(assignLineups(ids, 8)));
});

test('requires at least 3 ids', () => {
  expect(() => assignLineups(['a', 'b'], 1)).toThrow(/3/);
});
