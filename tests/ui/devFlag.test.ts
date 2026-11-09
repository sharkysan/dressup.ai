import { describe, expect, it } from 'vitest';
import { isAnalysisRoute, isDevPanelEnabled } from '../../src/ui/dev/devFlag';

const at = (hash: string) => ({ hash }) as Location;

describe('dev flags', () => {
  it('turns the dev panel on for #dev and for the #analysis developer page', () => {
    expect(isDevPanelEnabled(at('#dev'), false)).toBe(true);
    expect(isDevPanelEnabled(at('#analysis'), false)).toBe(true);
    expect(isDevPanelEnabled(at(''), false)).toBe(false);
    expect(isDevPanelEnabled(at('#other'), false)).toBe(false);
  });

  it('is always on in dev builds', () => {
    expect(isDevPanelEnabled(at(''), true)).toBe(true);
  });

  it('routes only #analysis to the analysis page', () => {
    expect(isAnalysisRoute(at('#analysis'))).toBe(true);
    expect(isAnalysisRoute(at('#dev'))).toBe(false);
  });
});
