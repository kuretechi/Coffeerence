import { useEffect, useMemo } from 'react';
import { defaultRng as rand, pick } from '../lib/random';

const CATS = ['🐱', '🐈', '😺', '😸', '😻', '🐾', '🐈‍⬛'];
const COUNT = 28;
/** 最後の猫が落ち切るまでの時間。 */
const DURATION_MS = 4200;

interface FallingCat {
  id: number;
  glyph: string;
  left: number;
  delay: number;
  duration: number;
  size: number;
  spin: number;
}

function makeCats(): FallingCat[] {
  return Array.from({ length: COUNT }, (_, id) => ({
    id,
    glyph: pick(CATS),
    left: rand() * 96,
    delay: rand() * 1.6,
    duration: 1.8 + rand() * 1.2,
    size: 22 + rand() * 26,
    spin: (rand() * 2 - 1) * 540,
  }));
}

/** 抽出終了のお祝いに猫を降らせる。降り終わったら onDone で片付ける。 */
export function CatRain({ onDone }: { onDone: () => void }) {
  const cats = useMemo(makeCats, []);

  useEffect(() => {
    const timer = window.setTimeout(onDone, DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [onDone]);

  return (
    <div className="cat-rain" aria-hidden="true">
      {cats.map((cat) => (
        <span
          key={cat.id}
          style={{
            left: `${cat.left}%`,
            fontSize: `${cat.size}px`,
            animationDelay: `${cat.delay}s`,
            animationDuration: `${cat.duration}s`,
            ['--cat-spin' as string]: `${cat.spin}deg`,
          }}
        >
          {cat.glyph}
        </span>
      ))}
    </div>
  );
}
