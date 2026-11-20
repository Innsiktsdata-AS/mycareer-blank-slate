/**
 * Bakgrunnsarbeider for karrieremateriale (server-only).
 *
 * Kjøres av planlagt jobb hvert minutt. Brukeren trenger ikke åpne siden.
 *
 * Kontrakt:
 *  - single-flight: én lås i databasen; en samtidig kjøring avslutter straks,
 *  - begrenset arbeid per kjøring (antall og tidsbudsjett),
 *  - varig kø med claim/lease for vedlegg og inntak; krasj gir utløpt lease
 *    som plukkes opp igjen, og ferdige elementer behandles aldri på nytt,
 *  - eksponentiell ventetid ved feil, og maks antall automatiske forsøk,
 *  - kretsbryter: konfigurasjonsfeil eller avvisning fra analysetjenesten
 *    setter en varig pause; da prøves høyst ett element per kjøring, og
 *    pausen oppheves først etter et vellykket forsøk. Ved 429 stoppes
 *    kjøringen og resten venter til neste kjøring.
 *
 * Logger aldri innhold, filnavn, e-postadresser eller nøkler.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { AttachmentKind } from "./contract";
import { downloadResendAttachment, extractAttachmentText, sha256Bytes } from "./attachments.server";
import { createCareerMaterial, processCareerMaterialIntake } from "./store.server";

type Admin = SupabaseClient<Database>;
type LooseRpc = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { code?: string } | null }>;
};

export const CAREER_MATERIAL_BUCKET = "career-material";

export const WORKER_LIMITS = {
  attachmentsPerRun: 3,
  intakesPerRun: 3,
  /** Nye elementer startes ikke etter dette (millisekunder siden start). */
  timeBudgetMs: 40_000,
  leaseSeconds: 150,
  gcPerRun: 20,
};

const MIME: Record<AttachmentKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export type StoragePort = {
  upload: (path: string, bytes: Uint8Array, contentType: string) => Promise<boolean>;
  remove: (paths: string[]) => Promise<boolean>;
};

export function adminStorage(admin: Admin): StoragePort {
  return {
    upload: async (path, bytes, contentType) => {
      const { error } = await admin.storage
        .from(CAREER_MATERIAL_BUCKET)
        .upload(path, bytes, { contentType, upsert: true });
      return !error;
    },
    remove: async (paths) => {
      if (paths.length === 0) return true;
      const { error } = await admin.storage.from(CAREER_MATERIAL_BUCKET).remove(paths);
      return !error;
    },
  };
}

export type WorkerDeps = {
  admin: Admin;
  resendApiKey: string | null;
  storage?: StoragePort;
  download?: typeof downloadResendAttachment;
  extract?: typeof extractAttachmentText;
  processIntake?: typeof processCareerMaterialIntake;
  now?: () => number;
  limits?: Partial<typeof WORKER_LIMITS>;
};

export type WorkerSummary = {
  skipped?: "locked";
  pausedAtStart: string | null;
  gcRemoved: number;
  attachments: Record<string, number>;
  intakes: Record<string, number>;
  stoppedBy: "rate_limited" | "paused" | "time_budget" | null;
  pausedNow: string | null;
};

type ClaimedAttachment = {
  id: string;
  user_id: string;
  inbound_delivery_id: string;
  parent_intake_id: string | null;
  provider_email_id: string;
  provider_attachment_id: string | null;
  filename: string | null;
  content_type: string | null;
  declared_size_bytes: number | null;
  kind: string | null;
  claim_token: string;
  attempt_count: number;
};

function bump(map: Record<string, number>, key: string) {
  map[key] = (map[key] ?? 0) + 1;
}

export function attachmentTitle(filename: string | null, createdAt: Date = new Date()): string {
  const base = (filename ?? "")
    .replace(/\.[A-Za-z0-9]{1,8}$/, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);
  return base.length >= 3 ? base : `Vedlegg ${createdAt.toISOString().slice(0, 10)}`;
}

async function finishAttachment(
  admin: Admin,
  row: ClaimedAttachment,
  fields: {
    status: string;
    errorCode?: string | null;
    retryable?: boolean | null;
    storagePath?: string | null;
    fileSha256?: string | null;
    sizeBytes?: number | null;
    pageCount?: number | null;
    extractedChars?: number | null;
    intakeId?: string | null;
    documentId?: string | null;
  },
): Promise<string> {
  const { data, error } = await (admin as unknown as LooseRpc).rpc(
    "career_material_attachment_finish",
    {
      p_id: row.id,
      p_claim_token: row.claim_token,
      p_status: fields.status,
      p_error_code: fields.errorCode ?? null,
      p_retryable: fields.retryable ?? null,
      p_storage_path: fields.storagePath ?? null,
      p_file_sha256: fields.fileSha256 ?? null,
      p_size_bytes: fields.sizeBytes ?? null,
      p_page_count: fields.pageCount ?? null,
      p_extracted_chars: fields.extractedChars ?? null,
      p_intake_id: fields.intakeId ?? null,
      p_document_id: fields.documentId ?? null,
    },
  );
  if (error) {
    console.error("[career-material-worker] finish failed", error.code ?? "unknown");
    return "error";
  }
  return typeof data === "string" ? data : "error";
}

