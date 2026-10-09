import { useEffect, useState } from 'react';

export interface NumberFieldProps {
  value: number;
  onChange: (value: number) => void;
  className?: string;
  step?: string;
}

/**
 * A controlled numeric input that doesn't fight the user while they're typing. The classic bug
 * this avoids: with a plain `<input value={n} onChange={e => setN(Number(e.target.value))}>`,
 * backspacing a "0" down to an empty string computes `Number('') === 0` — the same value already
 * in state — so React sees no prop change and forces the DOM back to "0" before another digit can
 * be typed, making the field feel stuck.
 *
 * This component keeps its own text while focused (always exactly what's in the DOM, so React
 * never re-syncs against it) and only reports a parsed number upward on each valid keystroke;
 * on blur, an empty or invalid value commits as 0 and the display resyncs from the parent's value.
 */
export function NumberField({ value, onChange, className, step }: NumberFieldProps) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(String(value));
  }, [value, focused]);

  return (
    <input
      type="number"
      step={step}
      value={text}
      onFocus={(e) => {
        setFocused(true);
        e.target.select();
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        const n = Number(raw);
        if (raw !== '' && !Number.isNaN(n)) onChange(n);
      }}
      onBlur={() => {
        setFocused(false);
        if (text === '' || Number.isNaN(Number(text))) {
          setText('0');
          onChange(0);
        }
      }}
      className={className}
    />
  );
}

export default NumberField;
