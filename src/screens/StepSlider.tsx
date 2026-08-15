import { useEffect, useRef } from 'react';

/** 長押しの連続増減が始まるまでの待ち時間と、その後の間隔（ms）。 */
const HOLD_DELAY_MS = 380;
const HOLD_INTERVAL_MS = 70;

/** −/＋ を押しっぱなしにしたら連続で刻む。 */
function useHold(step: () => void) {
  const latest = useRef(step);
  latest.current = step;
  const timers = useRef<{ delay?: number; repeat?: number }>({});

  const stop = () => {
    if (timers.current.delay !== undefined) window.clearTimeout(timers.current.delay);
    if (timers.current.repeat !== undefined) window.clearInterval(timers.current.repeat);
    timers.current = {};
  };

  useEffect(() => stop, []);

  const start = () => {
    stop();
    latest.current();
    timers.current.delay = window.setTimeout(() => {
      timers.current.repeat = window.setInterval(() => latest.current(), HOLD_INTERVAL_MS);
    }, HOLD_DELAY_MS);
  };

  return { start, stop };
}

function StepButton({
  label,
  glyph,
  disabled,
  onStep,
}: {
  label: string;
  glyph: string;
  disabled: boolean;
  onStep: () => void;
}) {
  const hold = useHold(onStep);
  return (
    <button
      className="step-slider-step"
      type="button"
      aria-label={label}
      disabled={disabled}
      onPointerDown={(event) => {
        event.preventDefault();
        hold.start();
      }}
      onPointerUp={hold.stop}
      onPointerLeave={hold.stop}
      onPointerCancel={hold.stop}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onStep();
      }}
    >
      {glyph}
    </button>
  );
}

/**
 * 1刻みで数値を詰める行。
 * 大きな現在値の左右に −/＋（長押しで連続）を置き、スライダーと直接入力も残す。
 */
export function StepSlider({
  label,
  unit,
  value,
  min,
  max,
  step = 1,
  inputStep,
  format,
  onChange,
}: {
  label: string;
  unit: string;
  value: number | undefined;
  min: number;
  max: number;
  step?: number;
  /** キーボード入力だけ細かく刻みたいとき。 */
  inputStep?: number;
  format?: (value: number) => string;
  onChange: (value: number | undefined) => void;
}) {
  const shown = value ?? min;
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  const show = format ?? ((v: number) => String(v));

  return (
    <div className="step-slider">
      <div className="step-slider-head">
        <span className="step-slider-label">{label}</span>
        <input
          className="step-slider-input mono"
          type="number"
          inputMode="decimal"
          step={inputStep ?? step}
          min={min}
          max={max}
          value={value ?? ''}
          aria-label={`${label}（${unit}）`}
          onChange={(event) => {
            const raw = event.target.value;
            onChange(raw === '' ? undefined : Number(raw));
          }}
        />
      </div>
      <div className="step-slider-row">
        <StepButton
          label={`${label}を${step}${unit}減らす`}
          glyph="−"
          disabled={shown <= min}
          onStep={() => onChange(clamp(shown - step))}
        />
        <div className="step-slider-main">
          <p className="step-slider-value mono">
            {value === undefined ? '—' : show(value)}
            <span className="step-slider-unit">{unit}</span>
          </p>
          <input
            className="step-slider-range"
            type="range"
            min={min}
            max={max}
            step={step}
            value={shown}
            aria-label={`${label}（${unit}）スライダー`}
            onChange={(event) => onChange(Number(event.target.value))}
          />
        </div>
        <StepButton
          label={`${label}を${step}${unit}増やす`}
          glyph="＋"
          disabled={shown >= max}
          onStep={() => onChange(clamp(shown + step))}
        />
      </div>
    </div>
  );
}
