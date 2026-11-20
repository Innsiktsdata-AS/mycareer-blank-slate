/**
 * Karrieremateriale — lagring og behandling (server-only).
 *
 * Kalles bare etter at brukeren er autentisert (serverfunksjoner) eller
 * etter verifisert webhook + alias-eierskap (e-post). `userId` kommer alltid
 * fra verifisert kontekst, aldri fra forespørselen.
 *
 * Logger aldri tekstinnhold, e-postinnhold eller nøkler — bare koder.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import {
  CAREER_MATERIAL_NORMALIZER_VERSION,
  CAREER_MATERIAL_PROMPT_VERSION,
  CAREER_MATERIAL_SYSTEM_PROMPT,
  CAREER_MATERIAL_TASK_KEY,
  analysisSignature,
  buildCareerMaterialProposals,
  buildCareerMaterialUserMessage,
  dropCoveredByApproved,
  normalizeOriginalText,
  parseModelJson,
  resolveEffectiveType,
  sha256Hex,
  validateAnalysis,
} from "./analysis.server";
import {
  isCareerMaterialType,
  type CareerMaterialAttachment,
  type CareerMaterialType,
} from "./contract";

type Admin = SupabaseClient<Database>;

export type CreateCareerMaterialInput = {
  userId: string;
  channel: "paste" | "email";
  title: string;
  text: string;
  declaredType: CareerMaterialType | null;
  inboundDeliveryId?: string | null;
  attachments?: CareerMaterialAttachment[];
  truncated?: boolean;
  /** Bare for vedlegg: originalfilen i privat lagring. */
  file?: { path: string; name: string | null; mimeType: string; sizeBytes: number };
};

export type CreateCareerMaterialResult =
  | { ok: true; status: "created" | "duplicate"; intakeId: string; documentId: string }
  | { ok: false; reason: string };

/** Lagrer originalen først — dokument og inntak opprettes atomisk i databasen. */
export async function createCareerMaterial(
  admin: Admin,
  input: CreateCareerMaterialInput,
): Promise<CreateCareerMaterialResult> {
  const text = normalizeOriginalText(input.text);
  if (!text) return { ok: false, reason: "empty_text" };
  const { data, error } = await admin.rpc("career_material_create", {
    p_user_id: input.userId,
    p_channel: input.channel,
    p_title: input.title.trim().slice(0, 200) || "Karrieremateriale",
    p_text: text,
    p_content_sha256: sha256Hex(text),
    p_declared_type: input.declaredType ?? undefined,
    p_inbound_delivery_id: input.inboundDeliveryId ?? undefined,
    p_attachments: (input.attachments ?? []) as unknown as Json,
    p_truncated: input.truncated ?? false,
    ...(input.file
      ? {
          p_source_context: "career_material_attachment",
          p_file_path: input.file.path,
          p_file_name: input.file.name ?? undefined,
          p_mime_type: input.file.mimeType,
          p_file_size_bytes: input.file.sizeBytes,
        }
      : {}),
  });
  if (error) {
    console.error("[career-material] create failed", error.code ?? "unknown");
    return { ok: false, reason: "create_failed" };
  }
  const row = Array.isArray(data) ? data[0] : null;
  if (!row?.intake_id || !row.document_id) return { ok: false, reason: "create_failed" };
  return {
    ok: true,
    status: row.status === "duplicate" ? "duplicate" : "created",
    intakeId: row.intake_id,
    documentId: row.document_id,
  };
}

export type ProcessResult =
  | { status: "completed"; created: number; reused: number; superseded: number }
  | { status: "needs_type" }
  | { status: "in_progress" | "already_done" | "not_found" | "attempt_limit" | "lease_lost" }
  | {
      status: "failed";
      errorCode: string;
      retryable: boolean;
      /** Brukes av bakgrunnsarbeideren til pause/stopp. */
      pause?: "configuration" | "provider_blocked" | "rate_limited";
    };

type ModelDeps = {
  callModel: typeof import("@/lib/ai-model/model.server").callModel;
  isModelRuntimeConfigured: typeof import("@/lib/ai-model/model.server").isModelRuntimeConfigured;
};

async function loadModelDeps(): Promise<ModelDeps> {
  const m = await import("@/lib/ai-model/model.server");
  return { callModel: m.callModel, isModelRuntimeConfigured: m.isModelRuntimeConfigured };
}

