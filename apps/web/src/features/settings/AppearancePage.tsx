import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, BellOff, Check, Download, Keyboard, Languages } from 'lucide-react';
import {
  useTheme,
  useAccent,
  useChatStyle,
  useChatType,
  THEME_OPTIONS,
  ACCENT_OPTIONS,
  CHAT_STYLE_OPTIONS,
} from '../../lib/theme';
import { notificationsSupported, requestNotificationPermission } from '../../lib/notify';
import { OPEN_SHORTCUTS_EVENT } from '../../lib/events';
import { toast } from '../../lib/toast';
import { Card, Section } from '../../components/ui';
import { SettingsPage } from './SettingsLayout';
import { LANGUAGES, resolveLanguage, setLanguage } from '../../i18n';

const PREVIEW: Record<string, { canvas: string; card: string; line: string }> = {
  'true-black': { canvas: '#000000', card: '#0b0b0a', line: '#1a1a18' },
  dark: { canvas: '#262624', card: '#2b2b29', line: '#3b3b38' },
  light: { canvas: '#faf9f5', card: '#ffffff', line: '#ece9e1' },
  system: {
    canvas: 'linear-gradient(135deg,#000 50%,#faf9f5 50%)',
    card: 'transparent',
    line: 'transparent',
  },
};

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

/**
 * Settings > Appearance: theme, accent, UI language, background notifications
 * and app install. Theme and accent apply instantly via data-theme /
 * data-accent on <html>; language applies instantly via i18next.
 */
