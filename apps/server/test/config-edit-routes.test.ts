import { describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { parse } from 'yaml';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { configRevision } from '../src/hermes/config-edit';
import type { HermesDashboardClient } from '../src/hermes/dashboard';

function makeDashboard() {
  let rawYaml = 'display:\n  nickname: Yuri\n';
  let config: Record<string, unknown> = { display: { nickname: 'Yuri' } };
  const defaults: Record<string, unknown> = { display: { nickname: 'Default' } };
  const schema = {
    fields: {
      'display.nickname': {
        type: 'string',
        description: 'Display name',
        category: 'display',
      },
      'display.enabled': {
        type: 'boolean',
        description: 'Display enabled',
        category: 'display',
      },
      'providers.test.model': {
        type: 'string',
        description: 'Provider model',
        category: 'provider',
      },
    },
    category_order: ['display', 'provider'],
  };

  const dashboard = {
    getConfigRaw: async () => ({ yaml: rawYaml, path: '/home/u/.hermes/config.yaml' }),
    getConfig: async () => config,
    getDefaults: async () => defaults,
    getSchema: async () => schema,
    putConfigRaw: async (yamlText: string) => {
      rawYaml = yamlText;
      config = parse(yamlText) as Record<string, unknown>;
      return { ok: true };
    },
  } as unknown as HermesDashboardClient;

  return {
    dashboard,
    getRaw: () => rawYaml,
  };
}

describe('config settings mutations', () => {
  it('serves guided state and applies a typed setting with backup and verification', async () => {
    const dataDir = await mkdtemp('/tmp/hermes-webui-config-routes-');
    try {
      const fake = makeDashboard();
      const app = await buildApp({
        disableAuth: true,
        dataDir,
        dashboardClient: fake.dashboard,
        config: loadConfig({
          HERMES_WEBUI_AUTH_MODE: 'local',
          HERMES_DASHBOARD_SESSION_TOKEN: 'dash-token',
        }),
      });

      const stateResponse = await app.inject({
        method: 'GET',
        url: '/api/settings/config/guided',
      });
      expect(stateResponse.statusCode).toBe(200);
      const state = stateResponse.json();
      expect(state.rows.map((row: { path: string }) => row.path)).toContain('display.nickname');
      expect(state.rows.map((row: { path: string }) => row.path)).not.toContain('providers.test.model');

      const response = await app.inject({
        method: 'PUT',
        url: '/api/settings/config/guided',
        payload: {
          rev: configRevision(fake.getRaw()),
          ops: [{ op: 'set', path: 'display.nickname', value: 'Yu' }],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().verified).toBe(true);
      expect(response.json().applied).toEqual([{ op: 'set', path: 'display.nickname' }]);
      expect(fake.getRaw()).toContain('nickname: Yu');
      expect(await readdir(dataDir + '/config-backups')).toHaveLength(1);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('rejects a stale revision before mutating the dashboard', async () => {
    const dataDir = await mkdtemp('/tmp/hermes-webui-config-routes-');
    try {
      const fake = makeDashboard();
      const app = await buildApp({
        disableAuth: true,
        dataDir,
        dashboardClient: fake.dashboard,
        config: loadConfig({
          HERMES_WEBUI_AUTH_MODE: 'local',
          HERMES_DASHBOARD_SESSION_TOKEN: 'dash-token',
        }),
      });

      const stale = configRevision(fake.getRaw());
      await fake.dashboard.putConfigRaw('display:\n  nickname: Other\n');

      const response = await app.inject({
        method: 'PUT',
        url: '/api/settings/config/guided',
        payload: {
          rev: stale,
          ops: [{ op: 'set', path: 'display.nickname', value: 'Yu' }],
        },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('CONFIG_CHANGED');
      expect(fake.getRaw()).toContain('nickname: Other');
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('validates raw YAML against the live schema', async () => {
    const dataDir = await mkdtemp('/tmp/hermes-webui-config-routes-');
    try {
      const fake = makeDashboard();
      const app = await buildApp({
        disableAuth: true,
        dataDir,
        dashboardClient: fake.dashboard,
        config: loadConfig({
          HERMES_WEBUI_AUTH_MODE: 'local',
          HERMES_DASHBOARD_SESSION_TOKEN: 'dash-token',
        }),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/settings/config/raw/validate',
        payload: { yaml_text: 'display:\n  enabled: "yes"\n' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().ok).toBe(false);
      expect(response.json().errors[0].message).toContain('expects true or false');
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
