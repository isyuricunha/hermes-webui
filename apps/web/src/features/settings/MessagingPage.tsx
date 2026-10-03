import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
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
import {
  Badge,
  Card,
  ErrorNote,
  Section,
  Segmented,
  Sheet,
  SkeletonRows,
  StatusDot,
  Switch,
} from '../../components/ui';
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
  api_server: 'settings.messaging.lockedApiServer',
};
/** Managed on their own page. */
const ELSEWHERE = new Set(['webhook']);

type Tone = 'success' | 'warning' | 'danger' | 'neutral';

type TFunc = ReturnType<typeof useTranslation>['t'];

function stateInfo(
  platform: Pick<MessagingPlatform, 'state' | 'enabled' | 'configured' | 'plugin'>,
  t: TFunc,
): {
  label: string;
  tone: Tone;
} {
  // The adapter plugin wins: while it is off the gateway never loads the channel.
  if (platform.enabled && platform.plugin && !platform.plugin.enabled)
    return { label: t('settings.messaging.state.pluginOff'), tone: 'warning' };
  const state = platform.state ?? '';
  switch (state) {
    case 'connected':
      return { label: t('settings.messaging.state.connected'), tone: 'success' };
    case 'pending_restart':
      return { label: t('settings.messaging.state.restartToApply'), tone: 'warning' };
    case 'disabled':
      return {
        label: platform.configured
          ? t('settings.messaging.state.off')
          : t('settings.messaging.state.notSetUp'),
        tone: 'neutral',
      };
    case 'not_configured':
      return { label: t('settings.messaging.state.needsSetup'), tone: 'warning' };
    case 'gateway_stopped':
      return { label: t('settings.messaging.state.gatewayStopped'), tone: 'warning' };
    case 'startup_failed':
    case 'fatal':
    case 'error':
    case 'failed':
      return { label: t('settings.messaging.state.error'), tone: 'danger' };
    case 'connecting':
    case 'reconnecting':
    case 'retrying':
    case 'starting':
      return { label: t('settings.messaging.state.connecting'), tone: 'warning' };
    default:
      return {
        label: state === '' ? t('settings.messaging.state.unknown') : state.replace(/_/g, ' '),
        tone: 'neutral',
      };
  }
}

/** Restart the gateway, then refresh channel states until they settle. */
function useGatewayRestart() {
  const { t } = useTranslation();
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
      toast(t('settings.messaging.restartingGateway'), 'success');
      watch();
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (error) => toastError(error),
  });
  const ask = async (reason?: string) => {
    const ok = await confirmDialog({
      title: t('settings.messaging.restartTitle'),
      description: `${reason ?? t('settings.messaging.restartDefaultReason')} ${t('settings.messaging.restartDesc')}`,
      confirmLabel: t('settings.messaging.restart'),
    });
    if (ok) restart.mutate();
  };
  return { ask, watch, watching, pending: restart.isPending };
}

function afterRestartResult(
  result: RestartResult,
  what: string,
  gateway: ReturnType<typeof useGatewayRestart>,
  t: TFunc,
) {
  if (result.restart_started === true) {
    toast(t('settings.messaging.savedRestarting', { what }), 'success');
    gateway.watch();
  } else {
    toast(t('settings.messaging.savedRestartLater', { what }), 'success');
  }
}

