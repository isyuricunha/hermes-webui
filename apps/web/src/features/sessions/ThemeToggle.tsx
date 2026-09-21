import { resolvedThemeLabel, useTheme } from '../../lib/theme';

/** Cycles system -> light -> dark (PRD 57). Lives in the sidebar footer. */
export function ThemeToggle() {
  const { theme, cycle } = useTheme();
  return (
    <button
      type="button"
      onClick={cycle}
      className="rounded-md border border-border-subtle px-2 py-1 text-xs text-text-secondary hover:bg-surface-elevated hover:text-text-primary"
      title={`Theme: ${theme} (resolved ${resolvedThemeLabel(theme)})`}
      aria-label={`Theme: ${theme}. Click to change.`}
    >
      Theme: {resolvedThemeLabel(theme)}
    </button>
  );
}
