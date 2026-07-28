/**
 * `initialsFor`'s own doc comment claims it distinguishes PEPE/PENGU/PENDLE —
 * the previous 3-character cap for anything over 4 characters made PENGU and
 * PENDLE both collapse to "PEN", directly contradicting that claim.
 */
import { describe, expect, it } from 'vitest';
import { initialsFor } from '../../src/ui/coinLogo';

describe('initialsFor', () => {
  it('distinguishes PEPE, PENGU and PENDLE from each other', () => {
    const pepe = initialsFor('PEPE');
    const pengu = initialsFor('PENGU');
    const pendle = initialsFor('PENDLE');
    expect(new Set([pepe, pengu, pendle]).size).toBe(3);
  });

  it('never returns more than 4 characters', () => {
    expect(initialsFor('PENDLE').length).toBeLessThanOrEqual(4);
  });

  it('returns the whole code unchanged when it is 4 characters or shorter', () => {
    expect(initialsFor('BTC')).toBe('BTC');
    expect(initialsFor('PEPE')).toBe('PEPE');
  });
});