export function MessagingPage() {
  const { t } = useTranslation();
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
      : available.filter((p) =>
          `${p.name} ${p.id} ${p.description}`.toLowerCase().includes(needle),
        );
  const pendingRestart = platforms.filter((p) => p.state === 'pending_restart');
  const gatewayRunning = platforms.some((p) => p.gateway_running);
  const open = platforms.find((p) => p.id === openId) ?? null;

  return (
    <SettingsPage
      title={t('settings.messaging.title')}
      description={t('settings.messaging.description')}
      actions={
        <button
          type="button"
          onClick={() => void gateway.ask()}
          disabled={gateway.pending}
          className="yu-btn yu-btn-tonal h-8 gap-1.5 rounded-lg px-3 text-xs"
          data-tip={t('settings.messaging.restartTip')}
        >
          <RotateCw
            className={['size-3.5', gateway.pending || gateway.watching ? 'animate-spin' : ''].join(
              ' ',
            )}
            aria-hidden
          />
          {t('settings.messaging.restartGateway')}
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
            <div
              role="status"
              className="yu-chip-warning mb-4 flex flex-wrap items-center gap-2.5 rounded-2xl px-3.5 py-3 text-[13px]"
            >
              <span className="min-w-0 flex-1">{t('settings.messaging.gatewayDown')}</span>
              <button
                type="button"
                onClick={() =>
                  void startGateway().then(
                    () => {
                      toast(t('settings.messaging.startingGateway'), 'success');
                      gateway.watch();
                    },
                    (error: unknown) => toastError(error),
                  )
                }
                className="yu-btn yu-btn-primary h-7 rounded-lg px-2.5 text-xs"
              >
                {t('settings.messaging.startGateway')}
              </button>
            </div>
          ) : pendingRestart.length > 0 ? (
            <div
              role="status"
              className="yu-chip-warning mb-4 flex flex-wrap items-center gap-2.5 rounded-2xl px-3.5 py-3 text-[13px]"
            >
              <span className="min-w-0 flex-1">
                {t('settings.messaging.pendingRestart', {
                  names: pendingRestart.map((p) => p.name).join(', '),
                  verb:
                    pendingRestart.length === 1
                      ? t('settings.messaging.has')
                      : t('settings.messaging.have'),
                })}
              </span>
              <button
                type="button"
                onClick={() => void gateway.ask()}
                disabled={gateway.pending}
                className="yu-btn yu-btn-primary h-7 rounded-lg px-2.5 text-xs"
              >
                {t('settings.messaging.restartNow')}
              </button>
            </div>
          ) : null}

          <Section
            title={t('settings.messaging.yourChannels')}
            description={t('settings.messaging.yourChannelsDesc')}
          >
            {active.length === 0 ? (
              <p className="text-[13px] text-text-secondary">
                {t('settings.messaging.noChannelYet')}
              </p>
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
            title={t('settings.messaging.addChannel')}
            description={t('settings.messaging.morePlatforms', { count: available.length })}
            actions={
              <label className="yu-input flex h-8 w-44 items-center gap-1.5 px-2.5 sm:w-56">
                <Search className="size-3.5 shrink-0 text-text-tertiary" aria-hidden />
                <input
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder={t('settings.messaging.findPlatform')}
                  aria-label={t('settings.messaging.findPlatform')}
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
              {shown.length === 0 ? (
                <li className="text-[13px] text-text-secondary">
                  {t('settings.messaging.nothingMatches', { filter })}
                </li>
              ) : null}
            </ul>
          </Section>
        </>
      )}
      {open !== null ? (
        <PlatformSheet platform={open} gateway={gateway} onClose={() => setOpenId(null)} />
      ) : null}
    </SettingsPage>
  );
}

/**
 * Pairing: someone messages a bot they are not allowed on yet, Hermes gives
 * them a one-time code and lists the request here. Approving adds them to the
 * channel's approved users (and its allowlist when one is set).
 */
