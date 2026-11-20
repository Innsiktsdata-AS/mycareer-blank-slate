/**
 * Server-leser for brukerens godkjente fakta. Leser med brukerens egen
 * sesjon (RLS), så andre brukeres data kan aldri følge med. Leser aldri
 * kildetekst — bare godkjente oppføringer og metadata.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { selectApprovedFacts, type FactAtomRow } from "./approved-facts";
import { sourceStatusByAtom } from "./source-status";

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const filterSchema = z.object({
  roleId: z.string().uuid().nullable().optional(),
  from: iso.nullable().optional(),
  to: iso.nullable().optional(),
});

export const getApprovedCareerFacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => filterSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: atoms, error } = await sb
      .from("career_atoms")
      .select(
        "id, atom_kind, atom_type, content_no, parent_atom_id, confidence, user_confirmed, is_active, source_type, state, mangel_state, event_start, event_end, event_precision, created_at",
      )
      .eq("user_id", context.userId)
      .eq("is_active", true)
      .eq("atom_kind", "evidens")
      .limit(2000);
    if (error) throw new Error("Kunne ikke hente fakta.");
    const { data: props } = await sb
      .from("atom_enrichment_proposals")
      .select("applied_atom_id")
      .eq("user_id", context.userId)
      .eq("source_type", "career_material")
      .eq("status", "approved")
      .not("applied_atom_id", "is", null);
    const approved = new Set(
      ((props ?? []) as Array<{ applied_atom_id: string | null }>)
        .map((p) => p.applied_atom_id)
        .filter((x): x is string => !!x),
    );
    const { data: links } = await sb
      .from("career_atom_sources")
      .select("atom_id, document_id, approved_by")
      .eq("user_id", context.userId);
    const linkRows = (links ?? []) as Array<{
      atom_id: string;
      document_id: string | null;
      approved_by: string | null;
    }>;
    // Godkjenningen er også lagret på kildekoblingen, så et faktum beholdes
    // selv om kilden eller forslaget senere slettes.
    for (const l of linkRows) if (l.approved_by === context.userId) approved.add(l.atom_id);
    const docIds = Array.from(new Set(linkRows.map((l) => l.document_id).filter((d): d is string => !!d)));
    const docs = new Map<string, boolean>();
    if (docIds.length > 0) {
      const { data: d } = await sb.from("documents").select("id, deleted_at").in("id", docIds.slice(0, 500));
      for (const x of (d ?? []) as Array<{ id: string; deleted_at: string | null }>)
        docs.set(x.id, Boolean(x.deleted_at));
    }
    const sources = sourceStatusByAtom(
      linkRows.map((l) => ({
        atom_id: l.atom_id,
        document_id: l.document_id,
        document_exists: l.document_id ? docs.has(l.document_id) : false,
        document_deleted: l.document_id ? (docs.get(l.document_id) ?? false) : false,
      })),
    );
    return selectApprovedFacts((atoms ?? []) as FactAtomRow[], approved, sources, {
      roleId: data.roleId ?? null,
      from: data.from ?? null,
      to: data.to ?? null,
    });
  });
