const formatter = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

/** Presentation precision only; never recompute or replace backend readiness. */
export function formatReadiness(value: number): string {
  return `${formatter.format(value)}%`;
}

/** Compare two server values, normalizing float noise and negative zero for UI. */
export function readinessDelta(before: number, after: number): number {
  return Number((after - before).toFixed(1)) || 0;
}

export function formatReadinessDelta(delta: number): string {
  return `${delta > 0 ? "+" : ""}${formatter.format(delta)} п.п.`;
}

/** Bounds apply only to visual geometry, never to stored or displayed values. */
export function readinessBarValue(value: number): number {
  return Math.min(100, Math.max(0, value));
}
