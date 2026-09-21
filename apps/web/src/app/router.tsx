import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router';
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

const rootRoute = createRootRoute({
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});

/** Chat is the home route (PRD 6.1, 10.1). */
const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => <ChatView />,
});

const chatSessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/chat/$sessionId',
  component: () => {
    const { sessionId } = chatSessionRoute.useParams();
    return <ChatView sessionId={sessionId} />;
  },
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
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

const settingsIndexRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/',
  component: ModelsPage,
});

const routeTree = rootRoute.addChildren([
  chatRoute,
  chatSessionRoute,
  settingsRoute.addChildren([
    settingsIndexRoute,
    modelsRoute,
    mcpRoute,
    skillsRoute,
    cronRoute,
    messagingRoute,
    systemRoute,
    rawConfigRoute,
    environmentRoute,
  ]),
]);

export function createAppRouter() {
  return createRouter({ routeTree });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