export function AppearancePage() {
  const type = useChatType();
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const { accent, setAccent } = useAccent();
  const { chatStyle, setChatStyle } = useChatStyle();
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    notificationsSupported() ? Notification.permission : 'unsupported',
  );
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const activeLanguage = i18n.language.startsWith('pt') ? 'pt-BR' : resolveLanguage();

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as InstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const standalone =
    typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches;
  const themeLabel = (id: string) =>
    t(`settings.appearance.themeOption.${id.replace('-', '_')}.label`);
  const themeHint = (id: string) =>
    t(`settings.appearance.themeOption.${id.replace('-', '_')}.hint`);
  const accentLabel = (id: string) => t(`settings.appearance.accentOption.${id}`);
  const chatStyleLabel = (id: string) => t(`settings.appearance.chatStyleOption.${id}.label`);
  const chatStyleHint = (id: string) => t(`settings.appearance.chatStyleOption.${id}.hint`);

  return (
    <SettingsPage
      title={t('settings.appearance.title')}
      description={t('settings.appearance.description')}
    >
      <Section title={t('settings.appearance.theme')}>
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
                aria-label={`${themeLabel(option.id)}: ${themeHint(option.id)}`}
                className={[
                  'yu-card yu-lift overflow-hidden rounded-2xl text-left',
                  selected ? '!border-accent/70 ring-1 ring-accent/50' : '',
                ].join(' ')}
              >
                <span className="block h-16 p-2.5" style={{ background: preview.canvas }}>
                  <span
                    className="block h-full rounded-lg"
                    style={{
                      background: preview.card,
                      boxShadow: `inset 0 0 0 0.5px ${preview.line}`,
                    }}
                  />
                </span>
                <span className="flex items-center gap-2 px-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium text-text-primary">
                      {themeLabel(option.id)}
                    </span>
                    <span className="block truncate text-[11px] text-text-tertiary">
                      {themeHint(option.id)}
                    </span>
                  </span>
                  {selected ? <Check className="size-4 shrink-0 text-accent" aria-hidden /> : null}
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section
        title={t('settings.appearance.chatAndCode')}
        description={t('settings.appearance.chatAndCodeDesc')}
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
                aria-label={`${chatStyleLabel(option.id)}: ${chatStyleHint(option.id)}`}
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
                      : {
                          background: 'var(--color-background)',
                          color: 'var(--color-text-primary)',
                        }
                  }
                >
                  <span className="flex justify-end">
                    <span
                      className="rounded-md px-2 py-1"
                      style={
                        yucode
                          ? { background: '#373737', color: '#ffffff' }
                          : { background: 'var(--color-chip)' }
                      }
                    >
                      {yucode ? '❯ fix the build' : 'Fix the build'}
                    </span>
                  </span>
                  <span className="block">
                    {yucode ? <span style={{ color: '#d77757' }}>● </span> : null}
                    Done. The{' '}
                    <span
                      style={{
                        color: yucode ? '#d77757' : 'var(--color-accent)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      tsconfig
                    </span>{' '}
                    path was wrong.
                  </span>
                </span>
                <span className="flex items-center gap-2 border-t border-border-subtle px-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium text-text-primary">
                      {chatStyleLabel(option.id)}
                    </span>
                    <span className="block truncate text-[11px] text-text-tertiary">
                      {chatStyleHint(option.id)}
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

      <Section title={t('settings.appearance.typography')} description={t('settings.appearance.typographyDesc')}>
        <label className="flex items-center justify-between gap-3 text-[13px] text-text-primary">
          <span>{t('settings.appearance.messageSize')}</span>
          <input
            type="range"
            min={13}
            max={18}
            value={type.size}
            onChange={(event) => type.setSize(Number(event.target.value))}
            aria-label={t('settings.appearance.messageSize')}
          />
        </label>
        <div className="mt-3 flex gap-2">
          {(['compact', 'default', 'comfortable'] as const).map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={type.density === id}
              onClick={() => type.setDensity(id)}
              className={['yu-card rounded-xl px-3 py-2 text-[12px]', type.density === id ? 'ring-1 ring-accent/50' : ''].join(' ')}
            >
              {t(`settings.appearance.density.${id}`)}
            </button>
          ))}
        </div>
        <p className="mt-3 rounded-xl bg-chip px-3 py-2 text-text-primary" style={{ fontSize: 'var(--chat-font-size, 15px)', lineHeight: 'var(--chat-leading, 1.55)' }}>
          {t('settings.appearance.typePreview')}
        </p>
      </Section>

      <Section
        title={t('settings.appearance.accent')}
        description={t('settings.appearance.accentDesc')}
      >
        <div className="flex flex-wrap gap-2">
          {ACCENT_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setAccent(option.id)}
              aria-label={`${t('settings.appearance.accent')} ${accentLabel(option.id)}`}
              title={accentLabel(option.id)}
              aria-pressed={accent === option.id}
              className={[
                'flex h-11 items-center gap-2 rounded-xl px-3 text-[13px] transition-colors',
                accent === option.id
                  ? 'bg-chip text-text-primary shadow-[var(--yu-highlight)]'
                  : 'text-text-secondary hover:bg-surface-input',
              ].join(' ')}
            >
              <span className="size-4 rounded-full" style={{ backgroundColor: option.swatch }} />
              {accentLabel(option.id).replace(' (default)', '')}
            </button>
          ))}
        </div>
      </Section>

      <Section title={t('common.language')} description={t('common.languageHint')}>
        <div className="flex flex-wrap gap-2">
          {LANGUAGES.map((option) => (
            <button
              key={option.code}
              type="button"
              onClick={() => setLanguage(option.code)}
              aria-pressed={activeLanguage === option.code}
              className={[
                'flex h-11 items-center gap-2 rounded-xl px-3 text-[13px] transition-colors',
                activeLanguage === option.code
                  ? 'bg-chip text-text-primary shadow-[var(--yu-highlight)]'
                  : 'text-text-secondary hover:bg-surface-input',
              ].join(' ')}
            >
              {activeLanguage === option.code ? (
                <Check className="size-4 shrink-0 text-accent" aria-hidden />
              ) : (
                <Languages className="size-4 shrink-0 text-text-tertiary" aria-hidden />
              )}
              {option.label}
            </button>
          ))}
        </div>
      </Section>

      <Section title={t('settings.appearance.onThisDevice')}>
        <Card>
          <div className="flex items-center gap-3 border-b border-border-subtle px-4 py-3.5">
            {permission === 'granted' ? (
              <Bell className="size-4 shrink-0 text-success" aria-hidden />
            ) : (
              <BellOff className="size-4 shrink-0 text-text-tertiary" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm text-text-primary">{t('settings.appearance.notifyReply')}</p>
              <p className="text-xs text-text-tertiary">
                {permission === 'unsupported'
                  ? t('settings.appearance.notifyUnsupported')
                  : permission === 'granted'
                    ? t('settings.appearance.notifyGranted')
                    : permission === 'denied'
                      ? t('settings.appearance.notifyDenied')
                      : t('settings.appearance.notifyOff')}
              </p>
            </div>
            {permission === 'default' ? (
              <button
                type="button"
                className="yu-btn yu-btn-tonal h-8 px-3 text-xs"
                onClick={() =>
                  void requestNotificationPermission().then((result) => {
                    setPermission(result);
                    if (result === 'granted')
                      toast(t('settings.appearance.notificationsOn'), 'success');
                  })
                }
              >
                {t('settings.appearance.turnOn')}
              </button>
            ) : null}
          </div>
          <div className="flex items-center gap-3 border-b border-border-subtle px-4 py-3.5">
            <Download className="size-4 shrink-0 text-text-tertiary" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-text-primary">{t('settings.appearance.installApp')}</p>
              <p className="text-xs text-text-tertiary">
                {standalone
                  ? t('settings.appearance.installAppInstalled')
                  : installEvent !== null
                    ? t('settings.appearance.installAppHint')
                    : t('settings.appearance.installAppBrowserHint')}
              </p>
            </div>
            {installEvent !== null && !standalone ? (
              <button
                type="button"
                className="yu-btn yu-btn-tonal h-8 px-3 text-xs"
                onClick={() => void installEvent.prompt().then(() => setInstallEvent(null))}
              >
                {t('settings.appearance.install')}
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
              <span className="block text-sm text-text-primary">
                {t('settings.appearance.keyboardShortcuts')}
              </span>
              <span className="block text-xs text-text-tertiary">
                {t('settings.appearance.keyboardShortcutsHint')}
              </span>
            </span>
          </button>
        </Card>
      </Section>
    </SettingsPage>
  );
}
