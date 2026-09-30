import { ArrowUpRight } from 'lucide-react';
import { useAuthState } from '../../lib/auth';
import { insertIntoComposer } from './composerBus';

function greeting(hour: number): string {
  if (hour < 5) return 'Up late';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

const STARTERS = [
  { title: 'Check on the servers', prompt: 'Check disk, memory and failed systemd units on all my servers and summarize anything that needs attention.' },
  { title: 'Review the backups', prompt: 'Did every backup job run successfully in the last 24 hours? List anything that failed or looks stale.' },
  { title: 'Catch me up', prompt: 'Summarize what we talked about across my conversations today and list open follow-ups.' },
  { title: 'Plan a cron job', prompt: 'Help me set up a cron job that ' },
] as const;

/** New chat: a greeting (the one gold word on screen) and a few starters. */
export function EmptyState() {
  const auth = useAuthState();
  const raw = auth.data?.user?.displayName ?? auth.data?.user?.username ?? null;
  const name = raw === null ? null : raw.charAt(0).toUpperCase() + raw.slice(1);
  return (
    <div className="flex h-full flex-col items-center justify-center px-4 pb-10 text-center sm:px-6">
      <h1 className="yu-rise text-[34px] leading-tight font-normal tracking-[-0.03em] sm:text-[44px]">
        {greeting(new Date().getHours())}
        {name !== null ? (
          <>
            , <span className="yu-shimmer-gold pr-[0.12em] italic">{name}</span>
          </>
        ) : null}
      </h1>
      <p className="yu-rise mt-3 max-w-md text-sm text-text-secondary" style={{ ['--yu-delay' as string]: '100ms' }}>
        Same Hermes as on Telegram: memory, skills and tools included. Type{' '}
        <kbd className="rounded-md bg-chip px-1.5 py-0.5 font-mono text-xs">/</kbd> for commands.
      </p>
      <div className="mt-8 grid w-full max-w-2xl grid-cols-1 gap-2.5 sm:grid-cols-2">
        {STARTERS.map((starter, index) => (
          <button
            key={starter.title}
            type="button"
            onClick={() => insertIntoComposer(starter.prompt)}
            className="yu-card yu-lift yu-rise group flex items-start gap-3 rounded-2xl px-4 py-3.5 text-left"
            style={{ ['--yu-delay' as string]: `${200 + index * 100}ms` }}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-medium text-text-primary">{starter.title}</span>
              <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-text-tertiary">{starter.prompt}</span>
            </span>
            <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-text-tertiary transition-colors group-hover:text-accent" aria-hidden />
          </button>
        ))}
      </div>
    </div>
  );
}
