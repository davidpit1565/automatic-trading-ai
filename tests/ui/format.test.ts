import { describe, expect, it } from 'vitest';
import { truncate } from '../../src/ui/format';

describe('truncate', () => {
  it('returns short text unchanged, with no ellipsis appended', () => {
    expect(truncate('short alert', 140)).toBe('short alert');
  });

  it('cuts long text to max length and appends an ellipsis', () => {
    const long = 'x'.repeat(150);
    const result = truncate(long, 140);
    expect(result).toBe(`${'x'.repeat(140)}…`);
  });

  it('leaves text exactly at the limit unchanged (not truncated)', () => {
    const exact = 'x'.repeat(140);
    expect(truncate(exact, 140)).toBe(exact);
  });
});
