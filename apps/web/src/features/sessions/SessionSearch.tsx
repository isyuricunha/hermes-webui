import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Search, X } from 'lucide-react';
import { searchSessions } from '../../lib/hx';
import { relativeTime } from '../../lib/format';
import { SourceIcon } from './SessionItem';

/** FTS snippets come back with >>>match<<< style markers; normalize and emphasize. */
function Snippet({ text, query }: { text: string; query: string }) {
  const clean = text
    .replace(/>>>|<<<|\[\[|\]\]|<\/?b>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const needle = query.trim().toLowerCase();
  if (needle === '') return <>{clean}</>;
  const parts: { text: string; hit: boolean }[] = [];
  let index = 0;
  const lower = clean.toLowerCase();
  while (index < clean.length) {
    const found = lower.indexOf(needle, index);
    if (found === -1) {
      parts.push({ text: clean.slice(index), hit: false });
      break;
    }
    if (found > index) parts.push({ text: clean.slice(index, found), hit: false });
    parts.push({ text: clean.slice(found, found + needle.length), hit: true });
    index = found + needle.length;
  }
  return (
    <>
      {parts.map((part, i) =>
        part.hit ? (
          <mark key={i} className="rounded-sm bg-accent/20 px-0.5 text-text-primary">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/** Full-text search over every conversation Hermes has (Telegram included). */
export function SessionSearch({
  query,
  onQueryChange,
  onNavigate,
}: {
  query: string;
  onQueryChange: (next: string) => void;
  onNavigate?: () => void;
}) {
  const debounced = useDebounced(query.trim(), 250);
  const { t } = useTranslation();
  const results = useQuery({
    queryKey: ['session-search', debounced],
    queryFn: () => searchSessions(debounced, 25),
    enabled: debounced.length >= 2,
    staleTime: 30_000,
  });

  return (
    <div className="px-3 pb-2">
      <label className="yu-input flex h-9 items-center gap-2 rounded-xl px-2.5">
        <Search className="size-3.5 shrink-0 text-text-tertiary" aria-hidden />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onQueryChange('');
          }}
          placeholder={t('sessions.searchAria')}
          aria-label={t('sessions.searchAria')}
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-text-tertiary"
        />
        {query !== '' ? (
          <button
            type="button"
            aria-label={t('sessions.clearSearch')}
            onClick={() => onQueryChange('')}
            className="text-text-tertiary hover:text-text-primary"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        ) : null}
      </label>
      {query.trim().length >= 2 ? (
        <div className="mt-2" aria-live="polite">
          {results.isFetching && results.data === undefined ? (
            <p className="yu-shimmer px-2 py-2 text-[13px]">{t('sessions.searching')}</p>
          ) : results.isError ? (
            <p className="px-2 py-2 text-[13px] text-danger">
              {t('sessions.searchUnavailable', { message: results.error.message })}
            </p>
          ) : (results.data?.results ?? []).length === 0 ? (
            <p className="px-2 py-2 text-[13px] text-text-tertiary">
              {t('sessions.searchNoMatches')}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {(results.data?.results ?? []).map((result) => (
                <li key={`${result.session_id}-${result.snippet.slice(0, 20)}`}>
                  <Link
                    to="/chat/$sessionId"
                    params={{ sessionId: result.session_id }}
                    onClick={onNavigate}
                    className="block rounded-lg px-2.5 py-2 transition-colors hover:bg-surface-input"
                  >
                    <span className="flex items-center gap-2">
                      <SourceIcon source={result.source} />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-text-primary">
                        {result.title ?? t('sessions.untitled')}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-text-tertiary">
                        {relativeTime(result.session_started)}
                      </span>
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-text-tertiary">
                      <Snippet text={result.snippet} query={query} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
