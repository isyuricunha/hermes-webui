import { describe, expect, it } from 'vitest';
import { getByPath, searchSchema, setByPath } from './settingsSearch';
import type { SchemaField } from './settingsSearch';

const fields: Record<string, SchemaField> = {
  'memory.nudge_interval': { type: 'number', description: 'Memory → Nudge Interval', category: 'memory' },
  'memory.provider': { type: 'string', description: 'Memory → Provider', category: 'memory' },
  'auxiliary.mcp.provider': { type: 'string', description: 'Auxiliary → Mcp → Provider', category: 'auxiliary' },
  'model.default': { type: 'string', description: 'Default model', category: 'model' },
};

describe('searchSchema', () => {
  it('matches dotpaths', () => {
    const hits = searchSchema(fields, 'memory.nudge_interval');
    expect(hits[0]?.path).toBe('memory.nudge_interval');
  });

  it('matches human labels', () => {
    const hits = searchSchema(fields, 'nudge');
    expect(hits.map((hit) => hit.path)).toContain('memory.nudge_interval');
  });

  it('matches multi-word queries across dotpath and label', () => {
    const hits = searchSchema(fields, 'mcp provider');
    expect(hits.map((hit) => hit.path)).toContain('auxiliary.mcp.provider');
  });

  it('ranks exact dotpath above partial label matches', () => {
    const hits = searchSchema(fields, 'model.default');
    expect(hits[0]?.path).toBe('model.default');
  });

  it('returns nothing for empty queries', () => {
    expect(searchSchema(fields, '  ')).toEqual([]);
  });
});

describe('dotpath helpers', () => {
  it('reads nested values', () => {
    expect(getByPath({ a: { b: { c: 7 } } }, 'a.b.c')).toBe(7);
    expect(getByPath({ a: 1 }, 'a.b.c')).toBeUndefined();
  });

  it('builds nested single-value patches', () => {
    expect(setByPath(35, 'memory.nudge_interval')).toEqual({ memory: { nudge_interval: 35 } });
    expect(setByPath('x', 'model.default')).toEqual({ model: { default: 'x' } });
  });
});
