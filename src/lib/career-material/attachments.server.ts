/**
 * Karrieremateriale — vedlegg fra e-post (server-only).
 *
 * Støtter tekst-PDF og Word (DOCX). Innholdet valideres på filsignatur, ikke
 * på filnavn eller oppgitt type. Det finnes ingen OCR: en PDF uten tekstlag
 * (typisk skannet) får status `no_text`, og brukeren får beskjed om det.
 *
 * Henting skjer bare via Resends faste API-origin med server-only nøkkel.
 * Nedlastingslenken må være https på et Resend-domene (resend.com eller
 * resend.app — Resend leverer vedlegg fra cdn.resend.app). Innhold, nøkler og
 * lenker logges aldri.
 */

import { createHash } from "crypto";
import { unzipSync } from "fflate";
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_PER_EMAIL,
  ATTACHMENT_TEXT_MIN,
  type AttachmentKind,
  type AttachmentRegistration,
} from "./contract";

/** Fast API-origin — aldri styrt av forespørselen. */
export const RESEND_API_ORIGIN = "https://api.resend.com";
export const PDF_MAX_PAGES = 60;
/** Grense for utpakket document.xml (vern mot zip-bomber). */
export const DOCX_MAX_XML_BYTES = 15 * 1024 * 1024;
export const ATTACHMENT_TEXT_MAX = 200_000;
export const ATTACHMENT_FETCH_TIMEOUT_MS = 20_000;

const PDF_TYPES = new Set(["application/pdf", "application/x-pdf"]);
const DOCX_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const GENERIC_TYPES = new Set(["application/octet-stream", "binary/octet-stream", ""]);

function extensionOf(filename: string | null): string {
  if (!filename) return "";
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(filename.trim());
  return m ? m[1].toLowerCase() : "";
}

/** Forventet type ut fra metadata. Endelig avgjørelse tas på filsignatur. */
export function expectedKind(meta: {
  filename: string | null;
  contentType: string | null;
}): AttachmentKind | null {
  const ct = (meta.contentType ?? "").split(";")[0].trim().toLowerCase();
  const ext = extensionOf(meta.filename);
  if (PDF_TYPES.has(ct)) return "pdf";
  if (DOCX_TYPES.has(ct)) return "docx";
  if (GENERIC_TYPES.has(ct)) {
    if (ext === "pdf") return "pdf";
    if (ext === "docx") return "docx";
  }
  return null;
}

export type AttachmentMetaInput = {
  id: string | null;
  filename: string | null;
  contentType: string | null;
  sizeBytes: number | null;
};

/**
 * Bestemmer hvilke vedlegg som skal hentes. Ikke-støttede, for store og
 * vedlegg utover grensen registreres med endelig status, slik at brukeren
 * ser alt som kom inn.
 */
export function planAttachments(list: AttachmentMetaInput[]): AttachmentRegistration[] {
  const out: AttachmentRegistration[] = [];
  let queued = 0;
  list.slice(0, 25).forEach((a, position) => {
    const base = {
      position,
      provider_attachment_id: a.id,
      filename: a.filename ? a.filename.slice(0, 200) : null,
      content_type: a.contentType ? a.contentType.slice(0, 100) : null,
      size_bytes: typeof a.sizeBytes === "number" && a.sizeBytes >= 0 ? a.sizeBytes : null,
    };
    const kind = expectedKind(a);
    if (!kind) {
      out.push({ ...base, kind: null, status: "unsupported", error_code: "unsupported_type" });
      return;
    }
    if (base.size_bytes != null && base.size_bytes > ATTACHMENT_MAX_BYTES) {
      out.push({ ...base, kind, status: "too_large", error_code: "file_too_large" });
      return;
    }
    if (!a.id) {
      out.push({ ...base, kind, status: "failed", error_code: "missing_attachment_id" });
      return;
    }
    if (queued >= ATTACHMENT_MAX_PER_EMAIL) {
      out.push({ ...base, kind, status: "skipped_limit", error_code: "too_many_attachments" });
      return;
    }
    queued += 1;
    out.push({ ...base, kind, status: "queued", error_code: null });
  });
  return out;
}

/** Filsignatur. DOCX er en ZIP med word/document.xml (kontrolleres ved utpakking). */
export function sniffKind(bytes: Uint8Array): AttachmentKind | null {
  if (bytes.length >= 5) {
    // %PDF- kan ha opptil 1024 byte foran seg ifølge spesifikasjonen.
    const head = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(1024, bytes.length)));
    if (head.includes("%PDF-")) return "pdf";
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  ) {
    return "docx";
  }
  return null;
}

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Fjerner kontrolltegn (unntatt linjeskift/tab) og overflødige mellomrom. */
export function cleanExtractedText(raw: string): string {
  return (
    raw
      .replace(/\r\n?/g, "\n")
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
      .replace(/[ \t\u00A0]+\n/g, "\n")
      .replace(/[ \u00A0]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]{1,6});/g, (_, h: string) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#([0-9]{1,7});/g, (_, d: string) => safeCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function safeCodePoint(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return "";
  try {
    return String.fromCodePoint(n);
  } catch {
    return "";
  }
}

