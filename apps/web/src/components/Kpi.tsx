import type { CSSProperties, ReactNode } from 'react';
import { CountUp } from '@/components/CountUp';

/** A headline number on a glass tile: gradient digits that count up, with a small caption. */
export function Kpi({
  label,
  value,
  suffix,
  hint,
  index = 0,
}: {
  label: string;
  value: number;
  suffix?: string;
  hint?: ReactNode;
  index?: number;
}) {
  return (
    <div
      className="glass lift rise flex flex-col gap-1 rounded-3xl p-5"
      style={{ '--i': index } as CSSProperties}
    >
      <span className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
        {label}
      </span>
      <span className="text-aurora text-4xl font-bold tracking-tight">
        <CountUp value={value} suffix={suffix} />
      </span>
      {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
    </div>
  );
}
