/**
 * Felles faktagrunnlag for senere generering (CV, søknadsbrev,
 * kvartals-/års-/stillingsoppsummering). Ren funksjon.
 *
 * Et faktum er med når det er aktivt, er evidens, ikke er avvist/erstattet,
 * og er brukerbekreftet etter én av to regler:
 *  1) eldre regel: `confidence = verified` og `user_confirmed = true`
 *     (bekreftet i CV-gjennomgang eller lagt inn manuelt), eller
 *  2) kildeforslag: `source_type = career_material`, `user_confirmed = true`
 *     og et godkjent forslag fra forslagskøen peker på oppføringen.
 * En gammel `inferred`-oppføring slipper ikke gjennom bare fordi
 * `user_confirmed` er satt.
 */
import type { EventPrecision } from "@/lib/career-material/event-date";
import type { SourceStatus } from "./source-status";

export type FactAtomRow = {
  id: string;
  atom_kind: string;
  atom_type: string | null;
  content_no: string | null;
  parent_atom_id: string | null;
  confidence: string;
  user_confirmed: boolean | null;
  is_active: boolean | null;
  source_type: string | null;
  state: string | null;
  mangel_state: string | null;
  event_start: string | null;
  event_end: string | null;
  event_precision: EventPrecision | null;
  created_at: string;
};

export type ApprovedFact = {
  id: string;
  type: string | null;
  content: string;
  roleId: string | null;
  event: { start: string; end: string | null; precision: EventPrecision } | null;
  /** Registreringsdato — aldri en hendelsesdato. */
  registeredAt: string;
  sourceType: string | null;
  documentation: "documented" | "unavailable" | "none";
  documentId: string | null;
};

export type FactFilter = {
  roleId?: string | null;
  /** ISO-dato, inklusiv. */
  from?: string | null;
  /** ISO-dato, inklusiv. */
  to?: string | null;
};

export function isUserConfirmedFact(a: FactAtomRow, approvedProposalAtomIds: Set<string>): boolean {
  if (a.is_active === false || a.atom_kind !== "evidens") return false;
  if (a.mangel_state) return false;
  if (a.state && a.state !== "aktiv") return false;
  if (a.user_confirmed !== true) return false;
  if (a.confidence === "verified") return true;
  return a.source_type === "career_material" && approvedProposalAtomIds.has(a.id);
}

function eventEnd(start: string, end: string | null, precision: EventPrecision): string {
  if (end) return end;
  const [y, m] = start.split("-").map(Number);
  if (precision === "year") return `${y}-12-31`;
  if (precision === "month") {
    const last = new Date(Date.UTC(y ?? 0, m ?? 1, 0)).getUTCDate();
    return `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  }
  return start;
}

export function selectApprovedFacts(
  atoms: FactAtomRow[],
  approvedProposalAtomIds: Set<string>,
  sources: Map<string, SourceStatus>,
  filter: FactFilter = {},
): { dated: ApprovedFact[]; undated: ApprovedFact[] } {
  const dated: ApprovedFact[] = [];
  const undated: ApprovedFact[] = [];
  for (const a of atoms) {
    if (!isUserConfirmedFact(a, approvedProposalAtomIds)) continue;
    if (filter.roleId && a.parent_atom_id !== filter.roleId && a.id !== filter.roleId) continue;
    const src = sources.get(a.id);
    const fact: ApprovedFact = {
      id: a.id,
      type: a.atom_type,
      content: a.content_no ?? "",
      roleId: a.parent_atom_id,
      event:
        a.event_start && a.event_precision
          ? { start: a.event_start, end: a.event_end, precision: a.event_precision }
          : null,
      registeredAt: a.created_at,
      sourceType: a.source_type,
      documentation: src?.kind ?? "none",
      documentId: src?.kind === "documented" ? src.documentId : null,
    };
    if (!fact.event) {
      // Uten kjent hendelsesdato: leveres separat og filtreres ikke på periode.
      undated.push(fact);
      continue;
    }
    const s = fact.event.start;
    const e = eventEnd(s, fact.event.end, fact.event.precision);
    if (filter.from && e < filter.from) continue;
    if (filter.to && s > filter.to) continue;
    dated.push(fact);
  }
  dated.sort((x, y) => (x.event!.start < y.event!.start ? -1 : 1));
  return { dated, undated };
}
