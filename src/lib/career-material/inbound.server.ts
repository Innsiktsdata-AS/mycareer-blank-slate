/**
 * Karrieremateriale via e-post (server-only).
 *
 * Kalles fra Resend-webhooken først etter gyldig Svix-signatur, eksakt
 * alias-domene, aliaseierskap (`career_material`-kilde), atomisk claim og
 * henting av full e-post fra Receiving API. Avsender og innhold styrer
 * aldri rutingen — det gjør bare hvilken alias som mottok e-posten.
 *
 * Vedleggsinnhold lastes ikke ned. Vedlegg registreres med metadata og
 * status «ikke behandlet», slik at brukeren ser hva som ikke ble analysert.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { ReceivedEmail } from "@/lib/job-leads/resend-receiving.server";
import { normalizeText } from "@/lib/job-leads/parse";
import { PASTE_TEXT_MIN, type CareerMaterialAttachment } from "./contract";
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

export function attachmentReport(
  email: Pick<ReceivedEmail, "attachments">,
): CareerMaterialAttachment[] {
  return (email.attachments ?? []).slice(0, 25).map((a) => ({
    filename: a.filename ? a.filename.slice(0, 200) : null,
    content_type: a.contentType ? a.contentType.slice(0, 100) : null,
    size_bytes: typeof a.sizeBytes === "number" ? a.sizeBytes : null,
    status: "not_processed",
    reason: "attachments_not_supported",
  }));
}

export type CareerEmailResult =
  | { ok: true; intakeId: string; duplicate: boolean }
  | { ok: false; kind: "permanent" | "retryable"; reason: string };

export async function ingestCareerMaterialEmail(
  admin: SupabaseClient<Database>,
  input: { userId: string; deliveryId: string; email: ReceivedEmail; receivedAt?: Date },
): Promise<CareerEmailResult> {
  const body = bodyTextFromEmail(input.email);
  if (body.length < PASTE_TEXT_MIN)
    return { ok: false, kind: "permanent", reason: "text_too_short" };
  const truncated = body.length > EMAIL_ORIGINAL_MAX;
  const created = await createCareerMaterial(admin, {
    userId: input.userId,
    channel: "email",
    title: titleFromSubject(input.email.subject, input.receivedAt ?? new Date()),
    text: truncated ? body.slice(0, EMAIL_ORIGINAL_MAX) : body,
    declaredType: null,
    inboundDeliveryId: input.deliveryId,
    attachments: attachmentReport(input.email),
    truncated,
  });
  if (!created.ok) return { ok: false, kind: "retryable", reason: "ingest_failed" };
  return { ok: true, intakeId: created.intakeId, duplicate: created.status === "duplicate" };
}
