import type { CSSProperties } from 'react';

interface RangeFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange(value: number): void;
  /** 顯示在標籤後面的數值文字，預設兩位小數。 */
  format?(value: number): string;
}

/**
 * 有填色軌道的滑桿。
 *
 * 原生 range 在通用 input 樣式（外框 + padding）底下會把軌道內縮，拉到底看起來
 * 不會滿；這裡自己畫軌道，並用 --range-fill 讓填色精確對應目前數值。
 */
export function RangeField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format = (current) => current.toFixed(2),
}: RangeFieldProps) {
  const span = max - min;
  const ratio = span > 0 ? (value - min) / span : 0;
  const fill = `${Math.min(100, Math.max(0, ratio * 100))}%`;

  return (
    <label className="field range-field">
      {label}（{format(value)}）
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        style={{ '--range-fill': fill } as CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
