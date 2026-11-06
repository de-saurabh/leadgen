import { useEffect, useRef, useState } from 'react';
import { countAt, prefersReducedMotion } from '@/lib/countUp';

/** A number that counts up when it first appears and glides when it changes. */
export function CountUp({
  value,
  duration = 1000,
  suffix = '',
}: {
  value: number;
  duration?: number;
  suffix?: string;
}) {
  const instant = prefersReducedMotion();
  const [shown, setShown] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    if (instant) return;
    const start = from.current;
    let frame = 0;
    let begun: number | null = null;
    const tick = (now: number) => {
      begun ??= now;
      const t = (now - begun) / duration;
      const next = countAt(start, value, t);
      setShown(next);
      from.current = next;
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration, instant]);

  return (
    <span className="tabular-nums">
      {(instant ? value : shown).toLocaleString()}
      {suffix}
    </span>
  );
}
