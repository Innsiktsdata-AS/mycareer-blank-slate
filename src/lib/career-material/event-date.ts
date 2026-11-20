/**
 * Hendelsesdato fra ordrett tekst. Ren funksjon, ingen KI.
 *
 * Presisjon bevares: «2021» gir år, «mars 2021» gir måned, «15.03.2021» gir
 * dag. Det diktes aldri opp dag eller måned — `start` er første dag i
 * perioden, og `precision` sier hvor mye av datoen som faktisk er kjent.
 */

export type EventPrecision = "day" | "month" | "year";
export type EventDate = {
  start: string;
  end: string | null;
  precision: EventPrecision;
};

const MONTHS: Record<string, number> = {
  januar: 1, jan: 1, februar: 2, feb: 2, mars: 3, mar: 3, april: 4, apr: 4, mai: 5,
  juni: 6, jun: 6, juli: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9,
  oktober: 10, okt: 10, november: 11, nov: 11, desember: 12, des: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");
const validYear = (y: number) => y >= 1950 && y <= 2100;

function validDay(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

type Point = { y: number; m: number | null; d: number | null };

function parsePoint(raw: string): Point | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, " ").replace(/\.$/, "");
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return validYear(y) && validDay(y, mo, d) ? { y, m: mo, d } : null;
  }
  if ((m = s.match(/^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})$/))) {
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return validYear(y) && validDay(y, mo, d) ? { y, m: mo, d } : null;
  }
  if ((m = s.match(/^(\d{1,2})\.\s?([a-zæøå]+)\.?\s(\d{4})$/))) {
    const mo = MONTHS[m[2] ?? ""];
    const [d, y] = [Number(m[1]), Number(m[3])];
    return mo && validYear(y) && validDay(y, mo, d) ? { y, m: mo, d } : null;
  }
  if ((m = s.match(/^(\d{1,2})[./](\d{4})$/))) {
    const [mo, y] = [Number(m[1]), Number(m[2])];
    return validYear(y) && mo >= 1 && mo <= 12 ? { y, m: mo, d: null } : null;
  }
  if ((m = s.match(/^([a-zæøå]+)\.?\s(\d{4})$/))) {
    const mo = MONTHS[m[1] ?? ""];
    const y = Number(m[2]);
    return mo && validYear(y) ? { y, m: mo, d: null } : null;
  }
  if ((m = s.match(/^(\d{4})$/))) {
    const y = Number(m[1]);
    return validYear(y) ? { y, m: null, d: null } : null;
  }
  return null;
}

const precisionOf = (p: Point): EventPrecision => (p.d ? "day" : p.m ? "month" : "year");
const startOf = (p: Point) => `${p.y}-${pad(p.m ?? 1)}-${pad(p.d ?? 1)}`;
function endOf(p: Point): string {
  if (p.d && p.m) return startOf(p);
  if (p.m) return `${p.y}-${pad(p.m)}-${pad(new Date(Date.UTC(p.y, p.m, 0)).getUTCDate())}`;
  return `${p.y}-12-31`;
}
const RANK: Record<EventPrecision, number> = { year: 0, month: 1, day: 2 };

/** Tolker én dato eller en periode («2019–2021», «mars 2020 - juni 2021»). */
export function parseEventDate(text: string | null | undefined): EventDate | null {
  if (!text) return null;
  const s = text.trim();
  if (!s || s.length > 60) return null;
  const parts = s.split(/\s*(?:–|—|-(?!\d{2}-)|til)\s*/i).filter(Boolean);
  if (parts.length === 1 || /^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const p = parsePoint(s);
    if (!p) return null;
    return { start: startOf(p), end: null, precision: precisionOf(p) };
  }
  if (parts.length !== 2) return null;
  const a = parsePoint(parts[0] ?? "");
  const b = parsePoint(parts[1] ?? "");
  if (!a || !b) return null;
  const start = startOf(a);
  const end = endOf(b);
  if (end < start) return null;
  // Perioden får den minst presise av de to delene.
  const pa = precisionOf(a);
  const pb = precisionOf(b);
  return { start, end, precision: RANK[pa] <= RANK[pb] ? pa : pb };
}

const MONTH_NAMES = [
  "januar", "februar", "mars", "april", "mai", "juni", "juli", "august", "september",
  "oktober", "november", "desember",
];

/** Viser datoen bare så presist som den er kjent. */
export function formatEventDate(start: string, precision: EventPrecision): string {
  const [y, m, d] = start.split("-").map(Number);
  if (precision === "year") return String(y);
  if (precision === "month") return `${MONTH_NAMES[(m ?? 1) - 1]} ${y}`;
  return `${d}. ${MONTH_NAMES[(m ?? 1) - 1]} ${y}`;
}

export function formatEventRange(
  start: string | null,
  end: string | null,
  precision: EventPrecision | null,
): string | null {
  if (!start || !precision) return null;
  const a = formatEventDate(start, precision);
  if (!end) return a;
  const b = formatEventDate(end, precision);
  return a === b ? a : `${a}–${b}`;
}
