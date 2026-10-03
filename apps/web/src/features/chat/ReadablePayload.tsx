import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import '../../i18n';

/**
 * Tool results as people read them: a JSON object becomes labelled rows
 * ("exit_code" -> "Exit code"), long text keeps its line breaks, booleans
 * become words, empty values are left out. Anything that is not JSON (or is
 * a truncated JSON preview) is shown as text with escaped line breaks
 * restored. The raw payload stays one click away in the tool card.
 */

const MAX_DEPTH = 3;

export function humanKey(key: string): string {
  const spaced = key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  return spaced === '' ? key : spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function isEmpty(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    value === '' ||
    (Array.isArray(value) && value.length === 0) ||
    (typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0)
  );
}

/** Parses a payload as JSON; null when it is not (or is cut off). */
export function parsePayload(raw: string): unknown {
  const trimmed = raw.trim();
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

/** Text for a payload that is not JSON: escaped newlines and tabs restored. */
export function readableText(raw: string): string {
  if (raw.includes('\n')) return raw;
  return raw.replace(/\\n/g, '\n').replace(/\\t/g, '  ').replace(/\\"/g, '"');
}

/** Values shown on their own full-width line under the label. */
function isBlock(value: unknown): boolean {
  if (typeof value === 'string') return value.includes('\n') || value.length > 90;
  if (Array.isArray(value)) {
    const primitives = value.every(
      (item) => item === null || ['string', 'number', 'boolean'].includes(typeof item),
    );
    return !primitives || value.map(String).join(', ').length > 90;
  }
  return typeof value === 'object' && value !== null;
}

function Scalar({ value }: { value: unknown }): ReactNode {
  const { t } = useTranslation();
  if (typeof value === 'boolean') {
    return (
      <span
        className={[
          'yu-chip h-5 rounded-full px-2 text-[11px]',
          value ? 'yu-chip-success' : 'yu-chip-neutral',
        ].join(' ')}
      >
        {value ? t('chat.payload.yes') : t('chat.payload.no')}
      </span>
    );
  }
  if (typeof value === 'number')
    return (
      <span className="font-mono text-text-primary tabular-nums">{value.toLocaleString()}</span>
    );
  const text = String(value);
  if (text.includes('\n') || text.length > 90) {
    return (
      <pre className="max-h-72 overflow-auto rounded-md bg-background/60 px-2.5 py-2 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-words text-text-secondary">
        {text}
      </pre>
    );
  }
  return <span className="break-words text-text-primary">{text}</span>;
}

function Value({ value, depth }: { value: unknown; depth: number }): ReactNode {
  if (Array.isArray(value)) {
    if (
      value.every((item) => item === null || ['string', 'number', 'boolean'].includes(typeof item))
    ) {
      const joined = value.map(String).join(', ');
      return joined.length <= 90 ? (
        <span className="break-words text-text-primary">{joined}</span>
      ) : (
        <Scalar value={value.map(String).join('\n')} />
      );
    }
    if (depth >= MAX_DEPTH) return <Scalar value={JSON.stringify(value, null, 2)} />;
    return (
      <ol className="space-y-1.5">
        {value.map((item, index) => (
          <li key={index}>
            <Value value={item} depth={depth + 1} />
          </li>
        ))}
      </ol>
    );
  }
  if (typeof value === 'object' && value !== null) {
    if (depth >= MAX_DEPTH) return <Scalar value={JSON.stringify(value, null, 2)} />;
    return <Rows record={value as Record<string, unknown>} depth={depth + 1} />;
  }
  return <Scalar value={value} />;
}

/**
 * A compact property list: one row per field with a hairline between rows.
 * The label column is as wide as the longest short label (capped), so values
 * sit right next to their label; long text and nested values take the full
 * width under their label.
 */
function Rows({ record, depth }: { record: Record<string, unknown>; depth: number }) {
  const { t } = useTranslation();
  const entries = Object.entries(record).filter(([, value]) => !isEmpty(value));
  if (entries.length === 0)
    return <span className="text-text-tertiary">{t('chat.payload.empty')}</span>;
  const labelChars = Math.min(
    16,
    Math.max(
      6,
      ...entries.filter(([, value]) => !isBlock(value)).map(([key]) => humanKey(key).length),
    ),
  );
  return (
    <dl className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle bg-surface/40">
      {entries.map(([key, value]) =>
        isBlock(value) ? (
          <div key={key} className="px-3 py-2">
            <dt className="mb-1.5 text-[11px] font-medium text-text-tertiary">{humanKey(key)}</dt>
            <dd className="min-w-0 text-[12.5px]">
              <Value value={value} depth={depth} />
            </dd>
          </div>
        ) : (
          <div key={key} className="flex items-baseline gap-3 px-3 py-1.5">
            <dt
              className="shrink-0 text-[11px] font-medium text-text-tertiary"
              style={{ width: `${labelChars + 1}ch` }}
            >
              {humanKey(key)}
            </dt>
            <dd className="min-w-0 flex-1 text-[12.5px]">
              <Value value={value} depth={depth} />
            </dd>
          </div>
        ),
      )}
    </dl>
  );
}

export function ReadablePayload({ raw }: { raw: string }) {
  const parsed = parsePayload(raw);
  if (parsed === null || typeof parsed !== 'object') {
    return (
      <pre className="font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-words text-text-secondary">
        {readableText(raw)}
      </pre>
    );
  }
  return <Value value={parsed} depth={0} />;
}