/** Tekst fra WordprocessingML (document.xml). Avsnitt, tabulator og linjeskift bevares. */
export function docxXmlToText(xml: string): string {
  const body = xml
    .replace(/<w:tab\b[^>]*\/>/g, "\t")
    .replace(/<w:(br|cr)\b[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<\/w:tc>/g, "\t")
    .replace(/<\/w:tr>/g, "\n")
    // Slettet tekst i sporede endringer er ikke del av dokumentet.
    .replace(/<w:delText\b[^>]*>[\s\S]*?<\/w:delText>/g, "")
    .replace(/<w:instrText\b[^>]*>[\s\S]*?<\/w:instrText>/g, "")
    .replace(/<[^>]+>/g, "");
  return decodeXmlEntities(body);
}

export type ExtractResult =
  | { ok: true; text: string; pageCount: number | null; truncated: boolean }
  | {
      ok: false;
      status: "no_text" | "unreadable" | "encrypted" | "unsupported" | "too_large";
      errorCode: string;
      pageCount?: number | null;
    };

function finishText(raw: string, pageCount: number | null): ExtractResult {
  const text = cleanExtractedText(raw);
  const visible = text.replace(/\s+/g, "").length;
  if (visible < ATTACHMENT_TEXT_MIN) {
    return { ok: false, status: "no_text", errorCode: "no_text_layer", pageCount };
  }
  const truncated = text.length > ATTACHMENT_TEXT_MAX;
  return {
    ok: true,
    text: truncated ? text.slice(0, ATTACHMENT_TEXT_MAX) : text,
    pageCount,
    truncated,
  };
}

export function extractDocxText(bytes: Uint8Array): ExtractResult {
  let tooLarge = false;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        if (f.name !== "word/document.xml") return false;
        if (f.originalSize > DOCX_MAX_XML_BYTES) {
          tooLarge = true;
          return false;
        }
        return true;
      },
    });
  } catch {
    return { ok: false, status: "unreadable", errorCode: "docx_invalid_zip" };
  }
  if (tooLarge) return { ok: false, status: "too_large", errorCode: "docx_content_too_large" };
  const xmlBytes = files["word/document.xml"];
  if (!xmlBytes) return { ok: false, status: "unsupported", errorCode: "docx_missing_document" };
  if (xmlBytes.length > DOCX_MAX_XML_BYTES) {
    return { ok: false, status: "too_large", errorCode: "docx_content_too_large" };
  }
  let xml: string;
  try {
    xml = new TextDecoder("utf-8", { fatal: false }).decode(xmlBytes);
  } catch {
    return { ok: false, status: "unreadable", errorCode: "docx_invalid_xml" };
  }
  return finishText(docxXmlToText(xml), null);
}

export async function extractPdfText(bytes: Uint8Array): Promise<ExtractResult> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // Kopi: pdf.js kan overta (detach) bufferen.
    pdf = await getDocumentProxy(new Uint8Array(bytes));
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "PasswordException") {
      return { ok: false, status: "encrypted", errorCode: "pdf_password_protected" };
    }
    return { ok: false, status: "unreadable", errorCode: "pdf_invalid" };
  }
  try {
    const pageCount = pdf.numPages;
    if (pageCount > PDF_MAX_PAGES) {
      return { ok: false, status: "too_large", errorCode: "pdf_too_many_pages", pageCount };
    }
    const { text } = await extractText(pdf, { mergePages: false });
    const raw = text.join("\n\n");
    return finishText(raw, pageCount);
  } catch {
    return { ok: false, status: "unreadable", errorCode: "pdf_text_failed" };
  } finally {
    try {
      await (pdf as unknown as { destroy?: () => Promise<void> }).destroy?.();
    } catch {
      /* ignorert */
    }
  }
}

/** Validerer filsignatur mot forventet type og henter teksten. */
export async function extractAttachmentText(
  bytes: Uint8Array,
  expected: AttachmentKind,
): Promise<ExtractResult & { kind?: AttachmentKind }> {
  if (bytes.length === 0) return { ok: false, status: "unreadable", errorCode: "empty_file" };
  if (bytes.length > ATTACHMENT_MAX_BYTES) {
    return { ok: false, status: "too_large", errorCode: "file_too_large" };
  }
  const actual = sniffKind(bytes);
  if (!actual || actual !== expected) {
    return { ok: false, status: "unsupported", errorCode: "signature_mismatch" };
  }
  return actual === "pdf" ? await extractPdfText(bytes) : extractDocxText(bytes);
}

// ---------------------------------------------------------------------------
// Henting fra Resend
// ---------------------------------------------------------------------------

const ID_RE = /^[A-Za-z0-9_-]{8,128}$/;

