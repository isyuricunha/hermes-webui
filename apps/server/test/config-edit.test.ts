import { describe, expect, it } from 'vitest';
import {
  applyConfigOps,
  buildGuidedState,
  configRevision,
  validateConfigYaml,
  type SchemaFields,
} from '../src/hermes/config-edit';
import { classifyConfigPath } from '@hermes-webui/shared';

const fields: SchemaFields = {
  'display.nickname': { type: 'string', category: 'display' },
  'display.enabled': { type: 'boolean', category: 'display' },
  'logging.level': { type: 'select', category: 'logging', options: ['DEBUG', 'INFO', 'WARNING', 'ERROR'] },
  'approvals.mode': { type: 'select', category: 'security', options: ['manual', 'smart', 'off'] },
  'providers.test.model': { type: 'string', category: 'provider' },
};

describe('config-edit safety and YAML handling', () => {
  it('blocks YAML syntax errors and duplicate keys; schema type mismatches are warnings', () => {
    const syntax = validateConfigYaml('display:\n  nickname: [\n', fields);
    expect(syntax.ok).toBe(false);
    expect(syntax.errors.length).toBeGreaterThan(0);

    const duplicate = validateConfigYaml('display:\n  enabled: true\n  enabled: false\n', fields);
    expect(duplicate.ok).toBe(false);
    expect(duplicate.errors.some((item) => item.message.includes('Duplicate key'))).toBe(true);

    const wrongType = validateConfigYaml('display:\n  enabled: "yes"\n', fields);
    expect(wrongType.ok).toBe(true);
    expect(wrongType.warnings.some((item) => item.message.includes('expects true or false'))).toBe(true);
  });

  it('applies a typed edit without discarding existing comments or unrelated keys', () => {
    const raw = [
      '# keep this rationale',
      'model:',
      '  default: original-model',
      'display:',
      '  nickname: Yuri',
      'logging:',
      '  level: INFO',
      '',
    ].join('\n');

    const result = applyConfigOps(
      raw,
      [{ op: 'set', path: 'display.nickname', value: 'Yu' }],
      fields,
      { display: { nickname: 'Default' } },
    );

    expect(result.applied).toEqual([{ op: 'set', path: 'display.nickname' }]);
    expect(result.yaml).toContain('# keep this rationale');
    expect(result.yaml).toContain('default: original-model');
    expect(result.yaml).toContain('nickname: Yu');
    expect(result.yaml).toContain('level: INFO');
  });

  it('requires confirmation for behavior-sensitive paths and locks secrets/providers', () => {
    expect(classifyConfigPath('logging.level')).toBe('free');
    expect(classifyConfigPath('model.default')).toBe('confirm');
    expect(classifyConfigPath('providers.test.model')).toBe('locked');
    expect(classifyConfigPath('telegram.token')).toBe('locked');

    expect(() =>
      applyConfigOps(
        'approvals:\n  mode: manual\n',
        [{ op: 'set', path: 'approvals.mode', value: 'smart' }],
        fields,
        { approvals: { mode: 'manual' } },
      ),
    ).toThrow(/needs an explicit confirmation/);

    expect(() =>
      applyConfigOps(
        'providers:\n  test:\n    model: one\n',
        [{ op: 'set', path: 'providers.test.model', value: 'two', confirm: true }],
        fields,
        {},
      ),
    ).toThrow(/can only be changed in Raw Config/);
  });

  it('removes an override when resetting to default and reports concurrent revisions', () => {
    const raw = 'display:\n  nickname: Yuri\nother: true\n';
    const result = applyConfigOps(
      raw,
      [{ op: 'unset', path: 'display.nickname' }],
      fields,
      { display: { nickname: 'Default' } },
    );
    expect(result.yaml).not.toContain('nickname: Yuri');
    expect(result.yaml).toContain('other: true');

    expect(configRevision(raw)).not.toBe(configRevision(result.yaml));
  });

  it('hides locked fields from the guided state', () => {
    const state = buildGuidedState({
      raw: { yaml: 'display:\n  nickname: Yuri\nproviders:\n  test:\n    model: x\n', path: '/tmp/config.yaml' },
      schema: {
        fields,
        categoryOrder: ['display', 'logging', 'security', 'provider'],
      },
      config: {
        display: { nickname: 'Yuri' },
        approvals: { mode: 'manual' },
        providers: { test: { model: 'x' } },
      },
      defaults: {
        display: { nickname: 'Default' },
        approvals: { mode: 'manual' },
      },
    });

    expect(state.rows.map((row) => row.path)).toContain('display.nickname');
    expect(state.rows.map((row) => row.path)).not.toContain('providers.test.model');
    expect(state.hiddenCount).toBe(1);
  });
});
