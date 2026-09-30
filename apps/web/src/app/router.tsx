import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import type { RouterHistory } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryClient } from '../lib/query';
import { AUTH_REQUIRED_EVENT, authStateQuery } from '../lib/auth';
import { AppShell } from './AppShell';
import { ChatView } from '../features/chat/ChatView';
import { SettingsLayout } from '../features/settings/SettingsLayout';
import { ModelsPage } from '../features/settings/ModelsPage';
import { McpPage } from '../features/settings/McpPage';
import { SkillsPage } from '../features/settings/SkillsPage';
import { CronPage } from '../features/settings/CronPage';
import { MessagingPage } from '../features/settings/MessagingPage';
import { SystemPage } from '../features/settings/SystemPage';
import { RawConfigPage } from '../features/settings/RawConfigPage';
import { EnvPage } from '../features/settings/EnvPage';
import { CliPage } from '../features/settings/CliPage';
import { FieldDetailPage } from '../features/settings/FieldDetailPage';
import { AppearancePage } from '../features/settings/AppearancePage';
import { AboutPage } from '../features/settings/AboutPage';
import { UsagePage } from '../features/settings/UsagePage';
import { MemoryPage } from '../features/settings/MemoryPage';
import { ToolsPage } from '../features/settings/ToolsPage';
import { ProfilePage } from '../features/settings/ProfilePage';
import { WebhooksPage } from '../features/settings/WebhooksPage';
import { LogsPage } from '../features/settings/LogsPage';
import { RouteError } from '../components/RouteError';
import { LoginPage } from '../features/auth/LoginPage';
import { SetupPage } from '../features/auth/SetupPage';

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

/**
 * Public surfaces (Phase 1, spec 2.21): /login and /setup render without the
 * app shell. A listener re-runs protected loaders when a 401 happens later.
 */
function PublicAuthListener(): null {
  const queryClient = useQueryClient();
  useEffect(() => {
    const handler = () => {
      queryClient.removeQueries({ queryKey: ['auth-state'] });
      const next = window.location.pathname + window.location.search;
      window.location.assign(next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`);
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, handler);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, handler);
  }, [queryClient]);
  return null;
}

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: (search: Record<string, unknown>): { next?: string } => ({
    next: typeof search.next === 'string' ? search.next : undefined,
  }),
  component: () => (
    <>
      <PublicAuthListener />
      <LoginPage />
    </>
  ),
});

const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/setup',
  component: () => (
    <>
      <PublicAuthListener />
      <SetupPage />
    </>
  ),
});

/**
 * Protected layout (Phase 1, spec 2.20): before every protected route, the
 * auth state decides — unclaimed goes to /setup, signed out goes to
 * /login?next=… (same-origin paths only). Uses the router's own redirect so
 * browser Back/Forward and deep links keep working.
 */
const protectedLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'protected',
  beforeLoad: async () => {
    const state = await queryClient.ensureQueryData(authStateQuery);
    if (!state.claimed) {
      throw redirect({ to: '/setup' });
    }
    if (!state.authenticated) {
      const next = window.location.pathname + window.location.search;
      throw redirect({
        to: '/login',
        search: next === '/' ? {} : { next },
      });
    }
    return { auth: state };
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});

/** Chat is the home route (PRD 6.1, 10.1). */
const chatRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/',
  component: () => <ChatView key="new" />,
});

const chatSessionRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/chat/$sessionId',
  component: () => {
    const { sessionId } = chatSessionRoute.useParams();
    // One ChatView per conversation: switching conversations must drop the
    // other one's live stream, run id and transcript (a reused instance kept
    // streaming the previous run's reply into the conversation on screen).
    return <ChatView key={sessionId} sessionId={sessionId} />;
  },
});

/** Settings workspace (PRD 19): its own shell with semantic navigation. */
const settingsRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/settings',
  component: SettingsLayout,
});

const modelsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'models',
  component: ModelsPage,
});

const mcpRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'mcp',
  component: McpPage,
});

const skillsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'skills',
  component: SkillsPage,
});

const cronRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'cron',
  component: CronPage,
});

const messagingRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'messaging',
  component: MessagingPage,
});

const systemRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'system',
  component: SystemPage,
});

const rawConfigRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'advanced/config',
  component: RawConfigPage,
});

const environmentRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'advanced/environment',
  component: EnvPage,
});

const cliRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'advanced/cli',
  component: CliPage,
});

const appearanceRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'appearance',
  component: AppearancePage,
});

const aboutRoute = createRoute({ getParentRoute: () => settingsRoute, path: 'about', component: AboutPage });
const usageRoute = createRoute({ getParentRoute: () => settingsRoute, path: 'usage', component: UsagePage });
const memoryRoute = createRoute({ getParentRoute: () => settingsRoute, path: 'memory', component: MemoryPage });
const toolsRoute = createRoute({ getParentRoute: () => settingsRoute, path: 'tools', component: ToolsPage });
const profileRoute = createRoute({ getParentRoute: () => settingsRoute, path: 'profile', component: ProfilePage });
const webhooksRoute = createRoute({ getParentRoute: () => settingsRoute, path: 'webhooks', component: WebhooksPage });
const logsRoute = createRoute({ getParentRoute: () => settingsRoute, path: 'logs', component: LogsPage });

const fieldRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'field',
  validateSearch: (search: Record<string, unknown>): { path: string } => ({
    path: typeof search.path === 'string' ? search.path : '',
  }),
  component: () => {
    const { path } = fieldRoute.useSearch();
    return <FieldDetailPage path={path} />;
  },
});

const settingsIndexRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/',
  component: ModelsPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  setupRoute,
  protectedLayoutRoute.addChildren([
    chatRoute,
    chatSessionRoute,
    settingsRoute.addChildren([
      settingsIndexRoute,
      modelsRoute,
      appearanceRoute,
      aboutRoute,
      mcpRoute,
      skillsRoute,
      cronRoute,
      messagingRoute,
      systemRoute,
      rawConfigRoute,
      environmentRoute,
      cliRoute,
      usageRoute,
      memoryRoute,
      toolsRoute,
      profileRoute,
      webhooksRoute,
      logsRoute,
      fieldRoute,
    ]),
  ]),
]);

export function createAppRouter(history?: RouterHistory, queryClient?: QueryClient) {
  return createRouter({ routeTree, history, context: { queryClient }, defaultErrorComponent: RouteError });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
