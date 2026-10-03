/**
 * YuTheme dot matrix loader (registered in YuTheme 2.5.0): a 3x3 dot grid
 * whose dots light up clockwise around the perimeter and land on the center
 * dot. Quick blip per dot (rise 12%, fall by 28% of a 3s cycle), so the sweep
 * resolves at 65% of the cycle and the grid rests the remaining 35%. Styles
 * live in src/styles.css.
 *
 * With `label`, the wrapper owns role='status' and announces it (standalone
 * loading state). Without `label`, the wrapper is aria-hidden and purely
 * decorative: drop it inside a row that already owns the status semantics,
 * like the chat's ThinkingRow.
 */
export function DotMatrixLoader({ label, agent }: { label?: string; agent?: boolean }) {
  return (
    <div
      className={agent ? 'yu-dot-matrix yu-dot-matrix--agent' : 'yu-dot-matrix'}
      role={label === undefined ? undefined : 'status'}
      aria-label={label}
      aria-hidden={label === undefined || undefined}
    >
      {Array.from({ length: 9 }, (_, index) => (
        <span key={index} aria-hidden="true" />
      ))}
    </div>
  );
}
