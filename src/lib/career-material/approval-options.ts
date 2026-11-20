import type { EventDate } from "@/lib/career-material/event-date";

export type CareerApprovalOptions = {
  eventStart: string | null;
  eventEnd: string | null;
  eventPrecision: "day" | "month" | "year" | null;
  targetAtomId: string | null;
};

/**
 * Valgene som sendes ved godkjenning av et kildeforslag.
 * Datoen brukeren har bekreftet følger med både for ny oppføring og ved
 * kobling til en eksisterende — da blir den ny dato på oppføringen.
 * Tomt datofelt betyr ingen dato (ny) eller uendret dato (kobling).
 */
export function buildCareerApprovalOptions(
  target: string,
  parsedDate: EventDate | null,
): CareerApprovalOptions {
  return {
    eventStart: parsedDate?.start ?? null,
    eventEnd: parsedDate?.end ?? null,
    eventPrecision: parsedDate?.precision ?? null,
    targetAtomId: target === "new" ? null : target,
  };
}
