import { Link, Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchConfigSchema } from '../../lib/api';
import { searchSchema } from '../../lib/settingsSearch';
import { goToChat } from '../../lib/navigation';
import { ArrowLeft, Menu, Search } from 'lucide-react';
import { SETTINGS_ITEMS, SETTINGS_NAV } from '../../app/settingsNav';
import { ErrorNote, Page, PageHeader } from '../../components/ui';

function sectionKey(pathname: string): string {
  const match = SETTINGS_ITEMS.filter((item) => pathname.startsWith(item.to)).sort(
    (a, b) => b.to.length - a.to.length,
  )[0];
  if (match !== undefined) return match.label;
  if (pathname.includes('/field')) return 'settings.fallbackField';
  return 'settings.title';
}

/**
 * Settings is its own workspace (PRD 6.2, 19).
 *
 * Desktop (>=md): grouped navigation column | content.
 * Mobile: single pane at full width; navigation lives in a drawer opened
 * from the top bar, closed by selection, backdrop or Escape.
 */
export function SettingsLayout() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const schemaQuery = useQuery({
    queryKey: ['settings-schema'],
    queryFn: fetchConfigSchema,
    staleTime: 5 * 60_000,
  });
  const hits = query.trim() === '' ? [] : searchSchema(schemaQuery.data?.fields ?? {}, query, 12);
  const pageHits =
    query.trim() === ''
      ? []
      : SETTINGS_ITEMS.filter((item) =>
          `${item.label} ${item.keywords ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()),
        );

  // Escape closes the drawer (keyboard environments).
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  const activeSection = t(sectionKey(location.pathname));

  const navContent = (
    <div className="flex h-full flex-col">
      <p className="px-2.5 pb-3 text-[17px] font-medium tracking-[-0.02em] text-text-primary">
        {t('settings.title')}
      </p>
      <label className="yu-input mb-3 flex h-9 items-center gap-2 rounded-xl px-2.5">
        <Search className="size-3.5 shrink-0 text-text-tertiary" aria-hidden />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('settings.searchPlaceholder')}
          aria-label={t('settings.searchAria')}
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-text-tertiary"
        />
      </label>
      {query.trim() !== '' ? (
        <ul className="mb-3 space-y-0.5 overflow-y-auto">
          {pageHits.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  onClick={() => {
                    setQuery('');
                    setDrawerOpen(false);
                  }}
                  className="flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] text-text-secondary hover:bg-surface-input hover:text-text-primary"
                >
                  <Icon className="size-4 text-text-tertiary" aria-hidden />
                  {t(item.label)}
                </Link>
              </li>
            );
          })}
          {hits.map((hit) => (
            <li key={hit.path}>
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setDrawerOpen(false);
                  void navigate({
                    to: '/settings/field',
                    search: { path: hit.path },
                  });
                }}
                className="block w-full rounded-lg px-2.5 py-2 text-left hover:bg-surface-input"
                title={hit.path}
              >
                <span className="block text-[13px] font-medium text-text-primary">{hit.label}</span>
                <span className="block font-mono text-[10.5px] break-all text-text-tertiary">
                  {hit.path}
                </span>
              </button>
            </li>
          ))}
          {hits.length === 0 && pageHits.length === 0 ? (
            <li className="px-2.5 py-1 text-[13px] text-text-tertiary">
              {t('settings.noMatches')}
            </li>
          ) : null}
        </ul>
      ) : (
        <div className="-mx-1 flex-1 overflow-y-auto px-1">
          {SETTINGS_NAV.map((group) => (
            <div key={group.group} className="mb-3">
              <p className="yu-eyebrow px-2.5 pb-1">{t(group.group)}</p>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active =
                    location.pathname === item.to ||
                    (item.to === '/settings/models' && location.pathname === '/settings');
                  return (
                    <li key={item.to}>
                      <Link
                        to={item.to}
                        onClick={() => setDrawerOpen(false)}
                        aria-current={active ? 'page' : undefined}
                        className={[
                          'flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] transition-colors',
                          active
                            ? 'bg-chip text-text-primary'
                            : 'text-text-secondary hover:bg-surface-input hover:text-text-primary',
                        ].join(' ')}
                      >
                        <Icon
                          className={['size-4', active ? 'text-accent' : 'text-text-tertiary'].join(
                            ' ',
                          )}
                          aria-hidden
                        />
                        {t(item.label)}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
      {/* Workspace switch back to Chat (closes the drawer on mobile). */}
      <div className="mt-auto border-t border-border-subtle pt-2">
        <button
          type="button"
          onClick={() => {
            setDrawerOpen(false);
            goToChat(navigate);
          }}
          className="yu-btn yu-btn-ghost h-9 w-full justify-start rounded-lg px-2.5 text-[13.5px]"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {t('settings.backToChat')}
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col md:flex-row">
      {/* Mobile top bar: back to Chat + navigation + current section */}
      <header className="safe-top-bar fixed inset-x-0 top-0 z-30 flex items-center gap-1 border-b border-border-subtle bg-background/85 backdrop-blur-md md:hidden">
        <button
          type="button"
          className="yu-btn yu-btn-ghost size-10 rounded-lg"
          aria-label={t('settings.backToChatAria')}
          onClick={() => goToChat(navigate)}
        >
          <ArrowLeft className="size-[18px]" aria-hidden />
        </button>
        <button
          type="button"
          className="yu-btn yu-btn-ghost size-10 rounded-lg"
          aria-label={t('settings.openNavAria')}
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen(true)}
        >
          <Menu className="size-[18px]" aria-hidden />
        </button>
        <span className="min-w-0 truncate text-[15px] font-medium">{activeSection}</span>
      </header>

      {/* Mobile drawer backdrop */}
      {drawerOpen ? (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-[2px] md:hidden"
          aria-hidden
          onClick={() => setDrawerOpen(false)}
        />
      ) : null}

      {/* Navigation: drawer on mobile, persistent column on desktop */}
      <nav
        aria-label={t('settings.title')}
        className={[
          'fixed inset-y-0 left-0 z-40 w-72 shrink-0 border-r border-border-subtle bg-surface p-3 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-[calc(0.75rem+env(safe-area-inset-bottom))]',
          'transition-transform duration-200 md:static md:w-60 md:translate-x-0',
          drawerOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        {navContent}
      </nav>

      {/* Content: full available width, own scroll */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}

export function SettingsPage({
  title,
  description,
  actions,
  wide = false,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Page wide={wide}>
      <PageHeader title={title} description={description} actions={actions} />
      {children}
    </Page>
  );
}

export function SettingsError({ message }: { message: string }) {
  return <ErrorNote message={message} />;
}
