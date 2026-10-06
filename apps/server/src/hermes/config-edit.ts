import { createHash } from 'node:crypto';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { LineCounter, isCollection, isMap, isScalar, parseDocument, type Document } from 'yaml';
import {
  classifyConfigPath,
  isGuidedEditableType,
  isSecretLikePath,
  type ConfigValidation,
  type ConfigValidationError,
  type ConfigValidationWarning,
  type GuidedConfigOp,
  type GuidedConfigResult,
  type GuidedConfigRow,
  type GuidedConfigState,
} from '@hermes-webui/shared';

/**
 * Safe editing of Hermes' config.yaml for the Raw Config page and the guided
 * editor. Hermes stays the source of truth: everything here produces YAML text
 * that is then written through the dashboard's raw-config endpoint, which
 * validates it and merges it onto the file while keeping comments.
 *
 * Hermes reads the file with PyYAML (YAML 1.1: bare `off`/`no` are booleans),
 * so every document is parsed AND written as 1.1. That is what makes the
 * stringifier quote a string such as 'off' instead of silently turning it into
 * `false`.
 */

export interface SchemaField {
  type: string;
  description?: string;
  category?: string;
  options?: string[];
  searchable?: boolean;
  clearable?: boolean;
}

export type SchemaFields = Record<string, SchemaField>;

/** A failed config edit. `code` is stable for the UI; `status` is the HTTP status. */
export class ConfigEditError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
    this.name = 'ConfigEditError';
  }
}

const YAML_OPTIONS = { version: '1.1', uniqueKeys: true } as const;

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Short fingerprint of a config.yaml text, used to detect edits made elsewhere. */
export function configRevision(text: string): string {
  return createHash('sha256').update(stripBom(text)).digest('hex').slice(0, 16);
}

/** Normalizes the dashboard's schema payload into typed fields. */
export function toSchemaFields(raw: Record<string, unknown>): SchemaFields {
  const fields: SchemaFields = {};
  for (const [fieldPath, value] of Object.entries(raw)) {
    if (value === null || typeof value !== 'object') continue;
    const entry = value as Record<string, unknown>;
    const field: SchemaField = { type: typeof entry.type === 'string' ? entry.type : 'string' };
    if (typeof entry.description === 'string') field.description = entry.description;
    if (typeof entry.category === 'string') field.category = entry.category;
    if (Array.isArray(entry.options)) {
      field.options = entry.options.filter((option): option is string => typeof option === 'string');
    }
    if (entry.searchable === true) field.searchable = true;
    if (entry.clearable === true) field.clearable = true;
    fields[fieldPath] = field;
  }
  return fields;
}

