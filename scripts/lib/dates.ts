import type { DatePrecision } from '../../src/schemas/project';

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', sept: '09', oct: '10', nov: '11', dec: '12',
};

export interface ParsedDate { date: string; precision: DatePrecision; label?: string }

/**
 * Parse loosely written dates ("Aug 2025", "Mar 1, 2026", "early 2026", "Summer 2026", "2026–2027+")
 * into ISO-ish dates with an explicit precision. Returns null when nothing date-like is present.
 */
export function parseLooseDate(text: string): ParsedDate | null {
  const t = text.trim();
  let m = t.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) {
    return { date: `${m[3]}-${MONTHS[m[1].slice(0, 3).toLowerCase()]}-${m[2].padStart(2, '0')}`, precision: 'day' };
  }
  m = t.match(/\b([A-Za-z]{3,9})\.?\s+(\d{4})\b/);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) {
    return { date: `${m[2]}-${MONTHS[m[1].slice(0, 3).toLowerCase()]}`, precision: 'month' };
  }
  m = t.match(/\b(early|spring|mid|summer|late|fall|autumn|winter|end of|q[1-4])\s+(\d{4})\b/i);
  if (m) {
    const season = m[1].toLowerCase();
    const month: Record<string, string> = {
      early: '02', q1: '02', spring: '04', q2: '05', mid: '06', summer: '07', q3: '08', late: '10', fall: '10', autumn: '10', q4: '11', winter: '12', 'end of': '12',
    };
    return { date: `${m[2]}-${month[season] ?? '06'}`, precision: 'estimate', label: `${m[1]} ${m[2]}` };
  }
  m = t.match(/\b(\d{4})\s*[–-]\s*(\d{4})\+?/);
  if (m) return { date: `${m[2]}`, precision: 'estimate', label: m[0] };
  m = t.match(/\b(20\d{2})\b/);
  if (m) return { date: m[1], precision: 'year' };
  return null;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
