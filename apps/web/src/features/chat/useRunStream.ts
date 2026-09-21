import { useEffect, useRef } from 'react';
import { parseGatewayFrame } from '@hermes-webui/shared';
import type { NormalizedRunEvent } from '@hermes-webui/shared';

/**
 * Subscribes to the gateway run event stream through the WebUI backend.
 *
 * EventSource reconnects on its own; the gateway does not replay missed
 * events (capability matrix, section 8), so the caller should combine this
 * with status polling for authoritative state.
 */
export function useRunStream(runId: string | null, onEvent: (event: NormalizedRunEvent) => void): void {
  const onEventRef = useRef(onEvent);

  // Keep the latest callback without resubscribing the stream (refs may only
  // be written outside render, so this lives in an effect).
  useEffect(() => {
    onEventRef.current = onEvent;
  });

  useEffect(() => {
    if (runId === null) {
      return;
    }
    const source = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`);
    source.onmessage = (messageEvent) => {
      const parsed = parseGatewayFrame(messageEvent.data);
      if (parsed !== null) {
        onEventRef.current(parsed);
      }
    };
    // EventSource retries automatically while the run is live; terminal runs
    // close the stream server-side.
    return () => {
      source.close();
    };
  }, [runId]);
}