function getByPath(source: unknown, dotted: string): unknown {
  let cursor: unknown = source;
  for (const segment of dotted.split('.')) {
    if (typeof cursor !== 'object' || cursor === null || !(segment in (cursor as Record<string, unknown>))) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

function firstLine(message: string): string {
  return (message.split('\n')[0] ?? message).replace(/ at line \d+, column \d+:?$/, '').trim();
}

// -- Validation -------------------------------------------------------------------

function describeTypeProblem(node: unknown, field: SchemaField): string | null {
  const scalarType = field.type === 'string' || field.type === 'number' || field.type === 'boolean' || field.type === 'select';
  if (!scalarType) return null;
  if (isCollection(node)) {
    return `expects a single ${field.type === 'select' ? 'string' : field.type} value, not a list or map`;
  }
  if (!isScalar(node)) return null;
  const value = node.value;
  if (value === null) return null;
  switch (field.type) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? null : 'expects a number';
    case 'boolean':
      return typeof value === 'boolean' ? null : 'expects true or false';
    case 'string':
      return typeof value === 'string' ? null : `expects text; quote it ('${String(value)}') to keep it as text`;
    case 'select': {
      if (typeof value !== 'string') return `expects text; quote it ('${String(value)}') to keep it as text`;
      const options = field.options ?? [];
      if (options.length > 0 && !options.includes(value) && !(field.clearable === true && value === '')) {
        const shown = options.slice(0, 8).join(', ');
        return `"${value}" is not one of the known options (${shown}${options.length > 8 ? ', ...' : ''})`;
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * Checks a config.yaml text the way Hermes will read it. Errors block saving
 * when syntax, duplicate keys, or known-field types/options are invalid.
 */
export function validateConfigYaml(text: string, fields: SchemaFields): ConfigValidation {
  const lineCounter = new LineCounter();
  const doc = parseDocument(stripBom(text), { ...YAML_OPTIONS, lineCounter });
  const errors: ConfigValidationError[] = [];
  const warnings: ConfigValidationWarning[] = [];

  for (const error of doc.errors) {
    const line = error.linePos?.[0]?.line ?? 1;
    const column = error.linePos?.[0]?.col ?? 1;
    const message = firstLine(error.message);
    if (error.code === 'DUPLICATE_KEY') {
      errors.push({ line, column, message: 'Duplicate key: the later value would silently replace an earlier one' });
    } else {
      errors.push({ line, column, message });
    }
  }

  if (errors.length === 0 && !isMap(doc.contents)) {
    errors.push({ line: 1, column: 1, message: 'The top level must be a mapping of "key: value" pairs' });
  }

  if (errors.length === 0) {
    for (const [fieldPath, field] of Object.entries(fields)) {
      const node = doc.getIn(fieldPath.split('.'), true);
      if (node === undefined) continue;
      const problem = describeTypeProblem(node, field);
      if (problem === null) continue;
      const offset = (node as { range?: [number, number, number] | null }).range?.[0] ?? 0;
      errors.push({
        line: lineCounter.linePos(offset).line,
        column: lineCounter.linePos(offset).col,
        message: fieldPath + ' ' + problem,
      });
    }
  }

  warnings.sort((a, b) => a.line - b.line);
  return { ok: errors.length === 0, errors, warnings };
}

// -- Applying guided operations -------------------------------------------------------

function checkValue(fieldPath: string, field: SchemaField, value: unknown, defaultValue: unknown): void {
  const fail = (message: string): never => {
    throw new ConfigEditError('CONFIG_INVALID_VALUE', `${fieldPath}: ${message}`, 400);
  };
  switch (field.type) {
    case 'boolean':
      if (typeof value !== 'boolean') fail('expects true or false');
      return;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) fail('expects a number');
      if (typeof defaultValue === 'number' && Number.isInteger(defaultValue) && !Number.isInteger(value as number)) {
        fail('expects a whole number');
      }
      return;
    case 'string':
      if (typeof value !== 'string') fail('expects text');
      if ((value as string).includes('\u0000')) fail('contains a NUL character');
      return;
    case 'select': {
      if (typeof value !== 'string') fail('expects one of the listed options');
      const options = field.options ?? [];
      const allowed = options.length === 0 || options.includes(value as string) || (field.clearable === true && value === '');
      if (!allowed) fail(`"${String(value)}" is not one of the listed options`);
      return;
    }
    default:
      fail(`type "${field.type}" cannot be edited here`);
  }
}

function pruneEmptyParents(doc: Document, parts: string[]): void {
  for (let depth = parts.length - 1; depth > 0; depth -= 1) {
    const parentPath = parts.slice(0, depth);
    const parent = doc.getIn(parentPath, true);
    if (isMap(parent) && parent.items.length === 0) {
      doc.deleteIn(parentPath);
    } else {
      break;
    }
  }
}

export interface AppliedOps {
  yaml: string;
  applied: GuidedConfigResult['applied'];
  skipped: GuidedConfigResult['skipped'];
}

/**
 * Applies guided operations to the raw text. Every op is checked against the
 * schema (unknown keys refused), the safety tiers (locked keys refused, risky
 * keys need `confirm`) and the key's type before anything is changed; the
 * resulting document is validated again before it is returned.
 */
export function applyConfigOps(
  rawYaml: string,
  ops: GuidedConfigOp[],
  fields: SchemaFields,
  defaults: unknown,
): AppliedOps {
  const doc = parseDocument(stripBom(rawYaml), YAML_OPTIONS);
  if (doc.errors.length > 0) {
    throw new ConfigEditError(
      'CONFIG_UNPARSEABLE',
      'config.yaml has a syntax or duplicate-key error right now, so the guided editor will not touch it. Fix it in Raw Config first.',
      409,
    );
  }
  if (!isMap(doc.contents)) {
    throw new ConfigEditError('CONFIG_UNPARSEABLE', 'config.yaml is not a mapping; fix it in Raw Config first.', 409);
  }

  const applied: AppliedOps['applied'] = [];
  const skipped: AppliedOps['skipped'] = [];
  const seen = new Set<string>();

  for (const op of ops) {
    const field = fields[op.path];
    if (field === undefined) {
      throw new ConfigEditError('CONFIG_UNKNOWN_PATH', `${op.path} is not a setting Hermes knows about.`, 400);
    }
    if (seen.has(op.path)) {
      throw new ConfigEditError('CONFIG_DUPLICATE_OP', `${op.path} appears twice in one request.`, 400);
    }
    seen.add(op.path);

    const tier = classifyConfigPath(op.path);
    if (tier === 'locked') {
      throw new ConfigEditError(
        'CONFIG_PATH_LOCKED',
        `${op.path} can only be changed in Raw Config (it holds credentials, access control or Hermes bookkeeping).`,
        403,
      );
    }
    if (!isGuidedEditableType(field.type)) {
      throw new ConfigEditError('CONFIG_TYPE_NOT_EDITABLE', `${op.path} is a ${field.type}; edit it in Raw Config.`, 400);
    }
    if (tier === 'confirm' && op.confirm !== true) {
      throw new ConfigEditError('CONFIG_CONFIRM_REQUIRED', `${op.path} needs an explicit confirmation to change.`, 409);
    }

    const parts = op.path.split('.');
    if (op.op === 'unset') {
      if (!doc.hasIn(parts)) {
        skipped.push({ op: 'unset', path: op.path, reason: 'not set in config.yaml (already using the default)' });
        continue;
      }
      doc.deleteIn(parts);
      pruneEmptyParents(doc, parts);
      applied.push({ op: 'unset', path: op.path });
      continue;
    }

    checkValue(op.path, field, op.value, getByPath(defaults, op.path));
    try {
      doc.setIn(parts, op.value);
    } catch {
      throw new ConfigEditError(
        'CONFIG_PATH_CONFLICT',
        `${op.path} sits inside a section that is not a plain map in config.yaml; edit it in Raw Config.`,
        409,
      );
    }
    applied.push({ op: 'set', path: op.path });
  }

  // lineWidth 0: never re-wrap long strings, so untouched lines stay byte-identical.
  const yaml = doc.toString({ lineWidth: 0 });
  const check = validateConfigYaml(yaml, {});
  if (!check.ok) {
    throw new ConfigEditError('CONFIG_INVALID_RESULT', 'The edit would have produced invalid YAML; nothing was changed.', 500);
  }
  return { yaml, applied, skipped };
}

/** After a write: confirms Hermes' own re-read shows every change. Returns the paths that did not land. */
export function verifyApplied(
  applied: AppliedOps['applied'],
  ops: GuidedConfigOp[],
  freshRaw: string,
  freshConfig: unknown,
): string[] {
  const doc = parseDocument(stripBom(freshRaw), YAML_OPTIONS);
  const mismatches: string[] = [];
  for (const change of applied) {
    const parts = change.path.split('.');
    if (change.op === 'unset') {
      if (doc.hasIn(parts)) mismatches.push(change.path);
      continue;
    }
    const wanted = ops.find((op): op is Extract<GuidedConfigOp, { op: 'set' }> => op.op === 'set' && op.path === change.path);
    if (wanted === undefined || getByPath(freshConfig, change.path) !== wanted.value) {
      mismatches.push(change.path);
    }
  }
  return mismatches;
}

// -- Guided state -------------------------------------------------------------------

const MAX_TEXT_VALUE = 20_000;

function toScalar(value: unknown): string | number | boolean | null {
  if (typeof value === 'string') return value.length > MAX_TEXT_VALUE ? value.slice(0, MAX_TEXT_VALUE) : value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  return null;
}

/** Everything the guided page needs in one payload: schema rows with their live values. */
export function buildGuidedState(input: {
  raw: { yaml: string; path: string };
  schema: { fields: SchemaFields; categoryOrder: string[] };
  config: unknown;
  defaults: unknown;
}): GuidedConfigState {
  const doc = parseDocument(stripBom(input.raw.yaml), YAML_OPTIONS);
  const rows: GuidedConfigRow[] = [];
  let hiddenCount = 0;

  for (const [fieldPath, field] of Object.entries(input.schema.fields)) {
    if (!isGuidedEditableType(field.type)) {
      hiddenCount += 1;
      continue;
    }
    const tier = classifyConfigPath(fieldPath);
    if (tier === 'locked') {
      hiddenCount += 1;
      continue;
    }
    const masked = isSecretLikePath(fieldPath);
    const row: GuidedConfigRow = {
      path: fieldPath,
      type: field.type,
      description: field.description ?? fieldPath,
      category: field.category ?? 'general',
      tier,
      editable: true,
      value: masked ? null : toScalar(getByPath(input.config, fieldPath)),
      masked,
      defaultValue: masked ? null : toScalar(getByPath(input.defaults, fieldPath)),
      isSet: doc.hasIn(fieldPath.split('.')),
    };
    if (field.options !== undefined) row.options = field.options;
    if (field.searchable === true) row.searchable = true;
    if (field.clearable === true) row.clearable = true;
    rows.push(row);
  }

  const order = new Map(input.schema.categoryOrder.map((category, index) => [category, index] as const));
  rows.sort(
    (a, b) =>
      (order.get(a.category) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.category) ?? Number.MAX_SAFE_INTEGER) ||
      a.path.localeCompare(b.path),
  );

  return {
    rows,
    categoryOrder: input.schema.categoryOrder,
    path: input.raw.path,
    rev: configRevision(input.raw.yaml),
    hiddenCount,
  };
}

// -- Backups --------------------------------------------------------------------------

const BACKUPS_KEPT = 40;

/**
 * Saves the config text as it was before a write, in the WebUI's own data
 * directory (0600, newest 40 kept). Fail-closed: when the copy cannot be made
 * the write must not happen.
 */
export async function backupConfigText(dataDir: string, text: string, reason: 'raw' | 'guided'): Promise<string> {
  const dir = path.join(dataDir, 'config-backups');
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(dir, `config-${stamp}-${reason}.yaml`);
    await writeFile(file, text, { mode: 0o600, flag: 'wx' });
    const entries = (await readdir(dir)).filter((name) => name.startsWith('config-') && name.endsWith('.yaml')).sort();
    for (const stale of entries.slice(0, Math.max(0, entries.length - BACKUPS_KEPT))) {
      await rm(path.join(dir, stale), { force: true });
    }
    return file;
  } catch (error) {
    throw new ConfigEditError(
      'CONFIG_BACKUP_FAILED',
      `Could not save a backup copy of config.yaml first (${error instanceof Error ? error.message : 'unknown error'}); nothing was changed.`,
      500,
    );
  }
}
