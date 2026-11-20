// Godkjente kildekoblinger for innlogget bruker (RLS: kun egne rader).
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { sourceStatusByAtom, type SourceStatus } from "@/lib/career-facts/source-status";

export const careerAtomSourcesKey = (uid: string) => ["career-atom-sources", uid] as const;

export function careerAtomSourcesQuery(uid: string) {
  return queryOptions({
    queryKey: careerAtomSourcesKey(uid),
    enabled: !!uid,
    queryFn: async (): Promise<Map<string, SourceStatus>> => {
      const { data, error } = await supabase
        .from("career_atom_sources")
        .select("atom_id, document_id")
        .eq("user_id", uid);
      if (error) throw error;
      const rows = (data ?? []) as Array<{ atom_id: string; document_id: string | null }>;
      const docIds = Array.from(
        new Set(rows.map((r) => r.document_id).filter((d): d is string => !!d)),
      );
      const docs = new Map<string, { deleted: boolean }>();
      for (let i = 0; i < docIds.length; i += 200) {
        const { data: d, error: dErr } = await supabase
          .from("documents")
          .select("id, deleted_at")
          .in("id", docIds.slice(i, i + 200));
        if (dErr) throw dErr;
        for (const x of (d ?? []) as Array<{ id: string; deleted_at: string | null }>)
          docs.set(x.id, { deleted: Boolean(x.deleted_at) });
      }
      return sourceStatusByAtom(
        rows.map((r) => ({
          atom_id: r.atom_id,
          document_id: r.document_id,
          document_exists: r.document_id ? docs.has(r.document_id) : false,
          document_deleted: r.document_id ? (docs.get(r.document_id)?.deleted ?? false) : false,
        })),
      );
    },
  });
}
