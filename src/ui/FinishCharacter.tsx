import { useEffect } from 'react';

/** 出てきて、少し居座って、引っ込むまでの時間。 */
const DURATION_MS = 3200;

/** 抽出終了のお祝いに、キャラクターが横からヌッと出てくる。 */
export function FinishCharacter({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [onDone]);

  return (
    <div className="finish-character" aria-hidden="true">
      <img src={`${import.meta.env.BASE_URL}finish-character.png`} alt="" />
    </div>
  );
}
