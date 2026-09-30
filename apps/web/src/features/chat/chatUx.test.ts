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

describe('model catalog normalization (operator UI shows real ids)', () => {
  it('reads the Hermes 0.21 providers shape (the chat picker showed "unavailable" on it)', async () => {
    const { normalizeCatalog, pickableProviders } = await import('../../lib/modelCatalog');
    const providers = normalizeCatalog({
      providers: [
        { slug: 'provider-b', name: 'Provider B', authenticated: false, models: ['vendor/model-x'] },
        { slug: 'custom:example', name: 'Example Provider', is_current: true, models: ['model-large', { id: 'model-small', name: 'Model Small' }] },
        { slug: 'nous', name: 'Nous', models: [] },
      ],
    });
    const pickable = pickableProviders(providers);
    expect(pickable.map((p) => p.slug)).toEqual(['custom:example']);
    expect(pickable[0]!.models).toEqual([
      { id: 'model-large', label: 'model-large' },
      { id: 'model-small', label: 'Model Small' },
    ]);
  });

  it('still reads the older flat options list, keeping slashes inside model ids', async () => {
    const { normalizeCatalog } = await import('../../lib/modelCatalog');
    const providers = normalizeCatalog({ options: ['example/model-large', 'provider-b/vendor/model-x', { provider: 'nous', model: 'hermes-5' }] });
    expect(providers.find((p) => p.slug === 'provider-b')?.models).toEqual([{ id: 'vendor/model-x', label: 'vendor/model-x' }]);
    expect(providers.find((p) => p.slug === 'nous')?.models[0]?.id).toBe('hermes-5');
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