/** Henter, validerer, lagrer og leser ett vedlegg. Returnerer endelig status. */
export async function processClaimedAttachment(
  deps: Required<Pick<WorkerDeps, "admin" | "storage" | "download" | "extract">> & {
    resendApiKey: string | null;
  },
  row: ClaimedAttachment,
): Promise<string> {
  const { admin, storage } = deps;
  const kind = row.kind === "pdf" || row.kind === "docx" ? row.kind : null;
  if (!kind || !row.provider_attachment_id) {
    await finishAttachment(admin, row, {
      status: "failed",
      errorCode: "missing_attachment_id",
      retryable: false,
    });
    return "failed";
  }
  if (!deps.resendApiKey) {
    await finishAttachment(admin, row, {
      status: "failed",
      errorCode: "resend_not_configured",
      retryable: true,
    });
    return "failed";
  }

  const dl = await deps.download({
    emailId: row.provider_email_id,
    attachmentId: row.provider_attachment_id,
    apiKey: deps.resendApiKey,
  });
  if (!dl.ok) {
    if (dl.reason === "file_too_large") {
      await finishAttachment(admin, row, { status: "too_large", errorCode: "file_too_large" });
      return "too_large";
    }
    await finishAttachment(admin, row, {
      status: "failed",
      errorCode: dl.reason,
      retryable: dl.kind === "retryable",
    });
    return "failed";
  }

  const bytes = dl.bytes;
  const fileSha = sha256Bytes(bytes);
  const extracted = await deps.extract(bytes, kind);
  const path = `${row.user_id}/${row.id}.${kind}`;

  if (!extracted.ok) {
    // Gyldige filer uten lesbar tekst (skannet/passord) lagres slik at
    // brukeren kan laste ned originalen. Andre filer lagres ikke.
    let storagePath: string | null = null;
    if (extracted.status === "no_text" || extracted.status === "encrypted") {
      const stored = await storage.upload(path, bytes, MIME[kind]);
      if (!stored) {
        await finishAttachment(admin, row, {
          status: "failed",
          errorCode: "storage_failed",
          retryable: true,
        });
        return "failed";
      }
      storagePath = path;
    }
    await finishAttachment(admin, row, {
      status: extracted.status,
      errorCode: extracted.errorCode,
      storagePath,
      fileSha256: fileSha,
      sizeBytes: bytes.length,
      pageCount: extracted.pageCount ?? null,
    });
    return extracted.status;
  }

  const stored = await storage.upload(path, bytes, MIME[kind]);
  if (!stored) {
    await finishAttachment(admin, row, {
      status: "failed",
      errorCode: "storage_failed",
      retryable: true,
    });
    return "failed";
  }

  const created = await createCareerMaterial(admin, {
    userId: row.user_id,
    channel: "email",
    title: attachmentTitle(row.filename),
    text: extracted.text,
    declaredType: null,
    inboundDeliveryId: row.inbound_delivery_id,
    truncated: extracted.truncated,
    file: { path, name: row.filename, mimeType: MIME[kind], sizeBytes: bytes.length },
  });
  if (!created.ok) {
    await finishAttachment(admin, row, {
      status: "failed",
      errorCode: "store_failed",
      retryable: true,
    });
    return "failed";
  }

  let status = "extracted";
  let storagePath: string | null = path;
  if (created.status === "duplicate") {
    // Samme tekst fantes fra før. Er det vår egen original (nytt forsøk etter
    // avbrudd), er vedlegget allerede ferdig lest; ellers er det en ekte
    // duplikat, og den ekstra filen fjernes.
    const { data: doc } = await admin
      .from("documents")
      .select("file_path")
      .eq("id", created.documentId)
      .eq("user_id", row.user_id)
      .maybeSingle();
    if (doc?.file_path !== path) {
      status = "duplicate";
      storagePath = null;
      await storage.remove([path]);
    }
  }

  const fin = await finishAttachment(admin, row, {
    status,
    storagePath,
    fileSha256: fileSha,
    sizeBytes: bytes.length,
    pageCount: extracted.pageCount,
    extractedChars: extracted.text.length,
    intakeId: created.intakeId,
    documentId: created.documentId,
  });
  return fin === "ok" ? status : `finish_${fin}`;
}

