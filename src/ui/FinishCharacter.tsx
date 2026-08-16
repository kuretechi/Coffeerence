import { useEffect, useState, type CSSProperties } from 'react';

/** 出てきて、少し居座って、引っ込むまでの時間。 */
const DURATION_MS = 3200;

/** 下辺から出るときは下部ツールバーを避ける。 */
const BOTTOM_GAP = 68;

type Side = 'top' | 'right' | 'bottom' | 'left';

const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];

/**
 * `--peek-x` / `--peek-y` は隠れている間のずらし量で、選んだ辺の外側を向く。
 * `--peek-flip` は絵の向きで、右辺（既定の向き）以外から出るときは反転させる。
 */
interface PeekStyle extends CSSProperties {
  '--peek-x': string;
  '--peek-y': string;
  '--peek-flip': string;
}

/** 画面の四辺のどれかを選び、その辺に沿ってランダムにずらした位置を返す。 */
function pickSpot(): PeekStyle {
  const side = SIDES[Math.floor(Math.random() * SIDES.length)] ?? 'right';
  /* 画像は幅が最大 46vw、高さがその約1.15倍なので、辺に沿う位置はその分内側に収める。 */
  const along = Math.random();
  switch (side) {
    case 'top':
      return {
        top: 0,
        left: `${(along * 54).toFixed(1)}%`,
        '--peek-x': '0%',
        '--peek-y': '-100%',
        '--peek-flip': 'scaleY(-1)',
      };
    case 'bottom':
      return {
        bottom: BOTTOM_GAP,
        left: `${(along * 54).toFixed(1)}%`,
        '--peek-x': '0%',
        '--peek-y': '100%',
        '--peek-flip': 'scale(1)',
      };
    case 'left':
      return {
        left: 0,
        top: `${(along * 68).toFixed(1)}%`,
        '--peek-x': '-100%',
        '--peek-y': '0%',
        '--peek-flip': 'scaleX(-1)',
      };
    default:
      return {
        right: 0,
        top: `${(along * 68).toFixed(1)}%`,
        '--peek-x': '100%',
        '--peek-y': '0%',
        '--peek-flip': 'scale(1)',
      };
  }
}

/** 抽出終了のお祝いに、キャラクターが画面の縁からヌッと出てくる。 */
export function FinishCharacter({ onDone }: { onDone: () => void }) {
  const [spot] = useState(pickSpot);

  useEffect(() => {
    const timer = window.setTimeout(onDone, DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [onDone]);

  return (
    <div className="finish-character" style={spot} aria-hidden="true">
      <img src={`${import.meta.env.BASE_URL}finish-character.png`} alt="" />
    </div>
  );
}
