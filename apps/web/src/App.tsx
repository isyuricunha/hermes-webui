import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { queryClient } from './lib/query';
import { createAppRouter } from './app/router';
import { useChatType } from './lib/theme';

const router = createAppRouter(undefined, queryClient);

function ChatTypeRoot() {
  useChatType();
  return <RouterProvider router={router} />;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ChatTypeRoot />
    </QueryClientProvider>
  );
}
