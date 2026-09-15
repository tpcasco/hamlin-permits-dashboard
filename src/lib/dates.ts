import type { DatePrecision } from '@/schemas/project';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SEASON_LABEL: Record<string, string> = { '02': 'Early', '04': 'Spring', '06': 'Mid', '07': 'Summer', '10': 'Late', '12': 'End of' };

/** Convert "YYYY", "YYYY-MM" or "YYYY-MM-DD" to a real Date (first day of period). */
export function toDate(iso: string): Date {
  const [y, m = '01', d = '01'] = iso.split('-');
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
}

/** Format respecting precision: "Mar 1, 2026" / "Aug 2025" / "2027" / "Summer 2026". */
export function formatPrecise(iso: string, precision: DatePrecision, label?: string): string {
  if (label && precision === 'estimate') return label.replace(/^(\w)/, (c) => c.toUpperCase());
  const [y, m, d] = iso.split('-');
  if (precision === 'year' || !m) return y;
  const month = MONTH_NAMES[Number(m) - 1];
  if (precision === 'estimate') return `${SEASON_LABEL[m] ?? month} ${y}`;
  if (precision === 'month' || !d) return `${month} ${y}`;
  return `${month} ${Number(d)}, ${y}`;
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export function daysFromNow(iso: string, now = new Date()): number {
  return daysBetween(now, toDate(iso));
}

/** "in 12 days" / "in 3 months" / "2 months ago" */
export function relativeLabel(iso: string, now = new Date()): string {
  const days = daysFromNow(iso, now);
  const abs = Math.abs(days);
  const unit = abs < 14 ? `${abs} day${abs === 1 ? '' : 's'}` : abs < 60 ? `${Math.round(abs / 7)} weeks` : abs < 365 ? `${Math.round(abs / 30)} months` : `${(abs / 365).toFixed(1)} years`;
  return days >= 0 ? `in ${unit}` : `${unit} ago`;
}

export function humanDuration(days: number): string {
  if (days < 45) return `${days} days`;
  if (days < 365) return `${Math.round(days / 30)} months`;
  const y = Math.floor(days / 365);
  const m = Math.round((days % 365) / 30);
  return m ? `${y} yr ${m} mo` : `${y} yr`;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function monthLabel(key: string): string {
  const [y, m] = key.split('-');
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
}
