import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router';
import { AppShell } from './AppShell';
import { ChatView } from '../features/chat/ChatView';
import { SettingsPlaceholder } from '../features/settings/SettingsPlaceholder';

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
  component: SettingsPlaceholder,
});

const routeTree = rootRoute.addChildren([chatRoute, chatSessionRoute, settingsRoute]);

export function createAppRouter() {
  return createRouter({ routeTree });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
