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
  USER_NOTE_MAX,
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

const archiveSchema = z.object({
  intakeId: z.string().uuid(),
  archived: z.boolean(),
  note: z.string().trim().max(USER_NOTE_MAX).optional(),
});

/**
 * Merker en kilde som «bare arkivert» (krever ingen handling), eller angrer.
 * Reversibelt: kilden kan senere få en type og behandles videre.
 */
export const setCareerMaterialArchived = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => archiveSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: own } = await context.supabase
      .from("career_material_intakes")
      .select("id")
      .eq("id", data.intakeId)
      .maybeSingle();
    if (!own) return { status: "not_found" as const };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: status, error } = await supabaseAdmin.rpc("career_material_set_archived", {
      p_intake_id: data.intakeId,
      p_user_id: context.userId,
      p_archived: data.archived,
      p_note: data.note && data.note.length > 0 ? data.note : null,
    } as never);
    if (error) return { status: "error" as const };
    return { status: (status ?? "error") as "ok" | "in_progress" | "not_found" | "error" };
  });

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const approveSchema = z.object({
  proposalId: z.string().uuid(),
  editedContent: z.string().trim().max(400).nullable(),
  reviewerComment: z.string().trim().max(1000).nullable(),
  eventStart: isoDate.nullable(),
  eventEnd: isoDate.nullable(),
  eventPrecision: z.enum(["day", "month", "year"]).nullable(),
  targetAtomId: z.string().uuid().nullable(),
  /** Brukeren har eksplisitt valgt å oppdatere datoen på eksisterende oppføring. */
  applyEventDate: z.boolean().default(false),
});

export type ApproveCareerProposalStatus =
  | "approved"
  | "linked"
  | "already_approved"
  | "not_found"
  | "not_pending"
  | "invalid_edit"
  | "invalid_date"
  | "invalid_payload"
  | "needs_evidence"
  | "target_not_found"
  | "date_less_precise"
  | "error";

/**
 * Godkjenner et forslag fra karrieremateriale i én transaksjon: profil-
 * oppføring (eller kobling til en eksisterende), kildekobling og status.
 * Gjentatte kall gir samme resultat uten duplikater.
 */
export const approveCareerMaterialProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => approveSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: own } = await context.supabase
      .from("atom_enrichment_proposals")
      .select("id")
      .eq("id", data.proposalId)
      .eq("source_type", "career_material")
      .maybeSingle();
    if (!own) return { status: "not_found" as ApproveCareerProposalStatus, atomId: null };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin.rpc("career_material_approve_proposal", {
      p_proposal_id: data.proposalId,
      p_user_id: context.userId,
      p_edited_content: data.editedContent ?? null,
      p_reviewer_comment: data.reviewerComment ?? null,
      p_event_start: data.eventStart ?? null,
      p_event_end: data.eventEnd ?? null,
      p_event_precision: data.eventPrecision ?? null,
      p_target_atom_id: data.targetAtomId ?? null,
      p_apply_event_date: data.applyEventDate === true,
    } as never);
    if (error) {
      console.error("[career-material] approve failed", error.code ?? "unknown");
      return { status: "error" as ApproveCareerProposalStatus, atomId: null };
    }
    const row = (Array.isArray(rows) ? rows[0] : null) as {
      status: string;
      atom_id: string | null;
    } | null;
    return {
      status: (row?.status ?? "error") as ApproveCareerProposalStatus,
      atomId: row?.atom_id ?? null,
    };
  });

const cvSchema = z.object({ intakeId: z.string().uuid() });

/** Kopien CV-importen leser, én per kildedokument (ingen tidsstempel). */
export function cvImportCopyPath(userId: string, documentId: string, isPdf: boolean): string {
  return `${userId}/career-material-${documentId}.${isPdf ? "pdf" : "docx"}`;
}

/**
 * Sender en mottatt CV-fil til den vanlige CV-importen etter brukerens valg.
 * Originalen i arkivet beholdes; en kopi legges der CV-importen leser.
 * Gjentatte klikk gir samme import så lenge den ikke har feilet.
 * Profilen endres ikke før brukeren går gjennom CV-en i CV-flyten.
 */
export const sendCareerMaterialToCvImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => cvSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: intake } = await context.supabase
      .from("career_material_intakes")
      .select("id, document_id")
      .eq("id", data.intakeId)
      .maybeSingle();
    if (!intake) return { status: "not_found" as const, importId: null };
    const { data: doc } = await context.supabase
      .from("documents")
      .select("id, file_path, file_name, mime_type, deleted_at")
      .eq("id", intake.document_id)
      .maybeSingle();
    if (!doc || doc.deleted_at || !doc.file_path)
      return { status: "no_file" as const, importId: null };
    const mime = doc.mime_type ?? "";
    const isPdf = mime === "application/pdf";
    const isDocx = mime.includes("wordprocessingml");
    if (!isPdf && !isDocx) return { status: "unsupported" as const, importId: null };

    const { data: existing } = await context.supabase
      .from("cv_imports")
      .select("id, status")
      .eq("source_document_id", doc.id)
      .neq("status", "failed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) return { status: "exists" as const, importId: existing.id as string };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Filen må ligge under brukerens egen mappe i arkivet.
    if (!doc.file_path.startsWith(`${context.userId}/`))
      return { status: "no_file" as const, importId: null };
    const { data: blob, error: dlErr } = await supabaseAdmin.storage
      .from("career-material")
      .download(doc.file_path);
    if (dlErr || !blob) return { status: "error" as const, importId: null };
    const safeName = (doc.file_name ?? (isPdf ? "cv.pdf" : "cv.docx"))
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .slice(0, 120);
    // Fast bane per kildedokument: et avbrutt forsøk etterlater høyst én kopi,
    // og neste forsøk skriver over den i stedet for å lage en ny.
    const path = cvImportCopyPath(context.userId, doc.id, isPdf);
    const { error: upErr } = await supabaseAdmin.storage
      .from("cv-uploads")
      .upload(path, blob, { contentType: mime, upsert: true });
    if (upErr) return { status: "error" as const, importId: null };
    const { data: row, error: insErr } = await context.supabase
      .from("cv_imports")
      .insert({
        user_id: context.userId,
        import_type: isPdf ? "old_cv_pdf" : "old_cv_docx",
        source_filename: doc.file_name ?? safeName,
        source_file_path: path,
        source_document_id: doc.id,
        status: "pending",
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (insErr || !row) {
      if (insErr?.code === "23505") {
        // Samtidig klikk: den andre forespørselen opprettet importen.
        const { data: other } = await context.supabase
          .from("cv_imports")
          .select("id")
          .eq("source_document_id", doc.id)
          .neq("status", "failed")
          .limit(1)
          .maybeSingle();
        if (other) return { status: "exists" as const, importId: other.id as string };
      }
      // Fjern kopien bare når ingen import peker på den (f.eks. en tidligere feilet import).
      const { count } = await context.supabase
        .from("cv_imports")
        .select("id", { count: "exact", head: true })
        .eq("source_file_path", path);
      if (!count) await supabaseAdmin.storage.from("cv-uploads").remove([path]);
      return { status: "error" as const, importId: null };
    }
    return { status: "created" as const, importId: row.id as string };
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
