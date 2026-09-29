import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  ACCENT_OPTIONS,
  THEME_OPTIONS,
  applyAccent,
  applyTheme,
  isAccentSetting,
  isThemeSetting,
  nextTheme,
  readStoredAccent,
  readStoredTheme,
  resolvedThemeLabel,
  useAccent,
  useTheme,
} from './theme';

/** Storage stub whose getItem throws, simulating private mode. */
const throwingStorage = {
  getItem: () => {
    throw new Error('storage blocked');
  },
};

afterEach(() => {
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-accent');
  localStorage.clear();
});

describe('theme settings validation', () => {
  it('accepts every documented theme and rejects anything else', () => {
    for (const theme of ['light', 'dark', 'true-black', 'system']) {
      expect(isThemeSetting(theme)).toBe(true);
    }
    expect(isThemeSetting('amoled')).toBe(false);
    expect(isThemeSetting(42)).toBe(false);
  });

  it('reads a stored true-black theme and falls back to system', () => {
    localStorage.setItem('hermes-webui-theme', 'true-black');
    expect(readStoredTheme()).toBe('true-black');

    localStorage.setItem('hermes-webui-theme', 'garbage');
    expect(readStoredTheme()).toBe('system');
  });

  it('falls back to system when storage is unavailable', () => {
    expect(readStoredTheme(throwingStorage)).toBe('system');
  });

  it('cycles through all four settings and wraps around', () => {
    expect(nextTheme('system')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('true-black');
    expect(nextTheme('true-black')).toBe('system');
  });
});

describe('accent settings validation', () => {
  it('accepts every documented accent and rejects anything else', () => {
    for (const accent of ['indigo', 'blue', 'green', 'amber', 'red', 'violet']) {
      expect(isAccentSetting(accent)).toBe(true);
    }
    expect(isAccentSetting('gold')).toBe(false);
  });

  it('reads a stored accent and falls back to indigo', () => {
    localStorage.setItem('hermes-webui-accent', 'green');
    expect(readStoredAccent()).toBe('green');

    localStorage.setItem('hermes-webui-accent', 'garbage');
    expect(readStoredAccent()).toBe('indigo');
  });

  it('falls back to indigo when storage is unavailable', () => {
    expect(readStoredAccent(throwingStorage)).toBe('indigo');
  });
});

describe('applying theme and accent to <html>', () => {
  it('sets data-theme for explicit themes and removes it for system', () => {
    applyTheme('true-black');
    expect(document.documentElement.dataset.theme).toBe('true-black');

    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');

    applyTheme('system');
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('sets data-accent for non-default accents and removes it for indigo', () => {
    applyAccent('green');
    expect(document.documentElement.dataset.accent).toBe('green');

    applyAccent('indigo');
    expect(document.documentElement.dataset.accent).toBeUndefined();
  });
});

describe('labels and option tables', () => {
  it('labels true-black as Dark (no light reading ever)', () => {
    expect(resolvedThemeLabel('light')).toBe('Light');
    expect(resolvedThemeLabel('dark')).toBe('Dark');
    expect(resolvedThemeLabel('true-black')).toBe('Dark');
    // jsdom has no matchMedia: system resolves to the light branch.
    expect(resolvedThemeLabel('system')).toBe('Light');
  });

  it('offers the true-black theme and all six accents with swatches', () => {
    expect(THEME_OPTIONS.map((option) => option.id)).toContain('true-black');
    expect(ACCENT_OPTIONS).toHaveLength(6);
    expect(ACCENT_OPTIONS.every((option) => option.swatch.startsWith('#'))).toBe(true);
  });
});

describe('cross-component sync', () => {
  it('propagates a theme change from one useTheme consumer to another', () => {
    const first = renderHook(() => useTheme());
    const second = renderHook(() => useTheme());

    act(() => first.result.current.setTheme('true-black'));

    expect(second.result.current.theme).toBe('true-black');
  });

  it('keeps cycle() consistent with changes made by another consumer', () => {
    const first = renderHook(() => useTheme());
    const second = renderHook(() => useTheme());

    act(() => first.result.current.setTheme('true-black'));
    act(() => second.result.current.cycle());

    // Cycle continues from the synced value, not from a stale snapshot.
    expect(first.result.current.theme).toBe('system');
    expect(second.result.current.theme).toBe('system');
  });

  it('propagates an accent change between useAccent consumers', () => {
    const first = renderHook(() => useAccent());
    const second = renderHook(() => useAccent());

    act(() => first.result.current.setAccent('green'));

    expect(second.result.current.accent).toBe('green');
  });
});
