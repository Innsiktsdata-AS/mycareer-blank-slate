import type { EventDate, EventPrecision } from "@/lib/career-material/event-date";

export type CareerApprovalOptions = {
  eventStart: string | null;
  eventEnd: string | null;
  eventPrecision: EventPrecision | null;
  targetAtomId: string | null;
  applyEventDate: boolean;
};

const RANK: Record<EventPrecision, number> = { year: 1, month: 2, day: 3 };

export const PRECISION_LABEL: Record<EventPrecision, string> = {
  year: "år",
  month: "måned",
  day: "dag",
};

/** Sann når ny dato er mindre presis enn en kjent dato (f.eks. dag → år). */
export function isLessPrecise(
  next: EventPrecision | null,
  current: EventPrecision | null,
): boolean {
  if (!next || !current) return false;
  return RANK[next] < RANK[current];
}

/**
 * Valgene som sendes ved godkjenning av et kildeforslag.
 * Ny oppføring: datoen brukeren har latt stå følger med.
 * Kobling til eksisterende oppføring: datoen sendes bare når brukeren
 * eksplisitt har valgt å oppdatere den, og aldri når den er tom eller mindre
 * presis enn datoen oppføringen har. Ellers står oppføringens dato uendret.
 */
export function buildCareerApprovalOptions(
  target: string,
  parsedDate: EventDate | null,
  link?: { applyEventDate: boolean; currentPrecision: EventPrecision | null },
): CareerApprovalOptions {
  const linking = target !== "new";
  const apply =
    linking &&
    link?.applyEventDate === true &&
    !!parsedDate &&
    !isLessPrecise(parsedDate.precision, link.currentPrecision);
  const send = linking ? apply : !!parsedDate;
  return {
    eventStart: send ? (parsedDate?.start ?? null) : null,
    eventEnd: send ? (parsedDate?.end ?? null) : null,
    eventPrecision: send ? (parsedDate?.precision ?? null) : null,
    targetAtomId: linking ? target : null,
    applyEventDate: apply,
  };
}
