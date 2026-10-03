import { useTranslation } from 'react-i18next';
import { Monitor, Moon, Sun, SunMoon } from 'lucide-react';
import { THEME_OPTIONS, resolvedThemeLabel, useTheme } from '../../lib/theme';

const ICONS = {
  'true-black': Moon,
  dark: SunMoon,
  light: Sun,
  system: Monitor,
} as const;

/** Cycles the theme (PRD 57). Lives in the sidebar footer. */
export function ThemeToggle() {
  const { t } = useTranslation();
  const { theme, cycle } = useTheme();
  const Icon = ICONS[theme];
  const label = THEME_OPTIONS.find((option) => option.id === theme)?.label ?? theme;
  return (
    <button
      type="button"
      onClick={cycle}
      className="yu-btn yu-btn-ghost size-8"
      title={t('sessions.themeTitle', { label, resolved: resolvedThemeLabel(theme) })}
      aria-label={t('sessions.themeAria', { label })}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}
