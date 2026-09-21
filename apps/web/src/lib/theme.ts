import { useCallback, useEffect, useState } from 'react';

/**
 * Theme handling (PRD 57): dark, light, system. The resolved theme is applied
 * as `data-theme` on <html>; "system" removes the attribute so the CSS media
 * query decides. Persisted in localStorage (WebUI-owned presentation state,
 * PRD 51).
 */

export type ThemeSetting = 'light' | 'dark' | 'system';
const STORAGE_KEY = 'hermes-webui-theme';
const ORDER: readonly ThemeSetting[] = ['system', 'light', 'dark'];

export function isThemeSetting(value: unknown): value is ThemeSetting {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function nextTheme(current: ThemeSetting): ThemeSetting {
  return ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]!;
}

export function readStoredTheme(storage: Pick<Storage, 'getItem'> = localStorage): ThemeSetting {
  try {
    const stored = storage.getItem(STORAGE_KEY);
    return isThemeSetting(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme: ThemeSetting): void {
  if (theme === 'system') {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
}

/** Guarded for jsdom, which lacks matchMedia. */
export function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function useTheme(): { theme: ThemeSetting; cycle: () => void } {
  const [theme, setTheme] = useState<ThemeSetting>(() => readStoredTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const cycle = useCallback(() => {
    setTheme((current) => {
      const next = nextTheme(current);
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // private mode: keep runtime-only theme
      }
      return next;
    });
  }, []);

  return { theme, cycle };
}

export function resolvedThemeLabel(theme: ThemeSetting): 'Light' | 'Dark' | 'System' {
  if (theme === 'light') return 'Light';
  if (theme === 'dark') return 'Dark';
  return systemPrefersDark() ? 'Dark' : 'Light';
}
