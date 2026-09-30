import { useState } from 'react';

/**
 * Single-series charts in the dataviz spec: <=24px bars with a 4px rounded
 * data end and a square baseline, 2px gaps, hairline recessive grid, a
 * per-bar tooltip (value first) on hover and keyboard focus, and a table
 * view so no value is gated behind hovering. One validated hue
 * (--color-chart); text always uses text tokens.
 */

export interface ColumnDatum {
  key: string;
  label: string;
  value: number;
}

/** Clean tick values from 0 to a rounded max (3 gridlines). */
function niceTicks(max: number): number[] {
  if (max <= 0) return [0];
  const raw = max / 3;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((candidate) => candidate >= raw) ?? raw;
  return [0, step, step * 2, step * 3];
}

export function ColumnChart({
  data,
  format,
  label,
  height = 176,
}: {
  data: ColumnDatum[];
  format: (value: number) => string;
  label: string;
  height?: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  const ticks = niceTicks(Math.max(0, ...data.map((datum) => datum.value)));
  const top = ticks[ticks.length - 1] || 1;
  const labelEvery = Math.max(1, Math.ceil(data.length / 6));
  const current = active === null ? undefined : data[active];

  return (
    <figure aria-label={label} className="m-0">
      <div className="flex gap-2">
        {/* y axis */}
        <div className="relative w-10 shrink-0" style={{ height }} aria-hidden>
          {ticks.map((tick) => (
            <span
              key={tick}
              className="absolute right-0 translate-y-1/2 font-mono text-[10px] tabular-nums text-text-tertiary"
              style={{ bottom: `${(tick / top) * 100}%` }}
            >
              {format(tick)}
            </span>
          ))}
        </div>
        {/* plot */}
        <div className="relative min-w-0 flex-1" style={{ height }} onPointerLeave={() => setActive(null)}>
          {ticks.map((tick) => (
            <div
              key={tick}
              aria-hidden
              className="absolute inset-x-0 border-t border-border-subtle"
              style={{ bottom: `${(tick / top) * 100}%` }}
            />
          ))}
          <div className="absolute inset-0 flex items-end justify-between gap-[2px]">
            {data.map((datum, index) => {
              const pct = top === 0 ? 0 : (datum.value / top) * 100;
              return (
                <div
                  key={datum.key}
                  tabIndex={0}
                  role="img"
                  aria-label={`${datum.label}: ${format(datum.value)}`}
                  onPointerEnter={() => setActive(index)}
                  onFocus={() => setActive(index)}
                  onBlur={() => setActive(null)}
                  className="group relative flex h-full min-w-0 flex-1 cursor-default items-end justify-center outline-none"
                >
                  <div
                    className={[
                      'w-full max-w-6 rounded-t-[4px] transition-colors',
                      active === index ? 'bg-chart-hover' : 'bg-chart',
                      datum.value > 0 ? 'min-h-[2px]' : '',
                    ].join(' ')}
                    style={{ height: `${pct}%` }}
                  />
                </div>
              );
            })}
          </div>
          {current !== undefined && active !== null ? (
            <div
              role="tooltip"
              className="yu-pop pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-xl px-2.5 py-1.5 whitespace-nowrap"
              style={{ left: `${((active + 0.5) / data.length) * 100}%` }}
            >
              <p className="text-[13px] font-medium text-text-primary">{format(current.value)}</p>
              <p className="text-[11px] text-text-tertiary">{current.label}</p>
            </div>
          ) : null}
        </div>
      </div>
      {/* x axis: sparse labels */}
      <div className="mt-1.5 ml-12 flex justify-between gap-[2px]" aria-hidden>
        {data.map((datum, index) => (
          <span key={datum.key} className="min-w-0 flex-1 overflow-visible text-center font-mono text-[10px] whitespace-nowrap text-text-tertiary">
            {index % labelEvery === 0 ? datum.label.replace(/^\w+,\s*/, '') : ''}
          </span>
        ))}
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-text-tertiary select-none hover:text-text-secondary">
          View as table
        </summary>
        <table className="mt-2 w-full text-left text-xs">
          <tbody>
            {data.map((datum) => (
              <tr key={datum.key} className="border-t border-border-subtle">
                <td className="py-1 text-text-secondary">{datum.label}</td>
                <td className="py-1 text-right font-mono tabular-nums text-text-primary">{format(datum.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

export interface BarRow {
  key: string;
  label: string;
  value: number;
  /** Secondary text shown under the label (e.g. cost, sessions). */
  detail?: string;
}

/** Ranked horizontal bars: label, bar, value at the tip. */
export function BarList({ rows, format, label }: { rows: BarRow[]; format: (value: number) => string; label: string }) {
  const max = Math.max(0, ...rows.map((row) => row.value));
  return (
    <ul aria-label={label} className="space-y-3">
      {rows.map((row) => (
        <li key={row.key} className="grid grid-cols-[minmax(0,9rem)_1fr] items-center gap-3 sm:grid-cols-[minmax(0,12rem)_1fr]">
          <div className="min-w-0">
            <p className="truncate text-[13px] text-text-primary" title={row.label}>
              {row.label}
            </p>
            {row.detail !== undefined ? <p className="truncate text-[11px] text-text-tertiary">{row.detail}</p> : null}
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <div
              role="img"
              aria-label={`${row.label}: ${format(row.value)}`}
              className="h-3 max-h-6 rounded-r-[4px] bg-chart"
              style={{ width: `${max === 0 ? 0 : Math.max(1, (row.value / max) * 82)}%` }}
            />
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-text-secondary">{format(row.value)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
