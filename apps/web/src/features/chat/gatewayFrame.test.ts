import { describe, expect, it } from 'vitest';
import { parseGatewayFrame } from '@hermes-webui/shared';

const payload = JSON.stringify({ event: 'tool.started', run_id: 'run_1', tool: 'terminal' });

describe('parseGatewayFrame', () => {
  it('parses a raw data: frame', () => {
    expect(parseGatewayFrame(`data: ${payload}`)).toEqual({ type: 'tool.started', runId: 'run_1', tool: 'terminal' });
  });

  // EventSource.onmessage strips the `data:` prefix; dropping these frames
  // hid every live tool card, reasoning block and approval request.
  it('parses the bare payload EventSource delivers', () => {
    expect(parseGatewayFrame(payload)).toEqual({ type: 'tool.started', runId: 'run_1', tool: 'terminal' });
  });

  it('ignores keepalives, [DONE] and malformed frames', () => {
    expect(parseGatewayFrame(': keepalive')).toBeNull();
    expect(parseGatewayFrame('data: [DONE]')).toBeNull();
    expect(parseGatewayFrame('[DONE]')).toBeNull();
    expect(parseGatewayFrame('')).toBeNull();
    expect(parseGatewayFrame('not json')).toBeNull();
    expect(parseGatewayFrame(JSON.stringify({ run_id: 'x' }))).toBeNull();
  });
});