function PairingSection({ platforms }: { platforms: MessagingPlatform[] }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const pairing = useQuery({
    queryKey: ['pairing'],
    queryFn: fetchPairing,
    refetchInterval: 15_000,
  });
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
  const connected = platforms.filter(
    (p) => p.enabled && p.configured && !['api_server', 'webhook'].includes(p.id),
  );
  const pending = pairing.data?.pending ?? [];
  const approved = pairing.data?.approved ?? [];
  if (pairing.isError) return null;

  return (
    <Section
      title={t('settings.messaging.accessRequests')}
      description={t('settings.messaging.accessRequestsDesc')}
      actions={
        pending.length > 1 ? (
          <button
            type="button"
            onClick={async () => {
              const ok = await confirmDialog({
                title: t('settings.messaging.dismissAllTitle'),
                description: t('settings.messaging.dismissAllDesc'),
                confirmLabel: t('settings.messaging.dismissAll'),
                tone: 'danger',
              });
              if (ok) act(clearPendingPairing(), t('settings.messaging.requestsDismissed'));
            }}
            className="yu-btn yu-btn-ghost h-7 rounded-lg px-2.5 text-xs text-text-secondary"
          >
            {t('settings.messaging.dismissAll')}
          </button>
        ) : undefined
      }
    >
      <Card>
        {pending.length === 0 && approved.length === 0 ? (
          <p className="px-4 py-3.5 text-[13px] text-text-secondary">
            {t('settings.messaging.noRequests')}
          </p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {pending.map((request) => (
              <li
                key={`${request.platform}:${request.request_id || request.user_id}`}
                className="flex flex-wrap items-center gap-3 px-4 py-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-text-primary">
                    {request.user_name || request.user_id}
                    <Badge tone="warning">{t('settings.messaging.waiting')}</Badge>
                    <Badge>{nameOf(request.platform)}</Badge>
                  </span>
                  <span className="block font-mono text-[11px] text-text-tertiary">
                    {request.user_id} ·{' '}
                    {request.age_minutes < 1
                      ? t('settings.messaging.justNow')
                      : t('settings.messaging.minAgo', { count: request.age_minutes })}
                  </span>
                </span>
                {request.request_id ? (
                  <button
                    type="button"
                    onClick={() =>
                      act(
                        approvePairing(request.platform, { request_id: request.request_id }),
                        t('settings.messaging.userApproved', {
                          name: request.user_name || request.user_id,
                        }),
                      )
                    }
                    className="yu-btn yu-btn-primary h-8 gap-1.5 rounded-lg px-3 text-xs"
                  >
                    <UserCheck className="size-3.5" aria-hidden /> {t('settings.messaging.approve')}
                  </button>
                ) : (
                  <span className="text-xs text-text-tertiary">
                    {t('settings.messaging.approveWithCode')}
                  </span>
                )}
              </li>
            ))}
            {approved.map((user) => (
              <li
                key={`${user.platform}:${user.user_id}`}
                className="flex flex-wrap items-center gap-3 px-4 py-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 text-[13px] text-text-primary">
                    {user.user_name || user.user_id}
                    <Badge tone="success">{t('settings.messaging.approved')}</Badge>
                    <Badge>{nameOf(user.platform)}</Badge>
                  </span>
                  <span className="block font-mono text-[11px] text-text-tertiary">
                    {user.user_id}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await confirmDialog({
                      title: t('settings.messaging.removeUserTitle', {
                        name: user.user_name || user.user_id,
                      }),
                      description: t('settings.messaging.removeUserDesc', {
                        platform: nameOf(user.platform),
                      }),
                      confirmLabel: t('settings.messaging.removeAccess'),
                      tone: 'danger',
                    });
                    if (ok)
                      act(
                        revokePairing(user.platform, user.user_id),
                        t('settings.messaging.accessRemoved'),
                      );
                  }}
                  className="yu-btn yu-btn-ghost h-8 gap-1.5 rounded-lg px-2.5 text-xs text-text-secondary"
                >
                  <UserX className="size-3.5" aria-hidden /> {t('settings.messaging.remove')}
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
              act(
                approvePairing(platform, { code: code.trim() }),
                t('settings.messaging.codeAccepted'),
              );
              setCode('');
            }}
          >
            <span className="text-xs text-text-secondary">{t('settings.messaging.gotCode')}</span>
            {connected.length > 1 ? (
              <span
                className="flex flex-wrap gap-1"
                role="radiogroup"
                aria-label={t('settings.messaging.channelOfCode')}
              >
                {connected.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={(codePlatform || connected[0]!.id) === p.id}
                    onClick={() => setCodePlatform(p.id)}
                    className={[
                      'yu-chip',
                      (codePlatform || connected[0]!.id) === p.id ? 'yu-chip-accent' : '',
                    ].join(' ')}
                  >
                    {p.name}
                  </button>
                ))}
              </span>
            ) : null}
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder={t('settings.messaging.codePlaceholder')}
              aria-label={t('settings.messaging.pairingCode')}
              className="yu-input h-8 w-32 px-2.5 font-mono text-[13px] uppercase"
            />
            <button
              type="submit"
              disabled={code.trim() === ''}
              className="yu-btn yu-btn-tonal h-8 rounded-lg px-3 text-xs"
            >
              {t('settings.messaging.approve')}
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
  const { t } = useTranslation();
  const info = stateInfo(platform, t);
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
          <span className="mt-0.5 block line-clamp-2 text-xs text-danger">
            {platform.error_message}
          </span>
        ) : platform.description ? (
          <span className="mt-0.5 block line-clamp-1 text-xs text-text-secondary">
            {platform.description}
          </span>
        ) : null}
      </span>
      <ChevronRight
        className="size-4 shrink-0 text-text-tertiary transition-transform group-hover:translate-x-0.5"
        aria-hidden
      />
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
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const info = stateInfo(platform, t);
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
    (field) =>
      field.required &&
      (!field.is_set || clear.has(field.key)) &&
      (values[field.key] ?? '').trim() === '',
  );
  const pluginOff =
    platform.plugin !== undefined && platform.plugin !== null && !platform.plugin.enabled;
  const dirty =
    edited.length > 0 || clear.size > 0 || enabled !== platform.enabled || (enabled && pluginOff);
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
        toast(t('settings.messaging.platformSavedRestart', { name: platform.name }), 'success');
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
          {platform.home_channel?.name
            ? t('settings.messaging.homeLabel', { name: platform.home_channel.name })
            : ''}
        </span>
      }
    >
      <div className="space-y-5">
        {platform.description ? (
          <p className="text-[13px] text-text-secondary">{platform.description}</p>
        ) : null}

        {platform.error_message ? (
          <div role="alert" className="yu-chip-danger rounded-2xl px-3.5 py-3 text-[13px]">
            <p className="font-medium">{platform.error_code ?? t('settings.messaging.error')}</p>
            <p className="mt-0.5 break-words">{platform.error_message}</p>
          </div>
        ) : null}

        {pluginOff && locked === undefined ? (
          <div
            role="status"
            className="yu-chip-warning flex flex-wrap items-center gap-2.5 rounded-2xl px-3.5 py-3 text-[13px]"
          >
            <span className="min-w-0 flex-1">
              {t('settings.messaging.pluginOffNote1', { name: platform.name })}(
              <code className="font-mono text-xs">{platform.plugin!.name}</code>)
              {t('settings.messaging.pluginOffNote2', { name: platform.name })}
            </span>
            <button
              type="button"
              onClick={() =>
                void setAgentPluginEnabled(platform.plugin!.name, true).then(
                  () => {
                    void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
                    void gateway.ask(
                      t('settings.messaging.pluginOnReason', { name: platform.name }),
                    );
                  },
                  (error: unknown) => toastError(error),
                )
              }
              className="yu-btn yu-btn-primary h-7 rounded-lg px-2.5 text-xs"
            >
              {t('settings.messaging.turnPluginOn')}
            </button>
          </div>
        ) : null}
        {locked !== undefined ? (
          <Card className="px-4 py-3 text-[13px] text-text-secondary">{t(locked)}</Card>
        ) : null}
        {elsewhere ? (
          <Link
            to="/settings/webhooks"
            className="yu-btn yu-btn-tonal h-9 gap-1.5 rounded-xl px-3.5 text-[13px]"
            onClick={onClose}
          >
            {t('settings.messaging.manageWebhooks')}{' '}
            <ArrowUpRight className="size-3.5" aria-hidden />
          </Link>
        ) : null}

        {platform.id === 'discord' ? <DiscordGuide /> : null}

        {platform.id === 'telegram' && guided !== 'telegram' ? (
          <GuidedOffer
            title={t('settings.messaging.guidedTelegramTitle')}
            body={t('settings.messaging.guidedTelegramBody')}
            replaces={platform.configured}
            onStart={() => setGuided('telegram')}
          />
        ) : null}
        {platform.id === 'whatsapp' && guided !== 'whatsapp' ? (
          <GuidedOffer
            title={t('settings.messaging.guidedWhatsappTitle')}
            body={t('settings.messaging.guidedWhatsappBody')}
            replaces={platform.configured}
            onStart={() => setGuided('whatsapp')}
          />
        ) : null}
        {guided === 'telegram' ? (
          <TelegramSetup
            onDone={(result) => {
              setGuided(null);
              afterRestartResult(result, t('settings.messaging.telegramBot'), gateway, t);
              void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
            }}
            onCancel={() => setGuided(null)}
          />
        ) : null}
        {guided === 'whatsapp' ? (
          <WhatsAppSetupFlow
            onDone={(result) => {
              setGuided(null);
              afterRestartResult(result, t('settings.messaging.whatsapp'), gateway, t);
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
                  {t('settings.messaging.advancedCount', { count: advanced.length })}
                </summary>
                <div className="mt-3 space-y-3.5">
                  {advanced.map((field) => (
                    <EnvField
                      key={field.key}
                      field={field}
                      value={values[field.key] ?? ''}
                      clearing={clear.has(field.key)}
                      onChange={(value) =>
                        setValues((current) => ({ ...current, [field.key]: value }))
                      }
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
                <p className="text-[13px] font-medium text-text-primary">
                  {t('settings.messaging.turnOnName', { name: platform.name })}
                </p>
                <p className="text-xs text-text-tertiary">
                  {enabled
                    ? t('settings.messaging.turnOnExplain')
                    : t('settings.messaging.turnOffExplain')}
                </p>
              </div>
              <Switch
                label={t('settings.messaging.turnOnName', { name: platform.name })}
                checked={enabled}
                onChange={setEnabled}
              />
            </div>

            {enabled && missing.length > 0 && dirty ? (
              <p className="text-xs text-warning">
                {t('settings.messaging.fillInToTurnOn', {
                  fields: missing.map((field) => field.prompt).join(', '),
                })}
              </p>
            ) : null}

            {testResult !== null ? (
              <div
                role="status"
                className={[
                  'flex items-start gap-2 rounded-2xl px-3.5 py-2.5 text-[13px]',
                  testResult.ok ? 'yu-chip-success' : 'yu-chip-warning',
                ].join(' ')}
              >
                {testResult.ok ? (
                  <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
                ) : (
                  <PlugZap className="mt-0.5 size-4 shrink-0" aria-hidden />
                )}
                <span className="min-w-0 flex-1 break-words">{testResult.message}</span>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="submit"
                disabled={!canSave}
                className="yu-btn yu-btn-primary h-9 rounded-xl px-4 text-[13px]"
              >
                {save.isPending
                  ? t('settings.messaging.saving')
                  : t('settings.messaging.saveAndRestart')}
              </button>
              <button
                type="button"
                disabled={!canSave}
                onClick={() => save.mutate(false)}
                className="yu-btn yu-btn-tonal h-9 rounded-xl px-3.5 text-[13px]"
                data-tip={t('settings.messaging.saveOnlyTip')}
              >
                {t('settings.messaging.saveOnly')}
              </button>
              <button
                type="button"
                disabled={test.isPending || dirty}
                onClick={() => test.mutate()}
                className="yu-btn yu-btn-ghost h-9 gap-1.5 rounded-xl px-3 text-[13px]"
                data-tip={
                  dirty ? t('settings.messaging.testFirstTip') : t('settings.messaging.testTip')
                }
              >
                <PlugZap className="size-4" aria-hidden />
                {test.isPending ? t('settings.messaging.testing') : t('settings.messaging.test')}
              </button>
              {platform.docs_url ? (
                <a
                  href={platform.docs_url}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary"
                >
                  {t('settings.messaging.docs')} <ArrowUpRight className="size-3" aria-hidden />
                </a>
              ) : null}
            </div>
          </form>
        ) : null}

        {locked === undefined && guided === null && platform.env_vars.length === 0 && !elsewhere ? (
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-surface-input/40 px-3.5 py-3">
            <p className="text-[13px] text-text-secondary">
              {t('settings.messaging.nothingToFill')}
            </p>
            <Switch
              label={t('settings.messaging.turnOnName', { name: platform.name })}
              checked={platform.enabled}
              onChange={(next) =>
                void updateMessagingPlatform(platform.id, { enabled: next }).then(
                  () => {
                    void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
                    void gateway.ask(
                      t('settings.messaging.turnedState', {
                        name: platform.name,
                        state: next
                          ? t('settings.messaging.onWord')
                          : t('settings.messaging.offWord'),
                      }),
                    );
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
  const { t } = useTranslation();
  const id = `env-${field.key}`;
  const saved = field.is_set && !clearing;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[13px] font-medium text-text-primary">
          {field.prompt}
          {field.required ? (
            <span className="ml-0.5 text-danger" aria-hidden>
              *
            </span>
          ) : null}
        </label>
        <span className="flex items-center gap-2">
          {field.is_set ? (
            clearing ? (
              <button
                type="button"
                onClick={() => onClear(false)}
                className="inline-flex items-center gap-1 text-[11.5px] text-warning hover:underline"
              >
                <Undo2 className="size-3" aria-hidden /> {t('settings.messaging.willBeRemoved')}
              </button>
            ) : (
              <>
                <Badge tone="success">{t('settings.messaging.savedBadge')}</Badge>
                <button
                  type="button"
                  onClick={() => onClear(true)}
                  className="inline-flex items-center text-[11.5px] text-text-tertiary hover:text-danger"
                  aria-label={t('settings.messaging.removeField', { name: field.prompt })}
                  data-tip={t('settings.messaging.removeSavedTip')}
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
        placeholder={
          saved
            ? t('settings.messaging.envSaved', {
                redacted: field.redacted_value ? ` (${field.redacted_value})` : '',
              })
            : ''
        }
        className="yu-input h-10 w-full px-3 font-mono text-[13px] disabled:opacity-50"
      />
      {field.description || field.help || field.url ? (
        <p className="mt-1 text-xs text-text-tertiary">
          {field.description}
          {field.help && field.help !== field.description ? ` ${field.help}` : ''}
          {field.url ? (
            <>
              {' '}
              <a
                href={field.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center text-text-secondary underline-offset-2 hover:underline"
              >
                {t('settings.messaging.openLink')} <ArrowUpRight className="size-3" aria-hidden />
              </a>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

function HomeChannel({ platform }: { platform: MessagingPlatform }) {
  const { t } = useTranslation();
  const home = platform.home_channel;
  const command = platform.id === 'slack' ? '/hermes sethome' : '/sethome';
  return (
    <div className="flex items-start gap-2.5 rounded-2xl bg-surface-input/40 px-3.5 py-3 text-[13px]">
      <Home className="mt-0.5 size-4 shrink-0 text-text-tertiary" aria-hidden />
      <p className="min-w-0 flex-1 text-text-secondary">
        {home?.name || home?.chat_id ? (
          <>
            {t('settings.messaging.homeChannelLabel')}
            <span className="text-text-primary">{home.name || home.chat_id}</span>
            {t('settings.messaging.homeChannelRest')}
          </>
        ) : (
          <>{t('settings.messaging.noHomeChannel')}</>
        )}{' '}
        {t('settings.messaging.homeSend')}
        <code className="font-mono text-xs text-text-primary">{command}</code>
        {t('settings.messaging.homeSendRest')}
      </p>
    </div>
  );
}

function DiscordGuide() {
  const { t } = useTranslation();
  return (
    <details className="yu-card rounded-2xl px-4 py-3" open>
      <summary className="cursor-pointer select-none text-[13px] font-medium text-text-primary">
        {t('settings.messaging.dgSummary')}
      </summary>
      <ol className="mt-2.5 list-decimal space-y-1.5 pl-5 text-[13px] text-text-secondary marker:text-text-tertiary">
        <li>
          {t('settings.messaging.dg1a')}{' '}
          <a
            href="https://discord.com/developers/applications"
            target="_blank"
            rel="noreferrer"
            className="text-text-primary underline-offset-2 hover:underline"
          >
            {t('settings.messaging.dgPortal')}
          </a>
          {t('settings.messaging.dg1b')}{' '}
          <b className="font-medium text-text-primary">{t('settings.messaging.dgBot')}</b>
          {t('settings.messaging.dg1c')}
        </li>
        <li>
          {t('settings.messaging.dg2a')}{' '}
          <b className="font-medium text-text-primary">{t('settings.messaging.dg2Intent')}</b>
          {t('settings.messaging.dg2b')}
        </li>
        <li>
          {t('settings.messaging.dg3a')}{' '}
          <b className="font-medium text-text-primary">{t('settings.messaging.dg3Reset')}</b>
          {t('settings.messaging.dg3b')} <i>{t('settings.messaging.dg3Token')}</i>
          {t('settings.messaging.dg3c')}
        </li>
        <li>
          {t('settings.messaging.dg4a')}{' '}
          <b className="font-medium text-text-primary">{t('settings.messaging.dg4Generator')}</b>
          {t('settings.messaging.dg4b')} <code className="font-mono text-xs">bot</code>
          {t('settings.messaging.dg4c')}{' '}
          <code className="font-mono text-xs">applications.commands</code>
          {t('settings.messaging.dg4d')}
        </li>
        <li>
          {t('settings.messaging.dg5a')} <i>{t('settings.messaging.dg5Allowed')}</i>
          {t('settings.messaging.dg5b')}
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
  const { t } = useTranslation();
  return (
    <Card className="flex items-start gap-3 px-4 py-3.5">
      <QrIcon className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-text-primary">{title}</p>
        <p className="mt-0.5 text-xs text-text-secondary">
          {body}
          {replaces ? t('settings.messaging.replacesSetup') : ''}
          {t('settings.messaging.orFillIn')}
        </p>
      </div>
      <button
        type="button"
        onClick={async () => {
          if (replaces) {
            const ok = await confirmDialog({
              title: t('settings.messaging.replaceTitle'),
              description: t('settings.messaging.replaceDesc'),
              confirmLabel: t('settings.messaging.continue'),
            });
            if (!ok) return;
          }
          onStart();
        }}
        className="yu-btn yu-btn-tonal h-8 shrink-0 rounded-lg px-3 text-xs"
      >
        {t('settings.messaging.start')}
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

function TelegramSetup({
  onDone,
  onCancel,
}: {
  onDone: (result: RestartResult) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [botName, setBotName] = useState('Hermes Agent');
  const [pairing, setPairing] = useState<{
    id: string;
    link: string;
    qr: string;
    username: string;
  } | null>(null);
  const [ready, setReady] = useState<{ username: string | null; owner: string | null } | null>(
    null,
  );
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
      setError(
        caught instanceof Error ? caught.message : t('settings.messaging.telegramSetupFailed'),
      );
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
            <span className="mb-1 block text-[13px] font-medium text-text-primary">
              {t('settings.messaging.botName')}
            </span>
            <input
              value={botName}
              onChange={(event) => setBotName(event.target.value)}
              className="yu-input h-10 w-full px-3 text-[13px]"
            />
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
                  setPairing({
                    id: started.pairing_id,
                    link: started.deep_link,
                    qr: started.qr_payload || started.deep_link,
                    username: started.suggested_username,
                  });
                } catch (caught) {
                  setError(
                    caught instanceof Error
                      ? caught.message
                      : t('settings.messaging.couldNotStartTelegram'),
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? t('settings.messaging.starting') : t('settings.messaging.getQrCode')}
            </button>
            <button
              type="button"
              onClick={cancel}
              className="yu-btn yu-btn-ghost h-9 rounded-xl px-3.5 text-[13px]"
            >
              {t('settings.messaging.cancel')}
            </button>
          </div>
        </>
      ) : ready === null ? (
        <div className="flex flex-col items-center gap-3 text-center">
          <QrCode value={pairing.qr} label={t('settings.messaging.tgQrLabel')} />
          <p className="text-[13px] text-text-secondary">
            {t('settings.messaging.tgScan1')}
            <a
              href={pairing.link}
              target="_blank"
              rel="noreferrer"
              className="text-text-primary underline-offset-2 hover:underline"
            >
              {t('settings.messaging.tgScanOpen')}
            </a>
            {t('settings.messaging.tgScan2')}
            {pairing.username
              ? t('settings.messaging.tgScanTo', { username: pairing.username })
              : ''}
            {t('settings.messaging.tgScanPeriod')}
          </p>
          {error === null ? (
            <p className="text-xs text-text-tertiary">{t('settings.messaging.tgWaiting')}</p>
          ) : null}
          <button
            type="button"
            onClick={cancel}
            className="yu-btn yu-btn-ghost h-8 rounded-lg px-3 text-xs"
          >
            {t('settings.messaging.cancel')}
          </button>
        </div>
      ) : (
        <>
          <p className="flex items-center gap-2 text-[13px] text-text-primary">
            <CircleCheck className="size-4 text-success" aria-hidden />{' '}
            {t('settings.messaging.tgBotCreated', {
              name: ready.username ? `@${ready.username}` : '',
            })}
          </p>
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-text-primary">
              {t('settings.messaging.whoCanTalk')}
            </span>
            <input
              value={users}
              onChange={(event) => setUsers(event.target.value)}
              placeholder={t('settings.messaging.tgUsersPlaceholder')}
              className="yu-input h-10 w-full px-3 font-mono text-[13px]"
            />
            <span className="mt-1 block text-xs text-text-tertiary">
              {t('settings.messaging.tgUsersHint')}
            </span>
          </label>
          <button
            type="button"
            disabled={busy || users.trim() === ''}
            className="yu-btn yu-btn-primary h-9 rounded-xl px-4 text-[13px]"
            onClick={async () => {
              setBusy(true);
              try {
                const ids = users
                  .split(',')
                  .map((part) => part.trim())
                  .filter((part) => part !== '');
                onDone(await applyTelegramSetup(pairing.id, ids));
              } catch (caught) {
                setError(
                  caught instanceof Error
                    ? caught.message
                    : t('settings.messaging.couldNotSaveBot'),
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? t('settings.messaging.saving') : t('settings.messaging.saveAndConnect')}
          </button>
        </>
      )}
      {error !== null ? <ErrorNote message={error} /> : null}
    </Card>
  );
}

const WA_WAITING: WhatsAppSetup['status'][] = ['installing', 'starting', 'waiting'];

function WhatsAppSetupFlow({
  onDone,
  onCancel,
}: {
  onDone: (result: RestartResult) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
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
      setError(caught instanceof Error ? caught.message : t('settings.messaging.waSetupFailed'));
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
      setError(
        caught instanceof Error ? caught.message : t('settings.messaging.couldNotStartWhatsApp'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-3.5 px-4 py-4">
      {session === null ? (
        <>
          <div>
            <p className="mb-1.5 text-[13px] font-medium text-text-primary">
              {t('settings.messaging.whichNumber')}
            </p>
            <Segmented
              label={t('settings.messaging.waModeLabel')}
              value={mode}
              onChange={setMode}
              options={[
                { value: 'bot', label: t('settings.messaging.waNumberBot') },
                { value: 'self-chat', label: t('settings.messaging.waNumberOwn') },
              ]}
            />
            <p className="mt-1.5 text-xs text-text-tertiary">
              {mode === 'bot'
                ? t('settings.messaging.waExplainBot')
                : t('settings.messaging.waExplainOwn')}
            </p>
          </div>
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-text-primary">
              {t('settings.messaging.whoCanTalkOptional')}
            </span>
            <input
              value={users}
              onChange={(event) => setUsers(event.target.value)}
              placeholder={t('settings.messaging.waPhonePlaceholder')}
              className="yu-input h-10 w-full px-3 font-mono text-[13px]"
            />
            <span className="mt-1 block text-xs text-text-tertiary">
              {t('settings.messaging.waPhoneHint')}
            </span>
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void start()}
              className="yu-btn yu-btn-primary h-9 rounded-xl px-4 text-[13px]"
            >
              {busy ? t('settings.messaging.starting') : t('settings.messaging.getQrCode')}
            </button>
            <button
              type="button"
              onClick={cancel}
              className="yu-btn yu-btn-ghost h-9 rounded-xl px-3.5 text-[13px]"
            >
              {t('settings.messaging.cancel')}
            </button>
          </div>
        </>
      ) : session.status === 'connected' ? (
        <>
          <p className="flex items-center gap-2 text-[13px] text-text-primary">
            <CircleCheck className="size-4 text-success" aria-hidden />{' '}
            {t('settings.messaging.waLinked')}
            {session.account_name
              ? t('settings.messaging.waLinkedTo', { name: session.account_name })
              : ''}
            {session.account_phone
              ? t('settings.messaging.waLinkedPhone', { phone: session.account_phone })
              : ''}
            {t('settings.messaging.waLinkedPeriod')}
          </p>
          <button
            type="button"
            disabled={busy}
            className="yu-btn yu-btn-primary h-9 rounded-xl px-4 text-[13px]"
            onClick={async () => {
              setBusy(true);
              try {
                onDone(
                  await applyWhatsAppSetup(session.pairing_id, {
                    mode: session.mode,
                    allowed_users: session.allowed_users,
                  }),
                );
              } catch (caught) {
                setError(
                  caught instanceof Error
                    ? caught.message
                    : t('settings.messaging.couldNotSaveWhatsApp'),
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? t('settings.messaging.saving') : t('settings.messaging.saveAndConnect')}
          </button>
        </>
      ) : WA_WAITING.includes(session.status) ? (
        <div className="flex flex-col items-center gap-3 text-center">
          {session.status === 'waiting' && session.qr_payload ? (
            <>
              <QrCode value={session.qr_payload} label={t('settings.messaging.waQrLabel')} />
              <p className="text-[13px] text-text-secondary">
                {t('settings.messaging.waScanHint')}
              </p>
            </>
          ) : (
            <p className="py-6 text-[13px] text-text-secondary">
              {t('settings.messaging.waPreparing')}
            </p>
          )}
          <button
            type="button"
            onClick={cancel}
            className="yu-btn yu-btn-ghost h-8 rounded-lg px-3 text-xs"
          >
            {t('settings.messaging.cancel')}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <ErrorNote
            message={
              session.error ?? error ?? t('settings.messaging.waFailed', { status: session.status })
            }
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSession(null)}
              className="yu-btn yu-btn-tonal h-9 rounded-xl px-3.5 text-[13px]"
            >
              {t('settings.messaging.tryAgain')}
            </button>
            <button
              type="button"
              onClick={cancel}
              className="yu-btn yu-btn-ghost h-9 rounded-xl px-3.5 text-[13px]"
            >
              {t('settings.messaging.cancel')}
            </button>
          </div>
        </div>
      )}
      {error !== null && session?.status !== 'error' ? <ErrorNote message={error} /> : null}
    </Card>
  );
}
