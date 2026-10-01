import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  ArrowUpRight,
  ChevronRight,
  CircleCheck,
  Home,
  PlugZap,
  QrCode as QrIcon,
  RotateCw,
  Search,
  Undo2,
  UserCheck,
  UserX,
  X,
} from 'lucide-react';
import { restartGateway } from '../../lib/api';
import {
  approvePairing,
  setAgentPluginEnabled,
  clearPendingPairing,
  fetchPairing,
  revokePairing,
  startGateway,
  applyTelegramSetup,
  applyWhatsAppSetup,
  cancelTelegramSetup,
  cancelWhatsAppSetup,
  fetchMessaging,
  pollTelegramSetup,
  pollWhatsAppSetup,
  startTelegramSetup,
  startWhatsAppSetup,
  testMessagingPlatform,
  updateMessagingPlatform,
  type MessagingEnvVar,
  type MessagingPlatform,
  type RestartResult,
  type WhatsAppSetup,
} from '../../lib/hx';
import { confirmDialog } from '../../lib/dialog';
import { toast, toastError } from '../../lib/toast';
import { Badge, Card, ErrorNote, Section, Segmented, Sheet, SkeletonRows, StatusDot, Switch } from '../../components/ui';
import { SettingsPage } from './SettingsLayout';
import { QrCode } from './QrCode';

/**
 * Messaging channels: every platform Hermes' gateway can talk on (Discord,
 * Telegram, Slack, WhatsApp, email...). Credentials go to Hermes' .env and
 * the on/off switch to config.yaml through the dashboard; a gateway restart
 * makes the change live. Hermes stays the source of truth for state.
 */

const QUERY_KEY = ['messaging'] as const;

/** Platforms the WebUI itself depends on, or managed on their own page. */
const LOCKED: Record<string, string> = {
  api_server: 'This WebUI talks to Hermes through it, so it stays on.',
};
/** Managed on their own page. */
const ELSEWHERE = new Set(['webhook']);

type Tone = 'success' | 'warning' | 'danger' | 'neutral';

function stateInfo(platform: Pick<MessagingPlatform, 'state' | 'enabled' | 'configured' | 'plugin'>): {
  label: string;
  tone: Tone;
} {
  // The adapter plugin wins: while it is off the gateway never loads the channel.
  if (platform.enabled && platform.plugin && !platform.plugin.enabled) return { label: 'Plugin off', tone: 'warning' };
  const state = platform.state ?? '';
  switch (state) {
    case 'connected':
      return { label: 'Connected', tone: 'success' };
    case 'pending_restart':
      return { label: 'Restart to apply', tone: 'warning' };
    case 'disabled':
      return { label: platform.configured ? 'Off' : 'Not set up', tone: 'neutral' };
    case 'not_configured':
      return { label: 'Needs setup', tone: 'warning' };
    case 'gateway_stopped':
      return { label: 'Gateway stopped', tone: 'warning' };
    case 'startup_failed':
    case 'fatal':
    case 'error':
    case 'failed':
      return { label: 'Error', tone: 'danger' };
    case 'connecting':
    case 'reconnecting':
    case 'retrying':
    case 'starting':
      return { label: 'Connecting', tone: 'warning' };
    default:
      return { label: state === '' ? 'Unknown' : state.replace(/_/g, ' '), tone: 'neutral' };
  }
}

