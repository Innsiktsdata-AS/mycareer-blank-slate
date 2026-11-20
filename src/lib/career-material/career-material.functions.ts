/**
 * Serverfunksjoner for karrieremateriale. Alle krever innlogget bruker;
 * bruker-ID kommer fra verifisert token, aldri fra forespørselen.
 * Eierskap sjekkes med brukerens egen klient (RLS) før adminklienten
 * brukes til tjenestefunksjonene.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  CAREER_MATERIAL_TYPES,
  DAILY_INTAKE_LIMIT,
  PASTE_TEXT_MAX,
  PASTE_TEXT_MIN,
  PASTE_TITLE_MAX,
  PASTE_TITLE_MIN,
} from "./contract";

const pasteSchema = z.object({
  title: z.string().trim().min(PASTE_TITLE_MIN).max(PASTE_TITLE_MAX),
  text: z.string().trim().min(PASTE_TEXT_MIN).max(PASTE_TEXT_MAX),
  declaredType: z.enum(CAREER_MATERIAL_TYPES).nullable(),
});

export const submitCareerMaterialPaste = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => pasteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await context.supabase
      .from("career_material_intakes")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since);
    if ((count ?? 0) >= DAILY_INTAKE_LIMIT) {
      return { ok: false as const, errorCode: "daily_limit" };
    }
    const [{ supabaseAdmin }, { createCareerMaterial }] = await Promise.all([
      import("@/integrations/supabase/client.server"),
      import("./store.server"),
    ]);
    const result = await createCareerMaterial(supabaseAdmin, {
      userId: context.userId,
      channel: "paste",
      title: data.title,
      text: data.text,
      declaredType: data.declaredType,
    });
    if (!result.ok) return { ok: false as const, errorCode: result.reason };
    return {
      ok: true as const,
      status: result.status,
      intakeId: result.intakeId,
      documentId: result.documentId,
    };
  });

const processSchema = z.object({
  intakeId: z.string().uuid(),
  force: z.boolean().default(false),
});

export const processCareerMaterial = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => processSchema.parse(input))
  .handler(async ({ data, context }) => {
    // Eierskap via RLS: andre brukeres inntak er usynlige her.
    const { data: own } = await context.supabase
      .from("career_material_intakes")
      .select("id")
      .eq("id", data.intakeId)
      .maybeSingle();
    if (!own) return { status: "not_found" as const };
    const [{ supabaseAdmin }, { processCareerMaterialIntake }] = await Promise.all([
      import("@/integrations/supabase/client.server"),
      import("./store.server"),
    ]);
    return await processCareerMaterialIntake(supabaseAdmin, {
      userId: context.userId,
      intakeId: data.intakeId,
      force: data.force,
    });
  });

const setTypeSchema = z.object({
  intakeId: z.string().uuid(),
  type: z.enum(CAREER_MATERIAL_TYPES),
});

export const setCareerMaterialType = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => setTypeSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: own } = await context.supabase
      .from("career_material_intakes")
      .select("id")
      .eq("id", data.intakeId)
      .maybeSingle();
    if (!own) return { status: "not_found" as const };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: status, error } = await supabaseAdmin.rpc("career_material_set_type", {
      p_intake_id: data.intakeId,
      p_user_id: context.userId,
      p_type: data.type,
    });
    if (error) return { status: "error" as const };
    return { status: (status ?? "error") as "ok" | "in_progress" | "not_found" | "error" };
  });

const deleteSchema = z.object({
  intakeId: z.string().uuid(),
  removeApprovedAtoms: z.boolean(),
});

/**
 * Sletter én kilde: originalen, inntaket, alle forslag fra den og eventuelle
 * vedleggsfiler. Godkjente elementer i profilen beholdes, med mindre brukeren
 * eksplisitt velger å fjerne dem (de arkiveres da som ved vanlig sletting).
 */
