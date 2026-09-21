import { useQuery } from '@tanstack/react-query';
import { fetchMessagingPlatforms } from '../../lib/api';
import { SettingsError, SettingsPage } from './SettingsLayout';

/** Messaging channels (PRD 27): overview of supported platforms. */
export function MessagingPage() {
  const platformsQuery = useQuery({ queryKey: ['messaging-platforms'], queryFn: fetchMessagingPlatforms });

  if (platformsQuery.isPending) {
    return (
      <SettingsPage title="Messaging">
        <p className="text-sm text-text-secondary">Loading platforms…</p>
      </SettingsPage>
    );
  }
  if (platformsQuery.isError) {
    return (
      <SettingsPage title="Messaging">
        <SettingsError message={platformsQuery.error.message} />
      </SettingsPage>
    );
  }

  const platforms = platformsQuery.data.platforms ?? [];
  return (
    <SettingsPage title="Messaging">
      <ul className="space-y-1.5">
        {platforms.map((platform) => (
          <li
            key={platform.id}
            className="w-full rounded-lg border border-border-subtle bg-surface-elevated px-3 py-2"
          >
            <p className="text-sm font-medium">{platform.name}</p>
            {platform.description ? (
              <p className="line-clamp-2 text-xs text-text-secondary">{platform.description}</p>
            ) : null}
          </li>
        ))}
        {platforms.length === 0 ? (
          <li className="text-sm text-text-secondary">No platforms known.</li>
        ) : null}
      </ul>
      <p className="mt-4 text-xs text-text-secondary">
        Per-channel connection status lives in System; channel setup flows arrive with Beta scope.
      </p>
    </SettingsPage>
  );
}
