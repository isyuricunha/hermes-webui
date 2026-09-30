import { useEffect, useState } from 'react';
import { Bell, BellOff, Check, Download, Keyboard } from 'lucide-react';
import { useTheme, useAccent, useChatStyle, THEME_OPTIONS, ACCENT_OPTIONS, CHAT_STYLE_OPTIONS } from '../../lib/theme';
import { notificationsSupported, requestNotificationPermission } from '../../lib/notify';
import { OPEN_SHORTCUTS_EVENT } from '../../lib/events';
import { toast } from '../../lib/toast';
import { Card, Section } from '../../components/ui';
import { SettingsPage } from './SettingsLayout';

const PREVIEW: Record<string, { canvas: string; card: string; line: string }> = {
  'true-black': { canvas: '#000000', card: '#0b0b0a', line: '#1a1a18' },
  dark: { canvas: '#262624', card: '#2b2b29', line: '#3b3b38' },
  light: { canvas: '#faf9f5', card: '#ffffff', line: '#ece9e1' },
  system: { canvas: 'linear-gradient(135deg,#000 50%,#faf9f5 50%)', card: 'transparent', line: 'transparent' },
};

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

/**
 * Settings > Appearance: theme and accent (applied instantly via data-theme
 * / data-accent on <html>), background notifications and app install.
 */
export function AppearancePage() {
  const { theme, setTheme } = useTheme();
  const { accent, setAccent } = useAccent();
  const { chatStyle, setChatStyle } = useChatStyle();
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    notificationsSupported() ? Notification.permission : 'unsupported',
  );
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as InstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const standalone = typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches;

  return (
    <SettingsPage title="Appearance" description="How this app looks and behaves on this device.">
      <Section title="Theme">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {THEME_OPTIONS.map((option) => {
            const preview = PREVIEW[option.id] ?? PREVIEW['true-black']!;
            const selected = theme === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setTheme(option.id)}
                aria-pressed={selected}
                aria-label={`${option.label}: ${option.hint}`}
                className={[
                  'yu-card yu-lift overflow-hidden rounded-2xl text-left',
                  selected ? '!border-accent/70 ring-1 ring-accent/50' : '',
                ].join(' ')}
              >
                <span className="block h-16 p-2.5" style={{ background: preview.canvas }}>
                  <span className="block h-full rounded-lg" style={{ background: preview.card, boxShadow: `inset 0 0 0 0.5px ${preview.line}` }} />
                </span>
                <span className="flex items-center gap-2 px-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium text-text-primary">{option.label}</span>
                    <span className="block truncate text-[11px] text-text-tertiary">{option.hint}</span>
                  </span>
                  {selected ? <Check className="size-4 shrink-0 text-accent" aria-hidden /> : null}
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section
        title="Chat and code"
        description="How conversations and code blocks look. YuCode is a terminal-style skin; the rest of the app keeps the theme above."
      >
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {CHAT_STYLE_OPTIONS.map((option) => {
            const selected = chatStyle === option.id;
            const yucode = option.id === 'yucode';
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setChatStyle(option.id)}
                aria-pressed={selected}
                aria-label={`${option.label}: ${option.hint}`}
                className={[
                  'yu-card yu-lift overflow-hidden rounded-2xl text-left',
                  selected ? '!border-accent/70 ring-1 ring-accent/50' : '',
                ].join(' ')}
              >
                <span
                  aria-hidden
                  className="block space-y-1.5 px-3 py-3 text-[11px] leading-snug"
                  style={
                    yucode
                      ? { background: '#0c0c0c', fontFamily: 'var(--font-mono)', color: '#cccccc' }
                      : { background: 'var(--color-background)', color: 'var(--color-text-primary)' }
                  }
                >
                  <span className="flex justify-end">
                    <span
                      className="rounded-md px-2 py-1"
                      style={yucode ? { background: '#373737', color: '#ffffff' } : { background: 'var(--color-chip)' }}
                    >
                      {yucode ? '❯ fix the build' : 'Fix the build'}
                    </span>
                  </span>
                  <span className="block">
                    {yucode ? <span style={{ color: '#d77757' }}>● </span> : null}
                    Done. The{' '}
                    <span style={{ color: yucode ? '#d77757' : 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}>tsconfig</span> path
                    was wrong.
                  </span>
                </span>
                <span className="flex items-center gap-2 border-t border-border-subtle px-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium text-text-primary">{option.label}</span>
                    <span className="block truncate text-[11px] text-text-tertiary">
                      {option.hint}
                      {option.credit !== undefined ? ` · ${option.credit}` : ''}
                    </span>
                  </span>
                  {selected ? <Check className="size-4 shrink-0 text-accent" aria-hidden /> : null}
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Accent" description="Buttons, focus and highlights. Charts keep their own validated color.">
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
                'flex h-11 items-center gap-2 rounded-xl px-3 text-[13px] transition-colors',
                accent === option.id ? 'bg-chip text-text-primary shadow-[var(--yu-highlight)]' : 'text-text-secondary hover:bg-surface-input',
              ].join(' ')}
            >
              <span className="size-4 rounded-full" style={{ backgroundColor: option.swatch }} />
              {option.label.replace(' (default)', '')}
            </button>
          ))}
        </div>
      </Section>

      <Section title="On this device">
        <Card>
          <div className="flex items-center gap-3 border-b border-border-subtle px-4 py-3.5">
            {permission === 'granted' ? (
              <Bell className="size-4 shrink-0 text-success" aria-hidden />
            ) : (
              <BellOff className="size-4 shrink-0 text-text-tertiary" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm text-text-primary">Notify when a reply finishes</p>
              <p className="text-xs text-text-tertiary">
                {permission === 'unsupported'
                  ? 'Needs HTTPS (or localhost) and a browser with notifications.'
                  : permission === 'granted'
                    ? 'On. You get a notification when Hermes finishes while this tab is in the background.'
                    : permission === 'denied'
                      ? 'Blocked in the browser settings for this site.'
                      : 'Off. The tab title still shows a counter.'}
              </p>
            </div>
            {permission === 'default' ? (
              <button
                type="button"
                className="yu-btn yu-btn-tonal h-8 px-3 text-xs"
                onClick={() =>
                  void requestNotificationPermission().then((result) => {
                    setPermission(result);
                    if (result === 'granted') toast('Notifications on.', 'success');
                  })
                }
              >
                Turn on
              </button>
            ) : null}
          </div>
          <div className="flex items-center gap-3 border-b border-border-subtle px-4 py-3.5">
            <Download className="size-4 shrink-0 text-text-tertiary" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-text-primary">Install as an app</p>
              <p className="text-xs text-text-tertiary">
                {standalone
                  ? 'Installed. You are using the app.'
                  : installEvent !== null
                    ? 'Adds Hermes to your home screen or dock, full screen, no browser bar.'
                    : 'Use your browser menu: “Install app” or “Add to Home Screen” (needs HTTPS).'}
              </p>
            </div>
            {installEvent !== null && !standalone ? (
              <button
                type="button"
                className="yu-btn yu-btn-tonal h-8 px-3 text-xs"
                onClick={() => void installEvent.prompt().then(() => setInstallEvent(null))}
              >
                Install
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event(OPEN_SHORTCUTS_EVENT))}
            className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-input"
          >
            <Keyboard className="size-4 shrink-0 text-text-tertiary" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-text-primary">Keyboard shortcuts</span>
              <span className="block text-xs text-text-tertiary">Press ? anywhere to see them.</span>
            </span>
          </button>
        </Card>
      </Section>
    </SettingsPage>
  );
}
