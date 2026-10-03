import { useMemo } from 'react';
import { encode } from 'uqr';

/**
 * QR code as crisp SVG. Always dark modules on white with a quiet zone:
 * phone cameras need that contrast whatever the app theme is.
 */
export function QrCode({
  value,
  size = 208,
  label,
}: {
  value: string;
  size?: number;
  label: string;
}) {
  const path = useMemo(() => {
    const { data } = encode(value, { border: 0 });
    let d = '';
    data.forEach((row, y) => {
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`;
      });
    });
    return { d, modules: data.length };
  }, [value]);
  const quiet = 3;
  const box = path.modules + quiet * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`${-quiet} ${-quiet} ${box} ${box}`}
      shapeRendering="crispEdges"
      className="rounded-xl"
    >
      <rect x={-quiet} y={-quiet} width={box} height={box} fill="#fff" />
      <path d={path.d} fill="#000" />
    </svg>
  );
}