export async function runCareerMaterialWorker(deps: WorkerDeps): Promise<WorkerSummary> {
  const admin = deps.admin;
  const loose = admin as unknown as LooseRpc;
  const limits = { ...WORKER_LIMITS, ...(deps.limits ?? {}) };
  const now = deps.now ?? Date.now;
  const started = now();
  const storage = deps.storage ?? adminStorage(admin);
  const download = deps.download ?? downloadResendAttachment;
  const extract = deps.extract ?? extractAttachmentText;
  const processIntake = deps.processIntake ?? processCareerMaterialIntake;
  const owner = `career-worker:${crypto.randomUUID()}`;

  const summary: WorkerSummary = {
    pausedAtStart: null,
    gcRemoved: 0,
    attachments: {},
    intakes: {},
    stoppedBy: null,
    pausedNow: null,
  };

  const { data: acq, error: acqErr } = await loose.rpc("career_material_worker_acquire", {
    p_owner: owner,
    p_lease_seconds: limits.leaseSeconds,
  });
  if (acqErr) throw new Error("worker_acquire_failed");
  const acqRow = (Array.isArray(acq) ? acq[0] : acq) as
    | { acquired: boolean; paused_reason: string | null }
    | undefined;
  if (!acqRow?.acquired) {
    return { ...summary, skipped: "locked", pausedAtStart: acqRow?.paused_reason ?? null };
  }
  summary.pausedAtStart = acqRow.paused_reason ?? null;
  summary.pausedNow = summary.pausedAtStart;

  let pauseReason: string | null = null;
  let pauseCode: string | null = null;
  let clearPause = false;
  const overBudget = () => now() - started > limits.timeBudgetMs;

  try {
    // 1. Opprydding av filer der kilden er slettet.
    const { data: gc } = await loose.rpc("career_material_storage_gc_candidates", {
      p_limit: limits.gcPerRun,
    });
    const gcRows = (Array.isArray(gc) ? gc : []) as Array<{ id: string; storage_path: string }>;
    if (gcRows.length > 0 && (await storage.remove(gcRows.map((r) => r.storage_path)))) {
      const { data: n } = await loose.rpc("career_material_storage_gc_done", {
        p_ids: gcRows.map((r) => r.id),
      });
      summary.gcRemoved = typeof n === "number" ? n : 0;
    }

    // 2. Vedlegg (ingen KI her — bare henting og tekstlesing).
    for (let i = 0; i < limits.attachmentsPerRun; i += 1) {
      if (overBudget()) {
        summary.stoppedBy = "time_budget";
        break;
      }
      const { data: claimed, error } = await loose.rpc("career_material_attachment_claim_next", {
        p_lease_seconds: limits.leaseSeconds,
      });
      if (error) {
        bump(summary.attachments, "claim_error");
        break;
      }
      const row = (Array.isArray(claimed) ? claimed[0] : null) as ClaimedAttachment | null;
      if (!row) break;
      try {
        const status = await processClaimedAttachment(
          { admin, storage, download, extract, resendApiKey: deps.resendApiKey },
          row,
        );
        bump(summary.attachments, status);
      } catch (err) {
        console.error(
          "[career-material-worker] attachment crashed",
          err instanceof Error ? err.name : "unknown",
        );
        await finishAttachment(admin, row, {
          status: "failed",
          errorCode: "worker_exception",
          retryable: true,
        });
        bump(summary.attachments, "failed");
      }
    }

    // 3. Analyse av inntak. Under pause: høyst ett prøveelement.
    if (!summary.stoppedBy) {
      const paused = Boolean(summary.pausedAtStart);
      const { data: due } = await loose.rpc("career_material_due_intakes", {
        p_limit: paused ? 1 : limits.intakesPerRun,
      });
      const dueRows = (Array.isArray(due) ? due : []) as Array<{
        intake_id: string;
        user_id: string;
      }>;
      for (const d of dueRows) {
        if (overBudget()) {
          summary.stoppedBy = "time_budget";
          break;
        }
        const res = await processIntake(admin, {
          userId: d.user_id,
          intakeId: d.intake_id,
          force: false,
        });
        bump(summary.intakes, res.status === "failed" ? `failed:${res.errorCode}` : res.status);
        if (res.status === "completed" || res.status === "needs_type") {
          if (paused) clearPause = true;
          continue;
        }
        if (res.status === "failed" && res.pause === "rate_limited") {
          summary.stoppedBy = "rate_limited";
          break;
        }
        if (
          res.status === "failed" &&
          (res.pause === "configuration" || res.pause === "provider_blocked")
        ) {
          pauseReason = res.pause;
          pauseCode = res.errorCode;
          clearPause = false;
          summary.stoppedBy = "paused";
          break;
        }
      }
    }
  } finally {
    if (pauseReason) summary.pausedNow = pauseReason;
    else if (clearPause) summary.pausedNow = null;
    await loose.rpc("career_material_worker_release", {
      p_owner: owner,
      p_summary: summary,
      p_pause_reason: pauseReason,
      p_pause_error_code: pauseCode,
      p_clear_pause: clearPause,
    });
  }
  return summary;
}