/** Restart the gateway, then refresh channel states until they settle. */
function useGatewayRestart() {
  const queryClient = useQueryClient();
  // Fast refresh for ~45s after a restart, while channels reconnect.
  const [watching, setWatching] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const watch = () => {
    setWatching(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setWatching(false), 45_000);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const restart = useMutation({
    mutationFn: restartGateway,
    onSuccess: () => {
      toast('Restarting the gateway. Channels reconnect in a few seconds.', 'success');
      watch();
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (error) => toastError(error),
  });
  const ask = async (reason?: string) => {
    const ok = await confirmDialog({
      title: 'Restart the gateway?',
      description: `${reason ?? 'Channel changes take effect when the gateway restarts.'} Replies running right now are interrupted, and every channel is offline for a few seconds.`,
      confirmLabel: 'Restart',
    });
    if (ok) restart.mutate();
  };
  return { ask, watch, watching, pending: restart.isPending };
}

function afterRestartResult(result: RestartResult, what: string, gateway: ReturnType<typeof useGatewayRestart>) {
  if (result.restart_started === true) {
    toast(`${what} saved. The gateway is restarting to connect it.`, 'success');
    gateway.watch();
  } else {
    toast(`${what} saved. Restart the gateway to connect it.`, 'success');
  }
}

export function MessagingPage() {
  const gateway = useGatewayRestart();
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchMessaging,
    refetchInterval: gateway.watching ? 2_500 : 20_000,
  });
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const platforms = useMemo(() => query.data?.platforms ?? [], [query.data]);
  const active = platforms.filter((p) => p.enabled || p.configured);
  const available = platforms.filter((p) => !p.enabled && !p.configured);
  const needle = filter.trim().toLowerCase();
  const shown =
    needle === ''
      ? available
      : available.filter((p) => `${p.name} ${p.id} ${p.description}`.toLowerCase().includes(needle));
  const pendingRestart = platforms.filter((p) => p.state === 'pending_restart');
  const gatewayRunning = platforms.some((p) => p.gateway_running);
  const open = platforms.find((p) => p.id === openId) ?? null;

  return (
    <SettingsPage
      title="Messaging"
      description="Talk to Hermes from Discord, Telegram, Slack, WhatsApp, email and more."
      actions={
        <button
          type="button"
          onClick={() => void gateway.ask()}
          disabled={gateway.pending}
          className="yu-btn yu-btn-tonal h-8 gap-1.5 rounded-lg px-3 text-xs"
          data-tip="Restart the Hermes gateway so saved channel changes take effect"
        >
          <RotateCw className={['size-3.5', gateway.pending || gateway.watching ? 'animate-spin' : ''].join(' ')} aria-hidden />
          Restart gateway
        </button>
      }
    >
      {query.isError ? (
        <ErrorNote message={query.error.message} onRetry={() => void query.refetch()} />
      ) : query.isPending ? (
        <SkeletonRows rows={5} />
      ) : (
        <>
          {!gatewayRunning ? (
            <div role="status" className="yu-chip-warning mb-4 flex flex-wrap items-center gap-2.5 rounded-2xl px-3.5 py-3 text-[13px]">
              <span className="min-w-0 flex-1">The gateway is not running, so no channel is connected.</span>
              <button
                type="button"
                onClick={() =>
                  void startGateway().then(
                    () => {
                      toast('Starting the gateway…', 'success');
                      gateway.watch();
                    },
                    (error: unknown) => toastError(error),
                  )
                }
                className="yu-btn yu-btn-primary h-7 rounded-lg px-2.5 text-xs"
              >
                Start gateway
              </button>
            </div>
          ) : pendingRestart.length > 0 ? (
            <div role="status" className="yu-chip-warning mb-4 flex flex-wrap items-center gap-2.5 rounded-2xl px-3.5 py-3 text-[13px]">
              <span className="min-w-0 flex-1">
                {pendingRestart.map((p) => p.name).join(', ')} {pendingRestart.length === 1 ? 'has' : 'have'} saved changes waiting for a gateway restart.
              </span>
              <button
                type="button"
                onClick={() => void gateway.ask()}
                disabled={gateway.pending}
                className="yu-btn yu-btn-primary h-7 rounded-lg px-2.5 text-xs"
              >
                Restart now
              </button>
            </div>
          ) : null}

          <Section title="Your channels" description="Set up in Hermes. Click one to change it, test it or turn it off.">
            {active.length === 0 ? (
              <p className="text-[13px] text-text-secondary">No channel yet. Pick one below.</p>
            ) : (
              <ul className="space-y-1.5">
                {active.map((platform) => (
                  <li key={platform.id}>
                    <PlatformRow platform={platform} onOpen={() => setOpenId(platform.id)} />
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <PairingSection platforms={platforms} />

          <Section
            title="Add a channel"
            description={`${available.length} more platforms Hermes can connect to.`}
            actions={
              <label className="yu-input flex h-8 w-44 items-center gap-1.5 px-2.5 sm:w-56">
                <Search className="size-3.5 shrink-0 text-text-tertiary" aria-hidden />
                <input
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder="Find a platform"
                  aria-label="Find a platform"
                  className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-text-tertiary"
                />
              </label>
            }
          >
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {shown.map((platform) => (
                <li key={platform.id}>
                  <PlatformRow platform={platform} compact onOpen={() => setOpenId(platform.id)} />
                </li>
              ))}
              {shown.length === 0 ? <li className="text-[13px] text-text-secondary">Nothing matches “{filter}”.</li> : null}
            </ul>
          </Section>
        </>
      )}
      {open !== null ? <PlatformSheet platform={open} gateway={gateway} onClose={() => setOpenId(null)} /> : null}
    </SettingsPage>
  );
}

/**
 * Pairing: someone messages a bot they are not allowed on yet, Hermes gives
 * them a one-time code and lists the request here. Approving adds them to the
 * channel's approved users (and its allowlist when one is set).
 */
function PairingSection({ platforms }: { platforms: MessagingPlatform[] }) {
  const queryClient = useQueryClient();
  const pairing = useQuery({ queryKey: ['pairing'], queryFn: fetchPairing, refetchInterval: 15_000 });
  const [code, setCode] = useState('');
  const [codePlatform, setCodePlatform] = useState('');
  const nameOf = (id: string) => platforms.find((p) => p.id === id)?.name ?? id;
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['pairing'] });
  const act = (work: Promise<unknown>, done: string) =>
    void work.then(
      () => {
        toast(done, 'success');
        refresh();
      },
      (error: unknown) => toastError(error),
    );
  const connected = platforms.filter((p) => p.enabled && p.configured && !['api_server', 'webhook'].includes(p.id));
  const pending = pairing.data?.pending ?? [];
  const approved = pairing.data?.approved ?? [];
  if (pairing.isError) return null;

  return (
    <Section
      title="Access requests"
      description="People who messaged one of your bots and wait for your OK. Approved people can talk to Hermes there."
      actions={
        pending.length > 1 ? (
          <button
            type="button"
            onClick={async () => {
              const ok = await confirmDialog({ title: 'Dismiss every request?', description: 'They can ask again by messaging the bot.', confirmLabel: 'Dismiss all', tone: 'danger' });
              if (ok) act(clearPendingPairing(), 'Requests dismissed.');
            }}
            className="yu-btn yu-btn-ghost h-7 rounded-lg px-2.5 text-xs text-text-secondary"
          >
            Dismiss all
          </button>
        ) : undefined
      }
    >
      <Card>
        {pending.length === 0 && approved.length === 0 ? (
          <p className="px-4 py-3.5 text-[13px] text-text-secondary">No requests. When someone new messages a bot, they show up here.</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {pending.map((request) => (
              <li key={`${request.platform}:${request.request_id || request.user_id}`} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-text-primary">
                    {request.user_name || request.user_id}
                    <Badge tone="warning">waiting</Badge>
                    <Badge>{nameOf(request.platform)}</Badge>
                  </span>
                  <span className="block font-mono text-[11px] text-text-tertiary">
                    {request.user_id} · {request.age_minutes < 1 ? 'just now' : `${request.age_minutes} min ago`}
                  </span>
                </span>
                {request.request_id ? (
                  <button
                    type="button"
                    onClick={() => act(approvePairing(request.platform, { request_id: request.request_id }), `${request.user_name || request.user_id} approved.`)}
                    className="yu-btn yu-btn-primary h-8 gap-1.5 rounded-lg px-3 text-xs"
                  >
                    <UserCheck className="size-3.5" aria-hidden /> Approve
                  </button>
                ) : (
                  <span className="text-xs text-text-tertiary">Approve with the code they received</span>
                )}
              </li>
            ))}
            {approved.map((user) => (
              <li key={`${user.platform}:${user.user_id}`} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 text-[13px] text-text-primary">
                    {user.user_name || user.user_id}
                    <Badge tone="success">approved</Badge>
                    <Badge>{nameOf(user.platform)}</Badge>
                  </span>
                  <span className="block font-mono text-[11px] text-text-tertiary">{user.user_id}</span>
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await confirmDialog({
                      title: `Remove ${user.user_name || user.user_id}?`,
                      description: `They lose access to Hermes on ${nameOf(user.platform)}.`,
                      confirmLabel: 'Remove access',
                      tone: 'danger',
                    });
                    if (ok) act(revokePairing(user.platform, user.user_id), 'Access removed.');
                  }}
                  className="yu-btn yu-btn-ghost h-8 gap-1.5 rounded-lg px-2.5 text-xs text-text-secondary"
                >
                  <UserX className="size-3.5" aria-hidden /> Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        {connected.length > 0 ? (
          <form
            className="flex flex-wrap items-center gap-2 border-t border-border-subtle px-4 py-3"
            onSubmit={(event) => {
              event.preventDefault();
              const platform = codePlatform || connected[0]!.id;
              if (code.trim() === '') return;
              act(approvePairing(platform, { code: code.trim() }), 'Code accepted.');
              setCode('');
            }}
          >
            <span className="text-xs text-text-secondary">Got a pairing code?</span>
            {connected.length > 1 ? (
              <span className="flex flex-wrap gap-1" role="radiogroup" aria-label="Channel of the code">
                {connected.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={(codePlatform || connected[0]!.id) === p.id}
                    onClick={() => setCodePlatform(p.id)}
                    className={['yu-chip', (codePlatform || connected[0]!.id) === p.id ? 'yu-chip-accent' : ''].join(' ')}
                  >
                    {p.name}
                  </button>
                ))}
              </span>
            ) : null}
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="ABCD1234"
              aria-label="Pairing code"
              className="yu-input h-8 w-32 px-2.5 font-mono text-[13px] uppercase"
            />
            <button type="submit" disabled={code.trim() === ''} className="yu-btn yu-btn-tonal h-8 rounded-lg px-3 text-xs">
              Approve
            </button>
          </form>
        ) : null}
      </Card>
    </Section>
  );
}

function PlatformRow({
  platform,
  onOpen,
  compact = false,
}: {
  platform: MessagingPlatform;
  onOpen: () => void;
  compact?: boolean;
}) {
  const info = stateInfo(platform);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="yu-card group flex w-full items-center gap-3 rounded-2xl px-3.5 py-2.5 text-left transition-colors hover:bg-hover"
    >
      {compact ? null : <StatusDot tone={info.tone} />}
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-text-primary">
          {platform.name}
          {compact ? null : <Badge tone={info.tone}>{info.label}</Badge>}
          {!compact && platform.home_channel?.name ? (
            <span className="inline-flex items-center gap-1 text-[11.5px] font-normal text-text-tertiary">
              <Home className="size-3" aria-hidden /> {platform.home_channel.name}
            </span>
          ) : null}
        </span>
        {platform.error_message && !compact ? (
          <span className="mt-0.5 block line-clamp-2 text-xs text-danger">{platform.error_message}</span>
        ) : platform.description ? (
          <span className="mt-0.5 block line-clamp-1 text-xs text-text-secondary">{platform.description}</span>
        ) : null}
      </span>
      <ChevronRight className="size-4 shrink-0 text-text-tertiary transition-transform group-hover:translate-x-0.5" aria-hidden />
    </button>
  );
}

// --- One platform -------------------------------------------------------------------

function PlatformSheet({
  platform,
  gateway,
  onClose,
}: {
  platform: MessagingPlatform;
  gateway: ReturnType<typeof useGatewayRestart>;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const info = stateInfo(platform);
  const locked = LOCKED[platform.id];
  const elsewhere = ELSEWHERE.has(platform.id);
  const [values, setValues] = useState<Record<string, string>>({});
  const [clear, setClear] = useState<Set<string>>(new Set());
  // A platform being set up for the first time is switched on by its save.
  const [enabled, setEnabled] = useState(platform.enabled || !platform.configured);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [guided, setGuided] = useState<'telegram' | 'whatsapp' | null>(null);

  const edited = Object.entries(values).filter(([, value]) => value.trim() !== '');
  const missing = platform.env_vars.filter(
    (field) => field.required && (!field.is_set || clear.has(field.key)) && (values[field.key] ?? '').trim() === '',
  );
  const pluginOff = platform.plugin !== undefined && platform.plugin !== null && !platform.plugin.enabled;
  const dirty = edited.length > 0 || clear.size > 0 || enabled !== platform.enabled || (enabled && pluginOff);
  const basic = platform.env_vars.filter((field) => !field.advanced);
  const advanced = platform.env_vars.filter((field) => field.advanced);

  const save = useMutation({
    mutationFn: async (andRestart: boolean) => {
      // Turning a channel on also turns on its adapter plugin, or the gateway skips it.
      if (enabled && pluginOff) await setAgentPluginEnabled(platform.plugin!.name, true);
      await updateMessagingPlatform(platform.id, {
        env: Object.fromEntries(edited.map(([key, value]) => [key, value.trim()])),
        clear_env: [...clear],
        ...(enabled !== platform.enabled || !platform.configured ? { enabled } : {}),
      });
      return andRestart;
    },
    onSuccess: (andRestart) => {
      setValues({});
      setClear(new Set());
      setTestResult(null);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      if (andRestart) {
        void gateway.ask(`${platform.name} is saved.`);
      } else {
        toast(`${platform.name} saved. Restart the gateway to apply it.`, 'success');
      }
    },
    onError: (error) => toastError(error),
  });

  const test = useMutation({
    mutationFn: () => testMessagingPlatform(platform.id),
    onSuccess: (result) => setTestResult({ ok: result.ok, message: result.message }),
    onError: (error) => toastError(error),
  });

  const canSave = dirty && !(enabled && missing.length > 0) && !save.isPending;

  return (
    <Sheet
      open
      onClose={onClose}
      title={platform.name}
      subtitle={
        <span className="inline-flex items-center gap-1.5">
          <StatusDot tone={info.tone} /> {info.label}
          {platform.home_channel?.name ? ` · home: ${platform.home_channel.name}` : ''}
        </span>
      }
    >
      <div className="space-y-5">
        {platform.description ? <p className="text-[13px] text-text-secondary">{platform.description}</p> : null}

        {platform.error_message ? (
          <div role="alert" className="yu-chip-danger rounded-2xl px-3.5 py-3 text-[13px]">
            <p className="font-medium">{platform.error_code ?? 'Error'}</p>
            <p className="mt-0.5 break-words">{platform.error_message}</p>
          </div>
        ) : null}

        {pluginOff && locked === undefined ? (
          <div role="status" className="yu-chip-warning flex flex-wrap items-center gap-2.5 rounded-2xl px-3.5 py-3 text-[13px]">
            <span className="min-w-0 flex-1">
              The {platform.name} adapter is a Hermes plugin (<code className="font-mono text-xs">{platform.plugin!.name}</code>) and it is
              off, so the gateway skips {platform.name} even with a valid token. Saving with {platform.name} turned on switches it on too.
            </span>
            <button
              type="button"
              onClick={() =>
                void setAgentPluginEnabled(platform.plugin!.name, true).then(
                  () => {
                    void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
                    void gateway.ask(`The ${platform.name} plugin is on.`);
                  },
                  (error: unknown) => toastError(error),
                )
              }
              className="yu-btn yu-btn-primary h-7 rounded-lg px-2.5 text-xs"
            >
              Turn plugin on
            </button>
          </div>
        ) : null}
        {locked !== undefined ? (
          <Card className="px-4 py-3 text-[13px] text-text-secondary">{locked}</Card>
        ) : null}
        {elsewhere ? (
          <Link to="/settings/webhooks" className="yu-btn yu-btn-tonal h-9 gap-1.5 rounded-xl px-3.5 text-[13px]" onClick={onClose}>
            Manage webhooks <ArrowUpRight className="size-3.5" aria-hidden />
          </Link>
        ) : null}

        {platform.id === 'discord' ? <DiscordGuide /> : null}

        {platform.id === 'telegram' && guided !== 'telegram' ? (
          <GuidedOffer
            title="Create a Telegram bot with a QR code"
            body="Scan it with your phone and Telegram makes the bot for you, no BotFather copy and paste."
            replaces={platform.configured}
            onStart={() => setGuided('telegram')}
          />
        ) : null}
        {platform.id === 'whatsapp' && guided !== 'whatsapp' ? (
          <GuidedOffer
            title="Link WhatsApp with a QR code"
            body="Pair a number the same way WhatsApp Web does. Hermes runs its own bridge for it."
            replaces={platform.configured}
            onStart={() => setGuided('whatsapp')}
          />
        ) : null}
        {guided === 'telegram' ? (
          <TelegramSetup
            onDone={(result) => {
              setGuided(null);
              afterRestartResult(result, 'Telegram bot', gateway);
              void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
            }}
            onCancel={() => setGuided(null)}
          />
        ) : null}
        {guided === 'whatsapp' ? (
          <WhatsAppSetupFlow
            onDone={(result) => {
              setGuided(null);
              afterRestartResult(result, 'WhatsApp', gateway);
              void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
            }}
            onCancel={() => setGuided(null)}
          />
        ) : null}

        {locked === undefined && guided === null && platform.env_vars.length > 0 ? (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (canSave) save.mutate(true);
            }}
          >
            <div className="space-y-3.5">
              {basic.map((field) => (
                <EnvField
                  key={field.key}
                  field={field}
                  value={values[field.key] ?? ''}
                  clearing={clear.has(field.key)}
                  onChange={(value) => setValues((current) => ({ ...current, [field.key]: value }))}
                  onClear={(on) =>
                    setClear((current) => {
                      const next = new Set(current);
                      if (on) next.add(field.key);
                      else next.delete(field.key);
                      return next;
                    })
                  }
                />
              ))}
            </div>
            {advanced.length > 0 ? (
              <details className="rounded-2xl bg-surface-input/40 px-3.5 py-2.5">
                <summary className="cursor-pointer select-none text-[13px] text-text-secondary">
                  Advanced ({advanced.length})
                </summary>
                <div className="mt-3 space-y-3.5">
                  {advanced.map((field) => (
                    <EnvField
                      key={field.key}
                      field={field}
                      value={values[field.key] ?? ''}
                      clearing={clear.has(field.key)}
                      onChange={(value) => setValues((current) => ({ ...current, [field.key]: value }))}
                      onClear={(on) =>
                        setClear((current) => {
                          const next = new Set(current);
                          if (on) next.add(field.key);
                          else next.delete(field.key);
                          return next;
                        })
                      }
                    />
                  ))}
                </div>
              </details>
            ) : null}

            <HomeChannel platform={platform} />

            <div className="flex items-center justify-between gap-3 rounded-2xl bg-surface-input/40 px-3.5 py-3">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-text-primary">Turn on {platform.name}</p>
                <p className="text-xs text-text-tertiary">
                  {enabled ? 'The gateway connects it after a restart.' : 'Saved credentials stay, the gateway just skips it.'}
                </p>
              </div>
              <Switch label={`Turn on ${platform.name}`} checked={enabled} onChange={setEnabled} />
            </div>

            {enabled && missing.length > 0 && dirty ? (
              <p className="text-xs text-warning">Fill in {missing.map((field) => field.prompt).join(', ')} to turn it on.</p>
            ) : null}

            {testResult !== null ? (
              <div
                role="status"
                className={[
                  'flex items-start gap-2 rounded-2xl px-3.5 py-2.5 text-[13px]',
                  testResult.ok ? 'yu-chip-success' : 'yu-chip-warning',
                ].join(' ')}
              >
                {testResult.ok ? <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden /> : <PlugZap className="mt-0.5 size-4 shrink-0" aria-hidden />}
                <span className="min-w-0 flex-1 break-words">{testResult.message}</span>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button type="submit" disabled={!canSave} className="yu-btn yu-btn-primary h-9 rounded-xl px-4 text-[13px]">
                {save.isPending ? 'Saving…' : 'Save and restart'}
              </button>
              <button
                type="button"
                disabled={!canSave}
                onClick={() => save.mutate(false)}
                className="yu-btn yu-btn-tonal h-9 rounded-xl px-3.5 text-[13px]"
                data-tip="Save now and restart the gateway later"
              >
                Save only
              </button>
              <button
                type="button"
                disabled={test.isPending || dirty}
                onClick={() => test.mutate()}
                className="yu-btn yu-btn-ghost h-9 gap-1.5 rounded-xl px-3 text-[13px]"
                data-tip={dirty ? 'Save first, then test' : 'Ask Hermes whether this channel is connected'}
              >
                <PlugZap className="size-4" aria-hidden />
                {test.isPending ? 'Testing…' : 'Test'}
              </button>
              {platform.docs_url ? (
                <a
                  href={platform.docs_url}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary"
                >
                  Docs <ArrowUpRight className="size-3" aria-hidden />
                </a>
              ) : null}
            </div>
          </form>
        ) : null}

        {locked === undefined && guided === null && platform.env_vars.length === 0 && !elsewhere ? (
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-surface-input/40 px-3.5 py-3">
            <p className="text-[13px] text-text-secondary">Nothing to fill in here; it reads its settings from config.yaml.</p>
            <Switch
              label={`Turn on ${platform.name}`}
              checked={platform.enabled}
              onChange={(next) =>
                void updateMessagingPlatform(platform.id, { enabled: next }).then(
                  () => {
                    void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
                    void gateway.ask(`${platform.name} turned ${next ? 'on' : 'off'}.`);
                  },
                  (error: unknown) => toastError(error),
                )
              }
            />
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

function EnvField({
  field,
  value,
  clearing,
  onChange,
  onClear,
}: {
  field: MessagingEnvVar;
  value: string;
  clearing: boolean;
  onChange: (value: string) => void;
  onClear: (on: boolean) => void;
}) {
  const id = `env-${field.key}`;
  const saved = field.is_set && !clearing;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[13px] font-medium text-text-primary">
          {field.prompt}
          {field.required ? <span className="ml-0.5 text-danger" aria-hidden>*</span> : null}
        </label>
        <span className="flex items-center gap-2">
          {field.is_set ? (
            clearing ? (
              <button type="button" onClick={() => onClear(false)} className="inline-flex items-center gap-1 text-[11.5px] text-warning hover:underline">
                <Undo2 className="size-3" aria-hidden /> Will be removed, undo
              </button>
            ) : (
              <>
                <Badge tone="success">saved</Badge>
                <button
                  type="button"
                  onClick={() => onClear(true)}
                  className="inline-flex items-center text-[11.5px] text-text-tertiary hover:text-danger"
                  aria-label={`Remove ${field.prompt}`}
                  data-tip="Remove the saved value"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </>
            )
          ) : null}
        </span>
      </div>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        type={field.is_password ? 'password' : 'text'}
        autoComplete="off"
        spellCheck={false}
        disabled={clearing}
        placeholder={saved ? `Saved${field.redacted_value ? ` (${field.redacted_value})` : ''}. Type to replace` : ''}
        className="yu-input h-10 w-full px-3 font-mono text-[13px] disabled:opacity-50"
      />
      {field.description || field.help || field.url ? (
        <p className="mt-1 text-xs text-text-tertiary">
          {field.description}
          {field.help && field.help !== field.description ? ` ${field.help}` : ''}
          {field.url ? (
            <>
              {' '}
              <a href={field.url} target="_blank" rel="noreferrer" className="inline-flex items-center text-text-secondary underline-offset-2 hover:underline">
                Open <ArrowUpRight className="size-3" aria-hidden />
              </a>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

function HomeChannel({ platform }: { platform: MessagingPlatform }) {
  const home = platform.home_channel;
  const command = platform.id === 'slack' ? '/hermes sethome' : '/sethome';
  return (
    <div className="flex items-start gap-2.5 rounded-2xl bg-surface-input/40 px-3.5 py-3 text-[13px]">
      <Home className="mt-0.5 size-4 shrink-0 text-text-tertiary" aria-hidden />
      <p className="min-w-0 flex-1 text-text-secondary">
        {home?.name || home?.chat_id ? (
          <>
            Home channel: <span className="text-text-primary">{home.name || home.chat_id}</span>. Cron results and
            notifications land there.
          </>
        ) : (
          <>No home channel yet.</>
        )}{' '}
        Send <code className="font-mono text-xs text-text-primary">{command}</code> in the chat Hermes should use for it.
      </p>
    </div>
  );
}

function DiscordGuide() {
  return (
    <details className="yu-card rounded-2xl px-4 py-3" open>
      <summary className="cursor-pointer select-none text-[13px] font-medium text-text-primary">How to create the Discord bot</summary>
      <ol className="mt-2.5 list-decimal space-y-1.5 pl-5 text-[13px] text-text-secondary marker:text-text-tertiary">
        <li>
          Open the{' '}
          <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer" className="text-text-primary underline-offset-2 hover:underline">
            Developer Portal
          </a>
          , create an application, then go to <b className="font-medium text-text-primary">Bot</b>.
        </li>
        <li>
          Turn on <b className="font-medium text-text-primary">Message Content Intent</b> (Privileged Gateway Intents) or the bot
          cannot read messages.
        </li>
        <li>
          Click <b className="font-medium text-text-primary">Reset Token</b> and paste it in <i>Discord bot token</i> below.
        </li>
        <li>
          Invite it: <b className="font-medium text-text-primary">OAuth2 → URL Generator</b>, scopes <code className="font-mono text-xs">bot</code> and{' '}
          <code className="font-mono text-xs">applications.commands</code>, permissions Send Messages, Read Message History, Attach Files
          and Use Slash Commands. Open the URL and pick your server.
        </li>
        <li>
          Your user ID: Discord settings → Advanced → Developer Mode, then right-click your name → Copy User ID. Put it in{' '}
          <i>Allowed users</i> so only you (and who you list) can talk to it.
        </li>
      </ol>
    </details>
  );
}

function GuidedOffer({
  title,
  body,
  replaces,
  onStart,
}: {
  title: string;
  body: string;
  replaces: boolean;
  onStart: () => void;
}) {
  return (
    <Card className="flex items-start gap-3 px-4 py-3.5">
      <QrIcon className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-text-primary">{title}</p>
        <p className="mt-0.5 text-xs text-text-secondary">
          {body}
          {replaces ? ' It replaces the current setup.' : ''} Or fill in the fields below by hand.
        </p>
      </div>
      <button
        type="button"
        onClick={async () => {
          if (replaces) {
            const ok = await confirmDialog({
              title: 'Replace the current setup?',
              description: 'This channel is already set up. Finishing the QR flow overwrites its saved credentials.',
              confirmLabel: 'Continue',
            });
            if (!ok) return;
          }
          onStart();
        }}
        className="yu-btn yu-btn-tonal h-8 shrink-0 rounded-lg px-3 text-xs"
      >
        Start
      </button>
    </Card>
  );
}

/** Polls `fn` every `ms` while `active`; stops on unmount. */
function usePoll(active: boolean, ms: number, fn: () => Promise<void>) {
  const saved = useRef(fn);
  useEffect(() => {
    saved.current = fn;
  });
  useEffect(() => {
    if (!active) return;
    let stop = false;
    let timer = 0;
    const tick = async () => {
      try {
        await saved.current();
      } finally {
        if (!stop) timer = window.setTimeout(() => void tick(), ms);
      }
    };
    timer = window.setTimeout(() => void tick(), ms);
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [active, ms]);
}

function TelegramSetup({ onDone, onCancel }: { onDone: (result: RestartResult) => void; onCancel: () => void }) {
  const [botName, setBotName] = useState('Hermes Agent');
  const [pairing, setPairing] = useState<{ id: string; link: string; qr: string; username: string } | null>(null);
  const [ready, setReady] = useState<{ username: string | null; owner: string | null } | null>(null);
  const [users, setUsers] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  usePoll(pairing !== null && ready === null && error === null, 2_000, async () => {
    if (pairing === null) return;
    try {
      const status = await pollTelegramSetup(pairing.id);
      if (status.status === 'ready') {
        setReady({ username: status.bot_username ?? null, owner: status.owner_user_id ?? null });
        if (status.owner_user_id) setUsers(status.owner_user_id);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Telegram setup failed.');
    }
  });

  const cancel = () => {
    if (pairing !== null) void cancelTelegramSetup(pairing.id).catch(() => undefined);
    onCancel();
  };

  return (
    <Card className="space-y-3.5 px-4 py-4">
      {pairing === null ? (
        <>
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-text-primary">Bot name</span>
            <input value={botName} onChange={(event) => setBotName(event.target.value)} className="yu-input h-10 w-full px-3 text-[13px]" />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              className="yu-btn yu-btn-primary h-9 rounded-xl px-4 text-[13px]"
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  const started = await startTelegramSetup(botName.trim() || 'Hermes Agent');
                  setPairing({ id: started.pairing_id, link: started.deep_link, qr: started.qr_payload || started.deep_link, username: started.suggested_username });
                } catch (caught) {
                  setError(caught instanceof Error ? caught.message : 'Could not start the Telegram setup.');
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Starting…' : 'Get QR code'}
            </button>
            <button type="button" onClick={cancel} className="yu-btn yu-btn-ghost h-9 rounded-xl px-3.5 text-[13px]">
              Cancel
            </button>
          </div>
        </>
      ) : ready === null ? (
        <div className="flex flex-col items-center gap-3 text-center">
          <QrCode value={pairing.qr} label="Telegram setup QR code" />
          <p className="text-[13px] text-text-secondary">
            Scan with your phone camera, or{' '}
            <a href={pairing.link} target="_blank" rel="noreferrer" className="text-text-primary underline-offset-2 hover:underline">
              open the link
            </a>{' '}
            on a device with Telegram. Follow the steps there{pairing.username ? ` to create @${pairing.username}` : ''}.
          </p>
          {error === null ? <p className="text-xs text-text-tertiary">Waiting for Telegram…</p> : null}
          <button type="button" onClick={cancel} className="yu-btn yu-btn-ghost h-8 rounded-lg px-3 text-xs">
            Cancel
          </button>
        </div>
      ) : (
        <>
          <p className="flex items-center gap-2 text-[13px] text-text-primary">
            <CircleCheck className="size-4 text-success" aria-hidden /> Bot {ready.username ? `@${ready.username}` : ''} created.
          </p>
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-text-primary">Who can talk to it</span>
            <input
              value={users}
              onChange={(event) => setUsers(event.target.value)}
              placeholder="123456789, 987654321"
              className="yu-input h-10 w-full px-3 font-mono text-[13px]"
            />
            <span className="mt-1 block text-xs text-text-tertiary">Numeric Telegram user IDs, comma separated. Yours is filled in.</span>
          </label>
          <button
            type="button"
            disabled={busy || users.trim() === ''}
            className="yu-btn yu-btn-primary h-9 rounded-xl px-4 text-[13px]"
            onClick={async () => {
              setBusy(true);
              try {
                const ids = users.split(',').map((part) => part.trim()).filter((part) => part !== '');
                onDone(await applyTelegramSetup(pairing.id, ids));
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : 'Could not save the bot.');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Saving…' : 'Save and connect'}
          </button>
        </>
      )}
      {error !== null ? <ErrorNote message={error} /> : null}
    </Card>
  );
}

const WA_WAITING: WhatsAppSetup['status'][] = ['installing', 'starting', 'waiting'];

function WhatsAppSetupFlow({ onDone, onCancel }: { onDone: (result: RestartResult) => void; onCancel: () => void }) {
  const [mode, setMode] = useState<'bot' | 'self-chat'>('bot');
  const [users, setUsers] = useState('');
  const [session, setSession] = useState<WhatsAppSetup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  usePoll(session !== null && WA_WAITING.includes(session.status), 2_000, async () => {
    if (session === null) return;
    try {
      setSession(await pollWhatsAppSetup(session.pairing_id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'WhatsApp setup failed.');
      setSession((current) => (current === null ? current : { ...current, status: 'error' }));
    }
  });

  const cancel = () => {
    if (session !== null) void cancelWhatsAppSetup(session.pairing_id).catch(() => undefined);
    onCancel();
  };
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      setSession(await startWhatsAppSetup(mode, users.trim()));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start the WhatsApp setup.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-3.5 px-4 py-4">
      {session === null ? (
        <>
          <div>
            <p className="mb-1.5 text-[13px] font-medium text-text-primary">Which number</p>
            <Segmented
              label="WhatsApp mode"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'bot', label: 'A separate number' },
                { value: 'self-chat', label: 'My own number' },
              ]}
            />
            <p className="mt-1.5 text-xs text-text-tertiary">
              {mode === 'bot'
                ? 'People message that number to reach Hermes.'
                : 'You talk to Hermes in “Message yourself” on your own WhatsApp.'}
            </p>
          </div>
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-text-primary">Who can talk to it (optional)</span>
            <input
              value={users}
              onChange={(event) => setUsers(event.target.value)}
              placeholder="5511999998888, 5511988887777"
              className="yu-input h-10 w-full px-3 font-mono text-[13px]"
            />
            <span className="mt-1 block text-xs text-text-tertiary">Phone numbers with country code, comma separated.</span>
          </label>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => void start()} className="yu-btn yu-btn-primary h-9 rounded-xl px-4 text-[13px]">
              {busy ? 'Starting…' : 'Get QR code'}
            </button>
            <button type="button" onClick={cancel} className="yu-btn yu-btn-ghost h-9 rounded-xl px-3.5 text-[13px]">
              Cancel
            </button>
          </div>
        </>
      ) : session.status === 'connected' ? (
        <>
          <p className="flex items-center gap-2 text-[13px] text-text-primary">
            <CircleCheck className="size-4 text-success" aria-hidden /> Linked
            {session.account_name ? ` to ${session.account_name}` : ''}
            {session.account_phone ? ` (+${session.account_phone})` : ''}.
          </p>
          <button
            type="button"
            disabled={busy}
            className="yu-btn yu-btn-primary h-9 rounded-xl px-4 text-[13px]"
            onClick={async () => {
              setBusy(true);
              try {
                onDone(await applyWhatsAppSetup(session.pairing_id, { mode: session.mode, allowed_users: session.allowed_users }));
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : 'Could not save WhatsApp.');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Saving…' : 'Save and connect'}
          </button>
        </>
      ) : WA_WAITING.includes(session.status) ? (
        <div className="flex flex-col items-center gap-3 text-center">
          {session.status === 'waiting' && session.qr_payload ? (
            <>
              <QrCode value={session.qr_payload} label="WhatsApp pairing QR code" />
              <p className="text-[13px] text-text-secondary">
                On the phone: WhatsApp → Settings → Linked devices → Link a device, then scan.
              </p>
            </>
          ) : (
            <p className="py-6 text-[13px] text-text-secondary">
              Preparing the WhatsApp bridge… The first time can take a minute while it installs.
            </p>
          )}
          <button type="button" onClick={cancel} className="yu-btn yu-btn-ghost h-8 rounded-lg px-3 text-xs">
            Cancel
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <ErrorNote message={session.error ?? error ?? `WhatsApp setup ${session.status}.`} />
          <div className="flex gap-2">
            <button type="button" onClick={() => setSession(null)} className="yu-btn yu-btn-tonal h-9 rounded-xl px-3.5 text-[13px]">
              Try again
            </button>
            <button type="button" onClick={cancel} className="yu-btn yu-btn-ghost h-9 rounded-xl px-3.5 text-[13px]">
              Cancel
            </button>
          </div>
        </div>
      )}
      {error !== null && session?.status !== 'error' ? <ErrorNote message={error} /> : null}
    </Card>
  );
}
