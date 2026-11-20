/**
 * Regresjon: når dokumenttypen er usikker (ingen effektiv type) må lagrings-
 * kallet sende p_effective_type/p_input_signature som eksplisitt null. Et
 * utelatt felt gir PGRST202 i produksjon fordi parameterne mangler standard-
 * verdi i databasen. Syntetiske data; ingen nettverk.
 */
import { describe, expect, it } from "vitest";
import { processCareerMaterialIntake } from "@/lib/career-material/store.server";
import { sha256Hex } from "@/lib/career-material/analysis.server";

const TEXT = "Syntetisk notat om et prosjekt uten tydelig dokumenttype.";

function fakeAdmin(storeCalls: Array<Record<string, unknown>>) {
  const rows: Record<string, Record<string, unknown>> = {
    career_material_intakes: {
      id: "intake-1",
      document_id: "doc-1",
      content_sha256: sha256Hex(TEXT),
      declared_type: null,
      user_type: null,
    },
    documents: { id: "doc-1", title: "Syntetisk", content_text: TEXT },
  };
  const query = (table: string) => {
    const q = {
      select: () => q,
      eq: () => q,
      maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
      then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    };
    return q;
  };
  return {
    from: query,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "career_material_claim")
        return {
          data: [{ status: "claimed", claim_token: "tok", attempt_number: 1 }],
          error: null,
        };
      if (fn === "internal_ai_get_active_profile")
        return { data: { profile_id: "p", model_id: "m", max_tokens: 1000 }, error: null };
      if (fn === "career_material_store_analysis") {
        storeCalls.push(args);
        // Etterligner PostgREST: manglende parameter uten standardverdi → PGRST202.
        if (args["p_effective_type"] === undefined || args["p_input_signature"] === undefined)
          return { data: null, error: { code: "PGRST202" } };
        return {
          data: [
            {
              status: args["p_effective_type"] === null ? "needs_type" : "completed",
              batch_id: null,
              created_count: 0,
              reused_count: 0,
              superseded_count: 0,
            },
          ],
          error: null,
        };
      }
      if (fn === "career_material_fail") return { data: null, error: null };
      if (fn === "career_material_set_recognized_kind") {
        // Etterligner PostgREST: p_kind må sendes (null, ikke undefined).
        if (args["p_kind"] === undefined) return { data: null, error: { code: "PGRST202" } };
        return { data: "ok", error: null };
      }
      throw new Error(`uventet rpc ${fn}`);
    },
  };
}

const deps = (dokumenttype: string, sikkerhet: number) => ({
  isModelRuntimeConfigured: async () => true,
  callModel: (async () => ({
    ok: true,
    text: JSON.stringify({ dokumenttype, sikkerhet, begrunnelse: "syntetisk" }),
  })) as never,
});

describe("processCareerMaterialIntake — usikker type", () => {
  it("sender eksplisitt null og havner i «velg type», ikke store_failed", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const res = await processCareerMaterialIntake(
      fakeAdmin(calls) as never,
      { userId: "user-1", intakeId: "intake-1", force: false },
      deps("ukjent", 0.2),
    );
    expect(res).toEqual({ status: "needs_type" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveProperty("p_effective_type", null);
    expect(calls[0]).toHaveProperty("p_input_signature", null);
  });

  it("sikker type sender type og signatur", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const res = await processCareerMaterialIntake(
      fakeAdmin(calls) as never,
      { userId: "user-1", intakeId: "intake-1", force: false },
      deps("prosjektnotat", 0.95),
    );
    expect(res.status).toBe("completed");
    expect(calls[0]?.["p_effective_type"]).toBe("prosjektnotat");
    expect(typeof calls[0]?.["p_input_signature"]).toBe("string");
  });
});