export const deleteCareerMaterial = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => deleteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: own } = await context.supabase
      .from("career_material_intakes")
      .select("id, document_id")
      .eq("id", data.intakeId)
      .maybeSingle();
    if (!own) return { status: "not_found" as const, removedAtoms: 0 };

    let removedAtoms = 0;
    if (data.removeApprovedAtoms) {
      const { data: props, error } = await context.supabase
        .from("atom_enrichment_proposals")
        .select("applied_atom_id")
        .eq("source_type", "career_material")
        .eq("source_record_id", own.document_id)
        .eq("status", "approved")
        .eq("proposal_action", "create_atom")
        .not("applied_atom_id", "is", null);
      if (error) return { status: "error" as const, removedAtoms: 0 };
      const ids = Array.from(
        new Set(
          ((props ?? []) as Array<{ applied_atom_id: string | null }>)
            .map((p) => p.applied_atom_id)
            .filter((v): v is string => !!v),
        ),
      );
      // Som brukeren selv (RLS): bare egne elementer kan berøres.
      for (const atomId of ids) {
        const { error: delErr } = await context.supabase.rpc("career_atom_delete", {
          p_atom_id: atomId,
        });
        if (delErr) return { status: "error" as const, removedAtoms };
        removedAtoms += 1;
      }
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error: delErr } = await supabaseAdmin.rpc("career_material_delete", {
      p_intake_id: data.intakeId,
      p_user_id: context.userId,
    });
    if (delErr) return { status: "error" as const, removedAtoms };
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row || row.status !== "deleted") return { status: "not_found" as const, removedAtoms };
    const paths = (row.storage_paths ?? []).filter((p: string) =>
      p.startsWith(`${context.userId}/`),
    );
    if (paths.length > 0) {
      const { error: rmErr } = await supabaseAdmin.storage.from("career-material").remove(paths);
      if (rmErr) console.error("[career-material] storage remove failed");
    }
    return { status: "deleted" as const, removedAtoms };
  });

const attachmentDeleteSchema = z.object({ attachmentId: z.string().uuid() });

/** Fjerner et vedlegg som ikke ble en kilde (f.eks. skannet PDF), med fil. */
export const deleteCareerAttachment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => attachmentDeleteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: own } = await context.supabase
      .from("career_material_attachments")
      .select("id")
      .eq("id", data.attachmentId)
      .maybeSingle();
    if (!own) return { status: "not_found" as const };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin.rpc("career_material_attachment_delete", {
      p_id: data.attachmentId,
      p_user_id: context.userId,
    });
    if (error) return { status: "error" as const };
    const row = Array.isArray(rows) ? rows[0] : null;
    const status = (row?.status ?? "error") as
      | "deleted"
      | "not_found"
      | "in_progress"
      | "has_source"
      | "error";
    if (status === "deleted" && row?.storage_path?.startsWith(`${context.userId}/`)) {
      await supabaseAdmin.storage.from("career-material").remove([row.storage_path]);
    }
    return { status };
  });

type AddressState = {
  address: string | null;
  hasAlias: boolean;
  receivingConfigured: boolean;
};

async function readReceivingConfigured(): Promise<{ ok: boolean; domain: string | null }> {
  const { readInboundConfig } = await import("@/lib/job-leads/inbound-email.server");
  const cfg = readInboundConfig();
  return cfg.ok ? { ok: true, domain: cfg.config.domain } : { ok: false, domain: null };
}

export const getCareerNotesAddress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AddressState> => {
    const { data } = await context.supabase
      .from("email_job_sources")
      .select("inbound_alias_token")
      .eq("intake_mode", "career_material")
      .not("inbound_alias_token", "is", null)
      .limit(1)
      .maybeSingle();
    const token = data?.inbound_alias_token ?? null;
    const cfg = await readReceivingConfigured();
    return {
      // Adressen vises bare når mottaket faktisk er konfigurert.
      address: token && cfg.ok && cfg.domain ? `${token}@${cfg.domain}` : null,
      hasAlias: Boolean(token),
      receivingConfigured: cfg.ok,
    };
  });

export const createCareerNotesAddress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AddressState & { ok: boolean }> => {
    const [{ supabaseAdmin }, { ensureInboundAlias }] = await Promise.all([
      import("@/integrations/supabase/client.server"),
      import("@/lib/job-leads/inbound-alias.server"),
    ]);
    const result = await ensureInboundAlias(
      supabaseAdmin as never,
      context.userId,
      "career_material",
    );
    const cfg = await readReceivingConfigured();
    if (!result.ok)
      return { ok: false, address: null, hasAlias: false, receivingConfigured: cfg.ok };
    return {
      ok: true,
      address: cfg.ok && cfg.domain ? `${result.token}@${cfg.domain}` : null,
      hasAlias: true,
      receivingConfigured: cfg.ok,
    };
  });