/**
 * Klassifiserer og atomiserer ett inntak under en lease. Resultatet skrives
 * atomisk sammen med forslagene; feil registreres med sikker feilkode.
 */
export async function processCareerMaterialIntake(
  admin: Admin,
  input: { userId: string; intakeId: string; force: boolean },
  deps?: ModelDeps,
): Promise<ProcessResult> {
  const { data: claimRows, error: claimErr } = await admin.rpc("career_material_claim", {
    p_intake_id: input.intakeId,
    p_user_id: input.userId,
    p_force: input.force,
    p_lease_seconds: 180,
  });
  if (claimErr) {
    console.error("[career-material] claim failed", claimErr.code ?? "unknown");
    return { status: "failed", errorCode: "store_failed", retryable: true };
  }
  const claim = Array.isArray(claimRows) ? claimRows[0] : null;
  if (!claim || claim.status !== "claimed" || !claim.claim_token) {
    const s = (claim?.status ?? "not_found") as
      | "in_progress"
      | "already_done"
      | "not_found"
      | "attempt_limit";
    return { status: s };
  }
  const token = claim.claim_token;

  const fail = async (
    errorCode: string,
    retryable: boolean,
    pause?: "configuration" | "provider_blocked" | "rate_limited",
  ): Promise<ProcessResult> => {
    await admin.rpc("career_material_fail", {
      p_intake_id: input.intakeId,
      p_user_id: input.userId,
      p_claim_token: token,
      p_error_code: errorCode,
      p_retryable: retryable,
    });
    return { status: "failed", errorCode, retryable, ...(pause ? { pause } : {}) };
  };

  try {
    const { data: intake } = await admin
      .from("career_material_intakes")
      .select("id, document_id, content_sha256, declared_type, user_type")
      .eq("id", input.intakeId)
      .eq("user_id", input.userId)
      .maybeSingle();
    if (!intake) return await fail("document_missing", false);

    const { data: doc } = await admin
      .from("documents")
      .select("id, title, content_text")
      .eq("id", intake.document_id)
      .eq("user_id", input.userId)
      .maybeSingle();
    if (!doc?.content_text) return await fail("document_missing", false);

    // Integritet: analysen skal alltid gjelde den lagrede originalen.
    if (sha256Hex(doc.content_text) !== intake.content_sha256) {
      return await fail("original_changed", false);
    }

    const model = deps ?? (await loadModelDeps());
    if (!(await model.isModelRuntimeConfigured()))
      return await fail("missing_api_key", true, "configuration");

    const { data: profileRow } = await (
      admin as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }>;
      }
    ).rpc("internal_ai_get_active_profile", { p_task_key: CAREER_MATERIAL_TASK_KEY });
    const p = profileRow as {
      profile_id?: string;
      profile_key?: string;
      model_id?: string;
      prompt_version?: string;
      max_tokens?: number;
      request_options?: Record<string, unknown>;
      capabilities?: Record<string, unknown>;
    } | null;
    if (!p?.model_id) return await fail("missing_profile", true, "configuration");

    const declaredType = isCareerMaterialType(intake.declared_type) ? intake.declared_type : null;
    const userType = isCareerMaterialType(intake.user_type) ? intake.user_type : null;
    const { message } = buildCareerMaterialUserMessage({
      title: doc.title,
      text: doc.content_text,
      declaredType: userType ?? declaredType,
    });

    const result = await model.callModel({
      profile: {
        profileId: String(p.profile_id ?? p.profile_key ?? CAREER_MATERIAL_TASK_KEY),
        taskKey: CAREER_MATERIAL_TASK_KEY,
        modelId: String(p.model_id),
        promptVersion: String(p.prompt_version ?? CAREER_MATERIAL_PROMPT_VERSION),
        maxTokens: Number(p.max_tokens ?? 6000),
        requestOptions: (p.request_options as Record<string, unknown>) ?? {},
        capabilities: {
          supportsTemperature: p.capabilities?.supportsTemperature === true,
          supportsTopP: p.capabilities?.supportsTopP === true,
          supportsTopK: p.capabilities?.supportsTopK === true,
          supportsThinking: p.capabilities?.supportsThinking === true,
          supportsPrefill: p.capabilities?.supportsPrefill === true,
        },
      },
      system: CAREER_MATERIAL_SYSTEM_PROMPT,
      messages: [{ role: "user", content: message }],
      correlationId: `career-material:${input.intakeId}`,
      timeoutMs: 120_000,
      maxRetries: 1,
    });

    if (!result.ok) {
      console.error("[career-material] model call failed", result.outcome, result.errorCode);
      if (result.outcome === "configuration_error")
        return await fail("missing_api_key", true, "configuration");
      if (result.status === 429) return await fail("rate_limited", true, "rate_limited");
      if (result.status === 401) return await fail("missing_api_key", true, "configuration");
      if (result.status === 402 || result.status === 403)
        return await fail("provider_blocked", true, "provider_blocked");
      return await fail(result.outcome === "timeout" ? "model_timeout" : "model_error", true);
    }

    const raw = parseModelJson(result.text);
    if (!raw) return await fail("invalid_model_output", true);
    const analysis = validateAnalysis(raw, doc.content_text.slice(0, 40_000));

    const effectiveType = resolveEffectiveType({
      userType,
      declaredType,
      aiType: analysis.aiType,
      aiConfidence: analysis.aiConfidence,
    });

    const built = effectiveType
      ? buildCareerMaterialProposals(analysis, {
          type: effectiveType,
          documentId: intake.document_id,
          intakeId: intake.id,
          title: doc.title,
        })
      : [];
    // Det som allerede er godkjent fra denne kilden foreslås ikke på nytt.
    const { data: approvedRows } = await admin
      .from("atom_enrichment_proposals")
      .select("id, proposal_payload, applied_atom_id")
      .eq("user_id", input.userId)
      .eq("source_type", "career_material")
      .eq("source_record_id", intake.document_id)
      .eq("status", "approved");
    const approvedList = (
      (approvedRows ?? []) as Array<{
        id: string;
        proposal_payload: Json;
        applied_atom_id: string | null;
      }>
    ).map((r) => {
      const pl = (r.proposal_payload ?? {}) as Record<string, unknown>;
      return {
        proposalId: r.id,
        atomType: typeof pl["atom_type"] === "string" ? (pl["atom_type"] as string) : null,
        names: [pl["content_no"], pl["skill_name"]].filter(
          (v): v is string => typeof v === "string",
        ),
        quote: typeof pl["source_quote"] === "string" ? (pl["source_quote"] as string) : null,
      };
    });
    const { items } = dropCoveredByApproved(built, approvedList);

    const { data: storeRows, error: storeErr } = await admin.rpc("career_material_store_analysis", {
      p_intake_id: input.intakeId,
      p_user_id: input.userId,
      p_claim_token: token,
      p_ai_type: analysis.aiType,
      p_ai_confidence: analysis.aiConfidence,
      p_ai_rationale: analysis.rationale,
      p_effective_type: effectiveType ?? undefined,
      p_input_signature: effectiveType
        ? analysisSignature({ contentSha256: intake.content_sha256, effectiveType })
        : undefined,
      p_prompt_version: CAREER_MATERIAL_PROMPT_VERSION,
      p_normalizer_version: CAREER_MATERIAL_NORMALIZER_VERSION,
      p_items: items as unknown as Json,
      p_items_dropped: analysis.dropped,
    } as never);
    if (storeErr) {
      console.error("[career-material] store failed", storeErr.code ?? "unknown");
      return await fail("store_failed", true);
    }
    const stored = (Array.isArray(storeRows) ? storeRows[0] : null) as {
      status: string;
      created_count: number;
      reused_count: number;
      superseded_count: number;
    } | null;
    if (!stored) return await fail("store_failed", true);
    if (stored.status === "needs_type") return { status: "needs_type" };
    if (stored.status === "lease_lost") return { status: "lease_lost" };
    if (stored.status !== "completed") return { status: "not_found" };
    return {
      status: "completed",
      created: stored.created_count,
      reused: stored.reused_count,
      superseded: stored.superseded_count,
    };
  } catch (err) {
    console.error(
      "[career-material] processing crashed",
      err instanceof Error ? err.name : "unknown",
    );
    return await fail("store_failed", true);
  }
}
