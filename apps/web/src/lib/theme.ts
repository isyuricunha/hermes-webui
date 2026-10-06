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

// --- Chat and code style -------------------------------------------------------

/**
 * How the chat and code blocks look, on top of the app theme: YuTheme (the
 * default) or YuCode, the terminal-style skin Yuri Cunha made for Hermes
 * (warm terracotta accent on near-black, monospace transcript). Applied as
 * `data-chat-style` on <html>; the CSS scopes it to the chat surface.
 */
export type ChatStyle = 'yutheme' | 'yucode';

const CHAT_STYLE_KEY = 'hermes-webui-chat-style';
const CHAT_STYLE_EVENT = 'hermes-webui:chat-style-changed';

export const CHAT_STYLE_OPTIONS: readonly { id: ChatStyle; label: string; hint: string; credit?: string }[] = [
  { id: 'yutheme', label: 'YuTheme', hint: 'Follows the app theme (default)' },
  { id: 'yucode', label: 'YuCode', hint: 'Terminal-style chat and code', credit: 'Created by Yuri Cunha' },
];

export function readStoredChatStyle(storage: Pick<Storage, 'getItem'> = localStorage): ChatStyle {
  try {
    return storage.getItem(CHAT_STYLE_KEY) === 'yucode' ? 'yucode' : 'yutheme';
  } catch {
    return 'yutheme';
  }
}

export function applyChatStyle(style: ChatStyle): void {
  if (style === 'yutheme') delete document.documentElement.dataset.chatStyle;
  else document.documentElement.dataset.chatStyle = style;
}

export function useChatStyle(): { chatStyle: ChatStyle; setChatStyle: (style: ChatStyle) => void } {
  const [chatStyle, setState] = useState<ChatStyle>(() => readStoredChatStyle());

  useEffect(() => {
    applyChatStyle(chatStyle);
  }, [chatStyle]);

  useEffect(() => {
    const sync = () => setState(readStoredChatStyle());
    window.addEventListener(CHAT_STYLE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(CHAT_STYLE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const setChatStyle = useCallback((next: ChatStyle) => {
    setState(next);
    try {
      localStorage.setItem(CHAT_STYLE_KEY, next);
    } catch {
      // private mode: runtime only
    }
    window.dispatchEvent(new Event(CHAT_STYLE_EVENT));
  }, []);

  return { chatStyle, setChatStyle };
}

export type ChatDensity = 'compact' | 'default' | 'comfortable';
const TYPE_SIZE_KEY = 'hermes.chatFontSize';
const TYPE_DENSITY_KEY = 'hermes.chatDensity';

export function applyChatType(size: number, density: ChatDensity): void {
  const root = document.documentElement;
  root.style.setProperty('--chat-font-size', `${size}px`);
  root.style.setProperty('--chat-leading', density === 'compact' ? '1.35' : density === 'comfortable' ? '1.7' : '1.55');
}

export function useChatType(): {
  size: number;
  density: ChatDensity;
  setSize: (size: number) => void;
  setDensity: (density: ChatDensity) => void;
} {
  const [size, setSizeState] = useState(() => {
    const raw = Number(localStorage.getItem(TYPE_SIZE_KEY));
    return raw >= 13 && raw <= 18 ? raw : 15;
  });
  const [density, setDensityState] = useState<ChatDensity>(() => {
    const raw = localStorage.getItem(TYPE_DENSITY_KEY);
    return raw === 'compact' || raw === 'comfortable' ? raw : 'default';
  });
  useEffect(() => {
    applyChatType(size, density);
  }, [size, density]);
  return {
    size,
    density,
    setSize: (next) => {
      const value = Math.min(18, Math.max(13, next));
      localStorage.setItem(TYPE_SIZE_KEY, String(value));
      setSizeState(value);
    },
    setDensity: (next) => {
      localStorage.setItem(TYPE_DENSITY_KEY, next);
      setDensityState(next);
    },
  };
}

export type TextFont = 'geist' | 'inter' | 'atkinson' | 'plex';
export type CodeFont = 'geist-mono' | 'jetbrains' | 'fira' | 'plex-mono';
const TEXT_FONT_KEY = 'hermes.textFont';
const CODE_FONT_KEY = 'hermes.codeFont';
const TEXT_STACK: Record<TextFont, string> = {
  geist: "'Geist Variable', 'Geist', ui-sans-serif, system-ui, sans-serif",
  inter: "'Inter Variable', 'Inter', ui-sans-serif, system-ui, sans-serif",
  atkinson: "'Atkinson Hyperlegible', ui-sans-serif, system-ui, sans-serif",
  plex: "'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif",
};
const CODE_STACK: Record<CodeFont, string> = {
  'geist-mono': "'Geist Mono', ui-monospace, monospace",
  jetbrains: "'JetBrains Mono', ui-monospace, monospace",
  fira: "'Fira Code', ui-monospace, monospace",
  'plex-mono': "'IBM Plex Mono', ui-monospace, monospace",
};

export function applyChatFonts(text: TextFont, code: CodeFont): void {
  const root = document.documentElement;
  root.style.setProperty('--font-sans', TEXT_STACK[text]);
  root.style.setProperty('--font-mono', CODE_STACK[code]);
}

export function useChatFonts(): {
  textFont: TextFont;
  codeFont: CodeFont;
  setTextFont: (font: TextFont) => void;
  setCodeFont: (font: CodeFont) => void;
} {
  const [textFont, setTextState] = useState<TextFont>(() => {
    const raw = localStorage.getItem(TEXT_FONT_KEY);
    return raw === 'inter' || raw === 'atkinson' || raw === 'plex' ? raw : 'geist';
  });
  const [codeFont, setCodeState] = useState<CodeFont>(() => {
    const raw = localStorage.getItem(CODE_FONT_KEY);
    return raw === 'jetbrains' || raw === 'fira' || raw === 'plex-mono' ? raw : 'geist-mono';
  });
  useEffect(() => {
    applyChatFonts(textFont, codeFont);
  }, [textFont, codeFont]);
  return {
    textFont,
    codeFont,
    setTextFont: (next) => {
      localStorage.setItem(TEXT_FONT_KEY, next);
      setTextState(next);
      applyChatFonts(next, codeFont);
    },
    setCodeFont: (next) => {
      localStorage.setItem(CODE_FONT_KEY, next);
      setCodeState(next);
      applyChatFonts(textFont, next);
    },
  };
}
