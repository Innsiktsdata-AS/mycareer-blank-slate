/**
 * Karrieremateriale via e-post (server-only).
 *
 * Kalles fra Resend-webhooken først etter gyldig Svix-signatur, eksakt
 * alias-domene, aliaseierskap (`career_material`-kilde), atomisk claim og
 * henting av full e-post fra Receiving API. Avsender og innhold styrer
 * aldri rutingen — det gjør bare hvilken alias som mottok e-posten.
 *
 * Webhooken holdes rask: e-postteksten lagres som original, og vedleggene
 * registreres i en varig kø. Bakgrunnsarbeideren henter og leser støttede
 * vedlegg (PDF med tekst, DOCX) og analyserer alt automatisk.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import type { ReceivedEmail } from "@/lib/job-leads/resend-receiving.server";
import { normalizeText } from "@/lib/job-leads/parse";
import {
  PASTE_TEXT_MIN,
  type AttachmentRegistration,
  type CareerMaterialAttachment,
} from "./contract";
import { planAttachments } from "./attachments.server";
import { createCareerMaterial } from "./store.server";

/** Maks lagret originaltekst fra e-post. Analysen bruker de første 40 000 tegnene. */
export const EMAIL_ORIGINAL_MAX = 200_000;

export function titleFromSubject(subject: string, receivedAt: Date): string {
  const cleaned = subject
    .replace(/^(\s*(fwd?|fw|vs|sv|re|wg|tr)\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  if (cleaned.length >= 3) return cleaned;
  return `Videresendt e-post ${receivedAt.toISOString().slice(0, 10)}`;
}

/** Tekst fra e-post: ren tekst foretrekkes, ellers HTML uten tagger. Linjeskift bevares. */
export function bodyTextFromEmail(email: Pick<ReceivedEmail, "text" | "html">): string {
  const text = (email.text ?? "").replace(/\r\n?/g, "\n").trim();
  if (text) return text;
  return email.html ? normalizeText("", email.html) : "";
}

/** Oppsummering på e-postinntaket: hva som skjer med hvert vedlegg. */
export function attachmentSummary(plan: AttachmentRegistration[]): CareerMaterialAttachment[] {
  return plan.map((p) => ({
    filename: p.filename,
    content_type: p.content_type,
    size_bytes: p.size_bytes,
    status: p.status,
    reason: p.error_code,
  }));
}

export type CareerEmailResult =
  | { ok: true; intakeId: string | null; duplicate: boolean; attachmentsQueued: number }
  | { ok: false; kind: "permanent" | "retryable"; reason: string };

export async function ingestCareerMaterialEmail(
  admin: SupabaseClient<Database>,
  input: { userId: string; deliveryId: string; email: ReceivedEmail; receivedAt?: Date },
): Promise<CareerEmailResult> {
  const body = bodyTextFromEmail(input.email);
  const plan = planAttachments(input.email.attachments ?? []);
  const attachmentsQueued = plan.filter((p) => p.status === "queued").length;
  const hasBody = body.length >= PASTE_TEXT_MIN;

  if (!hasBody && attachmentsQueued === 0) {
    return {
      ok: false,
      kind: "permanent",
      reason: plan.length > 0 ? "no_supported_content" : "text_too_short",
    };
  }

  let intakeId: string | null = null;
  let duplicate = false;
  if (hasBody) {
    const truncated = body.length > EMAIL_ORIGINAL_MAX;
    const created = await createCareerMaterial(admin, {
      userId: input.userId,
      channel: "email",
      title: titleFromSubject(input.email.subject, input.receivedAt ?? new Date()),
      text: truncated ? body.slice(0, EMAIL_ORIGINAL_MAX) : body,
      declaredType: null,
      inboundDeliveryId: input.deliveryId,
      attachments: attachmentSummary(plan),
      truncated,
    });
    if (!created.ok) return { ok: false, kind: "retryable", reason: "ingest_failed" };
    intakeId = created.intakeId;
    duplicate = created.status === "duplicate";
  }

  if (plan.length > 0) {
    // Idempotent per (leveranse, posisjon): en ny levering av samme e-post
    // legger ikke vedleggene i kø to ganger.
    const { error } = await admin.rpc("career_material_register_attachments", {
      p_user_id: input.userId,
      p_inbound_delivery_id: input.deliveryId,
      p_parent_intake_id: intakeId,
      p_provider_email_id: input.email.id,
      p_items: plan as unknown as Json,
    } as never);
    if (error) {
      console.error("[career-material] attachment register failed", error.code ?? "unknown");
      return { ok: false, kind: "retryable", reason: "ingest_failed" };
    }
  }

  return { ok: true, intakeId, duplicate, attachmentsQueued };
}
