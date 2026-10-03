import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, GitBranch, Heart, Palette, Scale, SquareTerminal } from 'lucide-react';
import type { ReactNode } from 'react';
import { fetchAppStatus } from '../../lib/api';
import { Card, Section } from '../../components/ui';
import { SettingsPage } from './SettingsLayout';

function GithubMark() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.69 5.39-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

function GitlabMark() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="m23.6 9.6-.03-.09-3.26-8.5a.85.85 0 0 0-1.62.06l-2.2 6.74H7.5L5.3 1.07a.85.85 0 0 0-1.62-.06L.43 9.5l-.03.09a6.05 6.05 0 0 0 2 6.99l.02.01.03.02 4.97 3.72 2.46 1.86 1.5 1.13a1 1 0 0 0 1.22 0l1.5-1.13 2.46-1.86 5-3.74.01-.01a6.05 6.05 0 0 0 2.02-6.99Z" />
    </svg>
  );
}

/** Where the project lives. GitHub is kept even while it is offline. */
const REPOSITORIES: readonly { name: string; url: string; hint: string; icon: ReactNode }[] = [
  {
    name: 'GitHub',
    url: 'https://github.com/isyuricunha/hermes-webui',
    hint: 'github.com/isyuricunha/hermes-webui',
    icon: <GithubMark />,
  },
  {
    name: 'GitLab',
    url: 'https://gitlab.com/isyuricunha/hermes-webui',
    hint: 'gitlab.com/isyuricunha/hermes-webui',
    icon: <GitlabMark />,
  },
  {
    name: 'YuGit',
    url: 'https://git.yuricunha.com/isyuricunha/hermes-webui',
    hint: 'git.yuricunha.com · Forgejo',
    icon: <GitBranch />,
  },
];

function LinkRow({
  href,
  icon,
  title,
  hint,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-input focus-visible:bg-surface-input focus-visible:outline-none"
    >
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-chip text-text-secondary [&>svg]:size-4"
        aria-hidden
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-text-primary">{title}</span>
        <span className="block truncate font-mono text-[11px] text-text-tertiary">{hint}</span>
      </span>
      <ArrowUpRight className="size-4 shrink-0 text-text-tertiary" aria-hidden />
    </a>
  );
}

/** Settings > About: versions, where the code lives, credits and license. */
export function AboutPage() {
  const { t } = useTranslation();
  const status = useQuery({ queryKey: ['app-status'], queryFn: fetchAppStatus, staleTime: 60_000 });
  const hermes = status.data?.hermes;
  const hermesVersion =
    hermes !== undefined && 'version' in hermes && hermes.version
      ? `v${hermes.version}`
      : (hermes?.state ?? '…');
  return (
    <SettingsPage title={t('settings.about.title')} description={t('settings.about.description')}>
      <Section title={t('settings.about.versions')}>
        <Card className="grid grid-cols-2 divide-x divide-border-subtle">
          <div className="px-4 py-3.5">
            <p className="text-xs text-text-tertiary">{t('settings.about.hermesWebui')}</p>
            <p className="mt-0.5 font-mono text-lg font-light text-text-primary">
              {status.data ? `v${status.data.version}` : '…'}
            </p>
          </div>
          <div className="px-4 py-3.5">
            <p className="text-xs text-text-tertiary">{t('settings.about.hermesAgent')}</p>
            <p className="mt-0.5 font-mono text-lg font-light text-text-primary">{hermesVersion}</p>
          </div>
        </Card>
      </Section>

      <Section title={t('settings.about.sourceCode')} description={t('settings.about.sourceDesc')}>
        <Card className="divide-y divide-border-subtle overflow-hidden">
          {REPOSITORIES.map((repo) => (
            <LinkRow
              key={repo.name}
              href={repo.url}
              icon={repo.icon}
              title={repo.name}
              hint={repo.hint}
            />
          ))}
        </Card>
      </Section>

      <Section title={t('settings.about.credits')}>
        <Card className="divide-y divide-border-subtle overflow-hidden">
          <div className="flex items-start gap-3 px-4 py-3">
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-chip text-accent"
              aria-hidden
            >
              <Heart className="size-4" />
            </span>
            <p className="min-w-0 text-sm leading-relaxed text-text-secondary">
              {t('settings.about.madeBy')}
              <span className="text-text-primary">Yuri Cunha</span>
              {t('settings.about.forWe')}
              <a
                className="text-link hover:underline"
                href="https://github.com/NousResearch/hermes-agent"
                target="_blank"
                rel="noreferrer noopener"
              >
                {t('settings.about.hermesAgentLink')}
              </a>
              {t('settings.about.byNous')}
            </p>
          </div>
          <div className="flex items-start gap-3 px-4 py-3">
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-chip text-text-secondary"
              aria-hidden
            >
              <Palette className="size-4" />
            </span>
            <p className="min-w-0 text-sm leading-relaxed text-text-secondary">
              {t('settings.about.yutheme')}
            </p>
          </div>
          <div className="flex items-start gap-3 px-4 py-3">
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-chip text-[#d77757]"
              aria-hidden
            >
              <SquareTerminal className="size-4" />
            </span>
            <p className="min-w-0 text-sm leading-relaxed text-text-secondary">
              {t('settings.about.yucode')}
            </p>
          </div>
          <div className="flex items-start gap-3 px-4 py-3">
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-chip text-text-secondary"
              aria-hidden
            >
              <Scale className="size-4" />
            </span>
            <p className="min-w-0 text-sm leading-relaxed text-text-secondary">
              {t('settings.about.license1')}
              <span className="text-text-primary">GNU AGPL v3</span>
              {t('settings.about.license2')}
            </p>
          </div>
        </Card>
      </Section>
    </SettingsPage>
  );
}
