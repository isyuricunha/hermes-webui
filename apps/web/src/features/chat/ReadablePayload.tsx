import type { ReactNode } from 'react';

/**
 * Tool results as people read them: a JSON object becomes labelled rows
 * ("exit_code" -> "Exit code"), long text keeps its line breaks, booleans
 * become words, empty values are left out. Anything that is not JSON (or is
 * a truncated JSON preview) is shown as text with escaped line breaks
 * restored. The raw payload stays one click away in the tool card.
 */

const MAX_DEPTH = 3;

export function humanKey(key: string): string {
  const spaced = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
  return spaced === '' ? key : spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function isEmpty(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    value === '' ||
    (Array.isArray(value) && value.length === 0) ||
    (typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 0)
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

function Scalar({ value }: { value: unknown }): ReactNode {
  if (typeof value === 'boolean') {
    return <span className={value ? 'text-success' : 'text-text-tertiary'}>{value ? 'yes' : 'no'}</span>;
  }
  if (typeof value === 'number') return <span className="font-mono text-text-primary">{value.toLocaleString()}</span>;
  const text = String(value);
  if (text.includes('\n') || text.length > 120) {
    return (
      <pre className="mt-1 max-h-72 overflow-auto rounded-lg bg-surface-editor px-2.5 py-2 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-words text-text-secondary">
        {text}
      </pre>
    );
  }
  return <span className="break-words text-text-primary">{text}</span>;
}

function Value({ value, depth }: { value: unknown; depth: number }): ReactNode {
  if (Array.isArray(value)) {
    if (value.every((item) => item === null || ['string', 'number', 'boolean'].includes(typeof item))) {
      const joined = value.map(String).join(', ');
      return joined.length <= 160 ? <span className="break-words text-text-primary">{joined}</span> : <Scalar value={value.map(String).join('\n')} />;
    }
    if (depth >= MAX_DEPTH) return <Scalar value={JSON.stringify(value, null, 2)} />;
    return (
      <ol className="mt-1 space-y-1.5">
        {value.map((item, index) => (
          <li key={index} className="rounded-lg border border-border-subtle px-2.5 py-1.5">
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

function Rows({ record, depth }: { record: Record<string, unknown>; depth: number }) {
  const entries = Object.entries(record).filter(([, value]) => !isEmpty(value));
  if (entries.length === 0) return <span className="text-text-tertiary">(empty)</span>;
  return (
    <dl className={depth > 1 ? 'mt-1 space-y-1 border-l border-border-subtle pl-2.5' : 'space-y-1.5'}>
      {entries.map(([key, value]) => (
        <div key={key} className="grid grid-cols-[minmax(5rem,9rem)_1fr] gap-x-3 max-sm:grid-cols-1">
          <dt className="text-[11.5px] text-text-tertiary">{humanKey(key)}</dt>
          <dd className="min-w-0 text-[12.5px]">
            <Value value={value} depth={depth} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ReadablePayload({ raw }: { raw: string }) {
  const parsed = parsePayload(raw);
  if (parsed === null || typeof parsed !== 'object') {
    return (
      <pre className="font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-words text-text-secondary">{readableText(raw)}</pre>
    );
  }
  return <Value value={parsed} depth={0} />;
}
