import { describe, expect, it } from 'vitest';
import { actionSummary, formatToolPayload } from './cards';
import { deriveTitle, isMeaningfulTitle, rememberDerivedTitle, derivedTitle } from '../../lib/sessionTitles';

describe('tool payload formatting', () => {
  it('pretty-prints JSON payloads', () => {
    const raw = '{"a":1,"b":[2,3]}';
    expect(formatToolPayload(raw)).toBe('{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}');
  });

  it('normalizes escaped newlines in single-line payloads', () => {
    expect(formatToolPayload('line1\\nline2\\nline3')).toBe('line1\nline2\nline3');
  });

  it('does not corrupt already-multiline text containing \\n literals', () => {
    const text = 'real break\nthen a literal \\n stays';
    expect(formatToolPayload(text)).toBe(text);
  });

  it('keeps non-JSON text untouched', () => {
    expect(formatToolPayload('plain output')).toBe('plain output');
  });

  it('summarizes the first meaningful line and truncates long ones', () => {
    expect(actionSummary(undefined, 'fallback')).toBe('fallback');
    expect(actionSummary('second\nfirst', 'fallback')).toBe('second');
    const long = 'x'.repeat(200);
    expect(actionSummary(long, 'fallback')).toBe(`${'x'.repeat(93)}…`);
  });
});

describe('model picker option normalization (operator UI shows real ids)', () => {
  it('keeps real provider/model pairs from string options', async () => {
    const { normalizeOptions } = await import('./ModelPicker');
    const options = normalizeOptions({ options: ['example/model-large', 'provider-b/vendor/model-x'] });
    expect(options).toContainEqual({ provider: 'example', model: 'model-large' });
    expect(options.every((option) => option.provider !== '' && option.model !== '')).toBe(true);
  });

  it('keeps object options with provider/model fields', async () => {
    const { normalizeOptions } = await import('./ModelPicker');
    const options = normalizeOptions({
      options: [{ provider: 'nous', model: 'vendor/model-x' }],
    });
    expect(options).toEqual([{ provider: 'nous', model: 'vendor/model-x' }]);
  });
});

describe('derived session titles', () => {
  it('rejects slash commands and noise as titles', () => {
    expect(isMeaningfulTitle('/model')).toBe(false);
    expect(isMeaningfulTitle('x')).toBe(false);
    expect(isMeaningfulTitle('Fix the login bug')).toBe(true);
  });

  it('collapses whitespace and bounds length', () => {
    expect(deriveTitle('  a   b\t c ')).toBe('a b c');
    const long = 'word '.repeat(40);
    expect(deriveTitle(long).endsWith('...')).toBe(true);
    expect(deriveTitle(long).length).toBeLessThanOrEqual(64);
  });

  it('remembers only the first derived title per session', () => {
    rememberDerivedTitle('sess-title-1', 'first question');
    rememberDerivedTitle('sess-title-1', 'second question');
    expect(derivedTitle('sess-title-1')).toBe('first question');
  });

  it('never uses a raw api_* id as the fallback display title', () => {
    // The sidebar falls back to "New chat"; the id only lives in tooltips.
    rememberDerivedTitle('sess-title-2', '/status');
    expect(derivedTitle('sess-title-2')).toBeNull();
  });
});
