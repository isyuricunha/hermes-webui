import { useCallback, useEffect, useState } from 'react';

/**
 * Theme handling (YuTheme 2.0): AMOLED (true-black, the default), Graphite
 * (dark), Light and System. The resolved theme is applied as `data-theme` on <html>;
 * "system" removes the attribute so the CSS media query decides. Accent
 * presets apply `data-accent` the same way. Both persist in localStorage
 * (WebUI-owned presentation state, PRD 51).
 */

export type ThemeSetting = 'light' | 'dark' | 'true-black' | 'system';
export type AccentSetting = 'gold' | 'blue' | 'green' | 'violet' | 'coral';

const THEME_KEY = 'hermes-webui-theme';
const ACCENT_KEY = 'hermes-webui-accent';
const THEME_ORDER: readonly ThemeSetting[] = ['system', 'light', 'dark', 'true-black'];
const ACCENTS: readonly AccentSetting[] = ['gold', 'blue', 'green', 'violet', 'coral'];
const DEFAULT_THEME: ThemeSetting = 'true-black';
const DEFAULT_ACCENT: AccentSetting = 'gold';

// Multiple components hold useTheme/useAccent state (sidebar cycle button,
// Appearance page). localStorage 'storage' events do not fire in the writing
// tab, so every persist announces itself and every hook re-reads.
const THEME_CHANGE_EVENT = 'hermes-webui:theme-changed';
const ACCENT_CHANGE_EVENT = 'hermes-webui:accent-changed';

function persistTheme(next: ThemeSetting): void {
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // private mode: keep runtime-only theme
  }
  try {
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  } catch {
    // non-browser environment
  }
}

function persistAccent(next: AccentSetting): void {
  try {
    localStorage.setItem(ACCENT_KEY, next);
  } catch {
    // private mode: keep runtime-only accent
  }
  try {
    window.dispatchEvent(new Event(ACCENT_CHANGE_EVENT));
  } catch {
    // non-browser environment
  }
}

export function isThemeSetting(value: unknown): value is ThemeSetting {
  return value === 'light' || value === 'dark' || value === 'true-black' || value === 'system';
}

export function isAccentSetting(value: unknown): value is AccentSetting {
  return typeof value === 'string' && (ACCENTS as readonly string[]).includes(value);
}

export function nextTheme(current: ThemeSetting): ThemeSetting {
  return THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length]!;
}

export function readStoredTheme(storage: Pick<Storage, 'getItem'> = localStorage): ThemeSetting {
  try {
    const stored = storage.getItem(THEME_KEY);
    return isThemeSetting(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function readStoredAccent(storage: Pick<Storage, 'getItem'> = localStorage): AccentSetting {
  try {
    const stored = storage.getItem(ACCENT_KEY);
    return isAccentSetting(stored) ? stored : DEFAULT_ACCENT;
  } catch {
    return DEFAULT_ACCENT;
  }
}

export function applyTheme(theme: ThemeSetting): void {
  if (theme === 'system') {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
}

export function applyAccent(accent: AccentSetting): void {
  if (accent === DEFAULT_ACCENT) {
    delete document.documentElement.dataset.accent;
  } else {
    document.documentElement.dataset.accent = accent;
  }
}

/** Guarded for jsdom, which lacks matchMedia. */
export function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function useTheme(): {
  theme: ThemeSetting;
  setTheme: (theme: ThemeSetting) => void;
  cycle: () => void;
} {
  const [theme, setThemeState] = useState<ThemeSetting>(() => readStoredTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const sync = () => setThemeState(readStoredTheme());
    window.addEventListener(THEME_CHANGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const setTheme = useCallback((next: ThemeSetting) => {
    setThemeState(next);
    persistTheme(next);
  }, []);

  const cycle = useCallback(() => {
    setThemeState((current) => {
      const next = nextTheme(current);
      persistTheme(next);
      return next;
    });
  }, []);

  return { theme, setTheme, cycle };
}

/** Accent state: persisted, applied as data-accent on <html>. */
export function useAccent(): { accent: AccentSetting; setAccent: (accent: AccentSetting) => void } {
  const [accent, setAccentState] = useState<AccentSetting>(() => readStoredAccent());

  useEffect(() => {
    applyAccent(accent);
  }, [accent]);

  useEffect(() => {
    const sync = () => setAccentState(readStoredAccent());
    window.addEventListener(ACCENT_CHANGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(ACCENT_CHANGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const setAccent = useCallback((next: AccentSetting) => {
    setAccentState(next);
    persistAccent(next);
  }, []);

  return { accent, setAccent };
}

export const ACCENT_OPTIONS: readonly { id: AccentSetting; label: string; swatch: string }[] = [
  { id: 'gold', label: 'Gold (default)', swatch: '#d6a84f' },
  { id: 'blue', label: 'Sky', swatch: '#64d2ff' },
  { id: 'green', label: 'Green', swatch: '#31d158' },
  { id: 'violet', label: 'Violet', swatch: '#bf5af2' },
  { id: 'coral', label: 'Coral', swatch: '#ff6961' },
];

export const THEME_OPTIONS: readonly { id: ThemeSetting; label: string; hint: string }[] = [
  { id: 'true-black', label: 'AMOLED', hint: 'Pure #000 canvas (default)' },
  { id: 'dark', label: 'Graphite', hint: 'Same palette on #262624' },
  { id: 'light', label: 'Light', hint: 'Warm daylight surfaces' },
  { id: 'system', label: 'System', hint: 'AMOLED or Light, by OS' },
];

export function resolvedThemeLabel(theme: ThemeSetting): 'Light' | 'Dark' | 'System' {
  if (theme === 'light') return 'Light';
  if (theme === 'dark' || theme === 'true-black') return 'Dark';
  return systemPrefersDark() ? 'Dark' : 'Light';
}
