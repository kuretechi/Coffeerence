const DIGIT_W = 26;
const DIGIT_H = 46;
const COLON_W = 12;

/** 各数字で点灯するセグメント（a=上, b=右上, c=右下, d=下, e=左下, f=左上, g=中）。 */
const DIGITS: Record<string, string> = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abdeg',
  '3': 'abcdg',
  '4': 'bcfg',
  '5': 'acdfg',
  '6': 'acdefg',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg',
};

function horizontal(y: number): string {
  const [x0, x1, t] = [4, 22, 2.5];
  return `${x0},${y} ${x0 + t},${y - t} ${x1 - t},${y - t} ${x1},${y} ${x1 - t},${y + t} ${x0 + t},${y + t}`;
}

function vertical(x: number, y0: number, y1: number): string {
  const t = 2.5;
  return `${x},${y0} ${x + t},${y0 + t} ${x + t},${y1 - t} ${x},${y1} ${x - t},${y1 - t} ${x - t},${y0 + t}`;
}

const SEGMENTS: Record<string, string> = {
  a: horizontal(5),
  b: vertical(22, 7, 21),
  c: vertical(22, 25, 39),
  d: horizontal(41),
  e: vertical(4, 25, 39),
  f: vertical(4, 7, 21),
  g: horizontal(23),
};

function Digit({ char, x }: { char: string; x: number }) {
  const lit = DIGITS[char] ?? '';
  return (
    <g transform={`translate(${x} 0)`}>
      {Object.entries(SEGMENTS).map(([name, points]) => (
        <polygon
          key={name}
          points={points}
          className={lit.includes(name) ? 'seg on' : 'seg'}
        />
      ))}
    </g>
  );
}

function Colon({ x }: { x: number }) {
  return (
    <g transform={`translate(${x} 0)`}>
      <rect className="seg on" x={3} y={15} width={5} height={5} />
      <rect className="seg on" x={3} y={28} width={5} height={5} />
    </g>
  );
}

/** 7セグ風の時間表示。`value` は `formatSeconds` の "M:SS" 形式を想定。 */
export function SevenSegment({ value, className }: { value: string; className?: string }) {
  const gap = 4;
  let cursor = 0;
  const glyphs = [...value].map((char, index) => {
    const x = cursor;
    cursor += (char === ':' ? COLON_W : DIGIT_W) + gap;
    return char === ':' ? <Colon key={index} x={x} /> : <Digit key={index} char={char} x={x} />;
  });

  return (
    <svg
      className={className ? `seven-segment ${className}` : 'seven-segment'}
      viewBox={`0 0 ${Math.max(cursor - gap, 1)} ${DIGIT_H}`}
      role="timer"
      aria-label={value}
    >
      {glyphs}
    </svg>
  );
}
