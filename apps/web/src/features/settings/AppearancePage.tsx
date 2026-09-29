import { useTheme, useAccent, THEME_OPTIONS, ACCENT_OPTIONS } from '../../lib/theme';
import { SettingsPage } from './SettingsLayout';

/**
 * Settings > Appearance (Phase 2): theme (Light/Dark/True Black/System) and
 * accent presets. Persisted WebUI-side; applies instantly via data-theme /
 * data-accent on <html>.
 */
export function AppearancePage() {
  const { theme, setTheme } = useTheme();
  const { accent, setAccent } = useAccent();

  return (
    <SettingsPage title="Appearance">
      <section className="mb-8">
        <p className="mb-2 text-xs font-semibold tracking-wide text-text-secondary uppercase">Theme</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setTheme(option.id)}
              aria-pressed={theme === option.id}
              className={[
                'rounded-xl border p-3 text-left',
                option.id === 'true-black' ? 'bg-black text-white' : 'bg-surface-elevated',
                theme === option.id
                  ? 'border-accent ring-1 ring-accent'
                  : 'border-border-subtle hover:border-accent',
              ].join(' ')}
            >
              <span className="block text-sm font-medium">{option.label}</span>
              <span className="block text-[11px] opacity-60">{option.hint}</span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-text-secondary">
          Current setting: {theme}. The Theme button in the sidebar cycles through these.
        </p>
      </section>

      <section>
        <p className="mb-2 text-xs font-semibold tracking-wide text-text-secondary uppercase">Accent color</p>
        <div className="flex flex-wrap gap-2">
          {ACCENT_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setAccent(option.id)}
              aria-label={`Accent ${option.label}`}
              title={option.label}
              aria-pressed={accent === option.id}
              className={[
                'flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border-2 transition-colors',
                accent === option.id ? 'border-text-primary' : 'border-transparent hover:border-border-subtle',
              ].join(' ')}
            >
              <span className="size-6 rounded-lg" style={{ backgroundColor: option.swatch }} />
            </button>
          ))}
        </div>
      </section>
    </SettingsPage>
  );
}
