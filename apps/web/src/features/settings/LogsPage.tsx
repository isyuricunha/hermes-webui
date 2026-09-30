import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Pause, Play, Search } from 'lucide-react';
import { fetchLogTail } from '../../lib/hx';
import { ErrorNote, Segmented, SkeletonRows } from '../../components/ui';
import { SettingsPage } from './SettingsLayout';

const FILES = [
  { value: 'agent', label: 'Agent' },
  { value: 'gateway', label: 'Gateway' },
  { value: 'errors', label: 'Errors' },
] as const;

const LEVELS = [
  { value: 'ALL', label: 'All' },
  { value: 'INFO', label: 'Info+' },
  { value: 'WARNING', label: 'Warn+' },
  { value: 'ERROR', label: 'Errors' },
] as const;

function levelOf(line: string): 'error' | 'warning' | 'debug' | 'info' {
  if (/\b(ERROR|CRITICAL|Traceback)\b/.test(line)) return 'error';
  if (/\bWARN(ING)?\b/.test(line)) return 'warning';
  if (/\bDEBUG\b/.test(line)) return 'debug';
  return 'info';
}

const LEVEL_CLASS = {
  error: 'text-danger',
  warning: 'text-warning',
  debug: 'text-text-tertiary',
  info: 'text-text-secondary',
} as const;

/** Live tail of the Hermes logs with file, level and text filters. */
export function LogsPage() {
  const [file, setFile] = useState<string>('agent');
  const [level, setLevel] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [live, setLive] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  const logs = useQuery({
    queryKey: ['log-tail', file, level, search.trim()],
    queryFn: () => fetchLogTail({ file, level, search, lines: 300 }),
    refetchInterval: live ? 4000 : false,
    placeholderData: keepPreviousData,
  });

  const lines = (logs.data?.lines ?? []).map((line) => line.replace(/\n$/, ''));

  useEffect(() => {
    const node = scrollRef.current;
    if (node !== null && stickRef.current) node.scrollTop = node.scrollHeight;
  }, [logs.data]);

  return (
    <SettingsPage
      title="Logs"
      description="What the agent and gateway are doing right now."
      wide
      actions={
        <button type="button" onClick={() => setLive((value) => !value)} className="yu-btn yu-btn-secondary h-9 px-3 text-[13px]">
          {live ? <Pause className="size-3.5" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
          {live ? 'Pause' : 'Resume'}
        </button>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented label="Log file" options={FILES} value={file} onChange={setFile} />
        <Segmented label="Level" options={LEVELS} value={level} onChange={setLevel} />
        <label className="yu-input flex h-9 min-w-48 flex-1 items-center gap-2 rounded-xl px-2.5">
          <Search className="size-3.5 shrink-0 text-text-tertiary" aria-hidden />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filter lines"
            aria-label="Filter log lines"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-text-tertiary"
          />
        </label>
      </div>
      {logs.isError ? (
        <ErrorNote message={logs.error.message} onRetry={() => void logs.refetch()} />
      ) : logs.isPending ? (
        <SkeletonRows rows={6} />
      ) : (
        <div
          ref={scrollRef}
          onScroll={(event) => {
            const node = event.currentTarget;
            stickRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 40;
          }}
          className="yu-card h-[65vh] overflow-auto rounded-2xl bg-surface-editor px-4 py-3 font-mono text-[11.5px] leading-[1.7]"
        >
          {lines.length === 0 ? (
            <p className="text-text-tertiary">No lines match.</p>
          ) : (
            lines.map((line, index) => (
              <div key={index} className={['whitespace-pre-wrap break-all', LEVEL_CLASS[levelOf(line)]].join(' ')}>
                {line}
              </div>
            ))
          )}
        </div>
      )}
      <p className="mt-2 flex items-center gap-2 text-[11px] text-text-tertiary">
        {live ? <span className="yu-pulse size-1.5 rounded-full bg-success text-success" aria-hidden /> : null}
        {live ? 'Live, refreshing every 4s' : 'Paused'} · last {lines.length} lines
      </p>
    </SettingsPage>
  );
}
