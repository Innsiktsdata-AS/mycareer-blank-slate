/**
 * Dokumentasjonsstatus for et profilelement, utledet fra godkjente
 * kildekoblinger. Ren funksjon.
 *
 * «Dokumentert» betyr at opplysningen kan spores til en låst kilde som
 * brukeren har godkjent koblingen til — ikke at en tredjepart har bekreftet
 * at den er sann.
 */

export type SourceLinkRow = {
  atom_id: string;
  document_id: string | null;
  document_deleted: boolean;
  document_exists: boolean;
};

export type SourceStatus =
  | { kind: "documented"; documentId: string; count: number }
  | { kind: "unavailable" }
  | { kind: "none" };

export function sourceStatusByAtom(rows: SourceLinkRow[]): Map<string, SourceStatus> {
  const out = new Map<string, SourceStatus>();
  for (const r of rows) {
    const ok = Boolean(r.document_id) && r.document_exists && !r.document_deleted;
    const prev = out.get(r.atom_id);
    if (ok) {
      out.set(r.atom_id, {
        kind: "documented",
        documentId: prev?.kind === "documented" ? prev.documentId : (r.document_id as string),
        count: (prev?.kind === "documented" ? prev.count : 0) + 1,
      });
    } else if (!prev) {
      out.set(r.atom_id, { kind: "unavailable" });
    }
  }
  return out;
}