export type DownloadResult =
  | { ok: true; bytes: Uint8Array; contentType: string | null }
  | { ok: false; kind: "retryable" | "permanent"; reason: string };

/** Domener Resend leverer signerte nedlastingslenker fra (inkl. underdomener). */
export const RESEND_DOWNLOAD_DOMAINS = ["resend.com", "resend.app"] as const;

export function isAllowedDownloadUrl(raw: unknown): URL | null {
  if (typeof raw !== "string" || raw.length > 4096) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return null;
    if (u.username || u.password) return null;
    const host = u.hostname.toLowerCase();
    const allowed = RESEND_DOWNLOAD_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
    return allowed ? u : null;
  } catch {
    return null;
  }
}

function classifyStatus(status: number): "retryable" | "permanent" {
  return status === 429 || status >= 500 || status === 401 || status === 403 || status === 404
    ? "retryable"
    : "permanent";
}

async function readLimited(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array | "too_large" | "failed"> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) return "too_large";
  if (!response.body) {
    try {
      const buf = new Uint8Array(await response.arrayBuffer());
      return buf.length > maxBytes ? "too_large" : buf;
    } catch {
      return "failed";
    }
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return "too_large";
      }
      chunks.push(value);
    }
  } catch {
    return "failed";
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/**
 * Henter ett vedlegg: først metadata med fersk `download_url` fra Resend,
 * deretter selve filen med størrelsesgrense. Følger ikke omdirigeringer.
 */
export async function downloadResendAttachment(input: {
  emailId: string;
  attachmentId: string;
  apiKey: string;
  maxBytes?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<DownloadResult> {
  if (!ID_RE.test(input.emailId) || !ID_RE.test(input.attachmentId)) {
    return { ok: false, kind: "permanent", reason: "invalid_attachment_id" };
  }
  const doFetch = input.fetchImpl ?? fetch;
  const maxBytes = input.maxBytes ?? ATTACHMENT_MAX_BYTES;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    input.timeoutMs ?? ATTACHMENT_FETCH_TIMEOUT_MS,
  );
  try {
    let metaRes: Response;
    try {
      metaRes = await doFetch(
        `${RESEND_API_ORIGIN}/emails/receiving/${encodeURIComponent(input.emailId)}/attachments/${encodeURIComponent(input.attachmentId)}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${input.apiKey}`, Accept: "application/json" },
          redirect: "manual",
          signal: controller.signal,
        },
      );
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      return { ok: false, kind: "retryable", reason: aborted ? "fetch_timeout" : "fetch_failed" };
    }
    if (!metaRes.ok) {
      return {
        ok: false,
        kind: classifyStatus(metaRes.status),
        reason: `resend_api_${metaRes.status}`,
      };
    }
    let meta: Record<string, unknown>;
    try {
      const text = await metaRes.text();
      if (text.length > 64 * 1024) return { ok: false, kind: "permanent", reason: "invalid_json" };
      const parsed = JSON.parse(text) as unknown;
      const root = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
      meta =
        root["data"] && typeof root["data"] === "object"
          ? (root["data"] as Record<string, unknown>)
          : root;
    } catch {
      return { ok: false, kind: "permanent", reason: "invalid_json" };
    }
    if (typeof meta["size"] === "number" && meta["size"] > maxBytes) {
      return { ok: false, kind: "permanent", reason: "file_too_large" };
    }
    const url = isAllowedDownloadUrl(meta["download_url"]);
    // Lenken hentes aldri. Svaret kommer fra Resends faste API-origin med vår
    // nøkkel, så en ukjent vert betyr endret leveranse hos Resend — ikke farlig
    // innhold. Nytt forsøk (med ventetid og maks antall) lar en rettet
    // tillatelsesliste plukke opp vedlegget uten manuell opprydding.
    if (!url) return { ok: false, kind: "retryable", reason: "invalid_download_url" };

    let fileRes: Response;
    try {
      fileRes = await doFetch(url.toString(), {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
      });
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      return { ok: false, kind: "retryable", reason: aborted ? "fetch_timeout" : "fetch_failed" };
    }
    if (fileRes.type === "opaqueredirect" || (fileRes.status >= 300 && fileRes.status < 400)) {
      return { ok: false, kind: "permanent", reason: "download_redirect" };
    }
    if (!fileRes.ok) {
      // Utløpt lenke (403) eller midlertidig feil: ny lenke hentes ved neste forsøk.
      return {
        ok: false,
        kind: classifyStatus(fileRes.status),
        reason: `download_${fileRes.status}`,
      };
    }
    const bytes = await readLimited(fileRes, maxBytes);
    if (bytes === "too_large") return { ok: false, kind: "permanent", reason: "file_too_large" };
    if (bytes === "failed") return { ok: false, kind: "retryable", reason: "download_body_failed" };
    const ct = typeof meta["content_type"] === "string" ? meta["content_type"] : null;
    return { ok: true, bytes, contentType: ct };
  } finally {
    clearTimeout(timer);
  }
}
