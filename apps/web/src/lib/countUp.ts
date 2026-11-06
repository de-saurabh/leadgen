/** Eased progress: fast at first, settling at the end. `t` runs from 0 to 1. */
export function easeOut(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - clamped, 3);
}

/** The whole number to show part-way through a count from `from` to `to`. */
export function countAt(from: number, to: number, t: number): number {
  return Math.round(from + (to - from) * easeOut(t));
}

/** Whether the person asked their system for less motion. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
