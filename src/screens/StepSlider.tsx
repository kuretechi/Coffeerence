/**
 * 1刻みで数値を詰めるスライダー。
 * 大きな現在値の左右に −/＋ を置き、直接入力も残す。
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
        <button
          className="step-slider-step"
          type="button"
          aria-label={`${label}を1${unit}減らす`}
          disabled={shown <= min}
          onClick={() => onChange(clamp(shown - step))}
        >
          −
        </button>
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
        <button
          className="step-slider-step"
          type="button"
          aria-label={`${label}を1${unit}増やす`}
          disabled={shown >= max}
          onClick={() => onChange(clamp(shown + step))}
        >
          ＋
        </button>
      </div>
    </div>
  );
}
