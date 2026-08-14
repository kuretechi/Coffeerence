import type { ReactNode } from 'react';

export function Card({ title, hint, children }: { title?: string; hint?: string; children: ReactNode }) {
  return (
    <section className="card">
      {title ? <h2>{title}</h2> : null}
      {hint ? <p className="hint">{hint}</p> : null}
      {children}
    </section>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min,
  suffix,
}: {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  step?: number;
  min?: number;
  suffix?: string;
}) {
  return (
    <Field label={suffix ? `${label}（${suffix}）` : label}>
      <input
        type="number"
        inputMode="decimal"
        step={step}
        min={min}
        value={value ?? ''}
        onChange={(event) => {
          const raw = event.target.value;
          onChange(raw === '' ? undefined : Number(raw));
        }}
      />
    </Field>
  );
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  compact = false,
}: {
  options: { value: T; label: string }[];
  value: T | undefined;
  onChange: (value: T) => void;
  /** 短いラベルを狭い画面でも一行に収める。 */
  compact?: boolean;
}) {
  return (
    <div className={compact ? 'segmented compact' : 'segmented'}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          className={option.value === value ? 'selected' : ''}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Banner({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'danger' | 'ok' }) {
  return <div className={`banner ${tone === 'info' ? '' : tone}`}>{children}</div>;
}

export function Pill({ children, tone = 'plain' }: { children: ReactNode; tone?: 'plain' | 'ok' | 'warn' | 'danger' }) {
  return <span className={`pill ${tone === 'plain' ? '' : tone}`}>{children}</span>;
}

export function formatSeconds(totalSeconds: number): string {
  const sign = totalSeconds < 0 ? '-' : '';
  const abs = Math.abs(Math.round(totalSeconds));
  const minutes = Math.floor(abs / 60);
  const seconds = abs % 60;
  return `${sign}${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatSigned(value: number, digits = 2): string {
  return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(digits)}`;
}
