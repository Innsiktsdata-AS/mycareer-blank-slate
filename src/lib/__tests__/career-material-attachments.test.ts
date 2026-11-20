/**
 * Vedlegg i karrieremateriale: planlegging, filsignatur, tekstlesing fra
 * syntetiske PDF/DOCX-filer, grenser og trygg henting fra Resend.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { zipSync, strToU8 } from "fflate";
import { describe, expect, it, vi } from "vitest";
import {
  docxXmlToText,
  downloadResendAttachment,
  expectedKind,
  extractAttachmentText,
  isAllowedDownloadUrl,
  planAttachments,
  sniffKind,
} from "@/lib/career-material/attachments.server";
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_PER_EMAIL,
  attachmentHint,
  inboundRejectLabel,
} from "@/lib/career-material/contract";

const dir = join(__dirname, "fixtures", "career-material");
const file = (name: string) => new Uint8Array(readFileSync(join(dir, name)));

describe("planAttachments", () => {
  it("legger PDF/DOCX i kø og registrerer resten med endelig status", () => {
    const plan = planAttachments([
      { id: "a1", filename: "attest.pdf", contentType: "application/pdf", sizeBytes: 100 },
      { id: "a2", filename: "bilde.png", contentType: "image/png", sizeBytes: 100 },
      {
        id: "a3",
        filename: "stor.pdf",
        contentType: "application/pdf",
        sizeBytes: ATTACHMENT_MAX_BYTES + 1,
      },
      {
        id: null,
        filename: "uten-id.docx",
        contentType: "application/octet-stream",
        sizeBytes: 10,
      },
      { id: "a5", filename: "gammel.doc", contentType: "application/msword", sizeBytes: 10 },
    ]);
    expect(plan.map((p) => [p.position, p.status, p.kind, p.error_code])).toEqual([
      [0, "queued", "pdf", null],
      [1, "unsupported", null, "unsupported_type"],
      [2, "too_large", "pdf", "file_too_large"],
      [3, "failed", "docx", "missing_attachment_id"],
      [4, "unsupported", null, "unsupported_type"],
    ]);
  });

  it(`behandler høyst ${ATTACHMENT_MAX_PER_EMAIL} vedlegg per e-post`, () => {
    const list = Array.from({ length: 7 }, (_, i) => ({
      id: `att-${i}`,
      filename: `f${i}.pdf`,
      contentType: "application/pdf",
      sizeBytes: 10,
    }));
    const plan = planAttachments(list);
    expect(plan.filter((p) => p.status === "queued")).toHaveLength(ATTACHMENT_MAX_PER_EMAIL);
    expect(plan.filter((p) => p.status === "skipped_limit")).toHaveLength(2);
  });

  it("generisk innholdstype avgjøres av filendelsen", () => {
    expect(expectedKind({ filename: "x.PDF", contentType: "application/octet-stream" })).toBe(
      "pdf",
    );
    expect(expectedKind({ filename: "x.exe", contentType: "application/octet-stream" })).toBeNull();
    expect(expectedKind({ filename: "x.pdf", contentType: "text/html" })).toBeNull();
  });
});

describe("filsignatur og tekstlesing", () => {
  it("leser tekst fra en PDF med tekstlag, alle sider", async () => {
    const r = await extractAttachmentText(file("attest.pdf"), "pdf");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pageCount).toBe(2);
    expect(r.text).toContain("reduserte manuelle feil med 30 prosent");
    expect(r.text).toContain("koordinerte opplæring av 40 brukere");
  });

  it("skannet PDF uten tekstlag gir no_text (ingen OCR)", async () => {
    const r = await extractAttachmentText(file("skannet.pdf"), "pdf");
    expect(r).toMatchObject({ ok: false, status: "no_text", errorCode: "no_text_layer" });
  });

  it("passordbeskyttet PDF gir encrypted", async () => {
    const r = await extractAttachmentText(file("kryptert.pdf"), "pdf");
    expect(r).toMatchObject({
      ok: false,
      status: "encrypted",
      errorCode: "pdf_password_protected",
    });
  });

  it("falsk PDF (feil filsignatur) avvises uten parsing", async () => {
    const r = await extractAttachmentText(file("fake.pdf"), "pdf");
    expect(r).toMatchObject({ ok: false, status: "unsupported", errorCode: "signature_mismatch" });
  });

  it("DOCX forkledd som PDF avvises", async () => {
    const r = await extractAttachmentText(file("referat.docx"), "pdf");
    expect(r).toMatchObject({ ok: false, status: "unsupported", errorCode: "signature_mismatch" });
  });

  it("leser tekst fra DOCX, inkludert tabeller", async () => {
    const r = await extractAttachmentText(file("referat.docx"), "docx");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toContain("Kundetilfredsheten økte fra 3,9 til 4,5");
    expect(r.text).toContain("Ta ansvar for budsjett");
  });

  it("ZIP uten word/document.xml er ikke en Word-fil", async () => {
    const zip = zipSync({ "hei.txt": strToU8("hei") });
    const r = await extractAttachmentText(zip, "docx");
    expect(r).toMatchObject({
      ok: false,
      status: "unsupported",
      errorCode: "docx_missing_document",
    });
  });

  it("tom fil og for stor fil avvises", async () => {
    expect(await extractAttachmentText(new Uint8Array(), "pdf")).toMatchObject({
      status: "unreadable",
    });
    const big = new Uint8Array(ATTACHMENT_MAX_BYTES + 1);
    expect(await extractAttachmentText(big, "pdf")).toMatchObject({ status: "too_large" });
  });

  it("sniffKind gjenkjenner PDF og ZIP", () => {
    expect(sniffKind(file("attest.pdf"))).toBe("pdf");
    expect(sniffKind(file("referat.docx"))).toBe("docx");
    expect(sniffKind(file("fake.pdf"))).toBeNull();
  });

  it("docxXmlToText: avsnitt, tab, entiteter og slettet tekst", () => {
    const xml =
      "<w:body><w:p><w:r><w:t>Økte salg &amp; margin</w:t><w:tab/><w:t>30 %</w:t></w:r></w:p>" +
      "<w:p><w:del><w:r><w:delText>fjernet</w:delText></w:r></w:del><w:r><w:t>&#x2013; ok</w:t></w:r></w:p></w:body>";
    expect(docxXmlToText(xml)).toBe("Økte salg & margin\t30 %\n– ok\n");
  });
});

describe("downloadResendAttachment", () => {
  const base = {
    emailId: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c",
    attachmentId: "2a0c9ce0-3112-4728",
    apiKey: "re_x",
  };

  function metaResponse(body: Record<string, unknown>) {
    return new Response(JSON.stringify(body), { status: 200 });
  }

  it("henter metadata fra fast API-origin og laster ned fra resend-domene", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      calls.push(String(url));
      if (calls.length === 1)
        return metaResponse({ download_url: "https://inbound-cdn.resend.com/x?sig=1", size: 4 });
      return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await downloadResendAttachment({ ...base, fetchImpl });
    expect(r.ok).toBe(true);
    expect(calls[0]).toBe(
      `https://api.resend.com/emails/receiving/${base.emailId}/attachments/${base.attachmentId}`,
    );
  });

  it("laster ned fra cdn.resend.app (Resends faktiske vedleggsdomene i produksjon)", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      calls.push(String(url));
      if (calls.length === 1)
        return metaResponse({
          object: "attachment",
          content_type: "application/pdf",
          download_url: "https://cdn.resend.app/abc/def?X-Amz-Signature=1",
          size: 4,
        });
      return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await downloadResendAttachment({ ...base, fetchImpl });
    expect(r.ok).toBe(true);
    expect(calls[1]?.startsWith("https://cdn.resend.app/")).toBe(true);
  });

  it("tillatelseslisten godtar bare Resend-domener, ikke etterligninger", () => {
    expect(isAllowedDownloadUrl("https://cdn.resend.app/x")).not.toBeNull();
    expect(isAllowedDownloadUrl("https://resend.app/x")).not.toBeNull();
    expect(isAllowedDownloadUrl("https://inbound-cdn.resend.com/x")).not.toBeNull();
    expect(isAllowedDownloadUrl("https://evilresend.app/x")).toBeNull();
    expect(isAllowedDownloadUrl("https://cdn.resend.app.evil.com/x")).toBeNull();
    expect(isAllowedDownloadUrl("https://resend.app@evil.com/x")).toBeNull();
    expect(isAllowedDownloadUrl("https://u:p@cdn.resend.app/x")).toBeNull();
    expect(isAllowedDownloadUrl("http://cdn.resend.app/x")).toBeNull();
  });

  it("avviser nedlastingslenke utenfor resend-domenet (SSRF-vern) uten å hente den", async () => {
    const fetchImpl = vi.fn(async () =>
      metaResponse({ download_url: "https://evil.example.com/file", size: 4 }),
    ) as unknown as typeof fetch;
    const r = await downloadResendAttachment({ ...base, fetchImpl });
    // Gjenforsøkbar: en rettet tillatelsesliste plukker opp vedlegget senere.
    expect(r).toEqual({ ok: false, kind: "retryable", reason: "invalid_download_url" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("for stor fil stoppes før nedlasting", async () => {
    const fetchImpl = vi.fn(async () =>
      metaResponse({
        download_url: "https://inbound-cdn.resend.com/x",
        size: ATTACHMENT_MAX_BYTES + 1,
      }),
    ) as unknown as typeof fetch;
    const r = await downloadResendAttachment({ ...base, fetchImpl });
    expect(r).toMatchObject({ ok: false, kind: "permanent", reason: "file_too_large" });
  });

  it("strømmen avbrytes når faktisk størrelse overstiger grensen", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n += 1;
      if (n === 1) return metaResponse({ download_url: "https://inbound-cdn.resend.com/x" });
      return new Response(new Uint8Array(2048), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await downloadResendAttachment({ ...base, fetchImpl, maxBytes: 1024 });
    expect(r).toMatchObject({ ok: false, reason: "file_too_large" });
  });

  it("404/429/5xx er retry-bare, 400 er permanent", async () => {
    for (const [status, kind] of [
      [404, "retryable"],
      [429, "retryable"],
      [503, "retryable"],
      [400, "permanent"],
    ] as const) {
      const fetchImpl = vi.fn(
        async () => new Response("{}", { status }),
      ) as unknown as typeof fetch;
      const r = await downloadResendAttachment({ ...base, fetchImpl });
      expect(r).toMatchObject({ ok: false, kind, reason: `resend_api_${status}` });
    }
  });

  it("omdirigering ved nedlasting følges ikke", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n += 1;
      if (n === 1) return metaResponse({ download_url: "https://inbound-cdn.resend.com/x" });
      return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } });
    }) as unknown as typeof fetch;
    const r = await downloadResendAttachment({ ...base, fetchImpl });
    expect(r).toMatchObject({ ok: false, kind: "permanent", reason: "download_redirect" });
  });

  it("ugyldige id-er sendes aldri til API-et", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const r = await downloadResendAttachment({ ...base, attachmentId: "../../x", fetchImpl });
    expect(r).toMatchObject({ ok: false, reason: "invalid_attachment_id" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("attachmentHint", () => {
  const base = { status: "failed" as const, errorCode: "fetch_failed" };
  it("lover nytt forsøk bare når køen faktisk prøver igjen", () => {
    expect(attachmentHint({ ...base, retryable: true, attemptCount: 1 })).toContain(
      "prøves automatisk på nytt",
    );
    expect(attachmentHint({ ...base, retryable: false, attemptCount: 1 })).toBe(
      "Behandlingen feilet og prøves ikke automatisk på nytt.",
    );
    expect(attachmentHint({ ...base, retryable: true, attemptCount: 6 })).toBe(
      "Behandlingen feilet og prøves ikke automatisk på nytt.",
    );
  });
});

describe("inboundRejectLabel", () => {
  const now = Date.parse("2026-11-20T12:00:00Z");
  it("lover nytt forsøk bare mens e-posttjenesten fortsatt leverer på nytt", () => {
    expect(inboundRejectLabel("ingest_failed", "2026-11-20T11:00:00Z", now)).toContain(
      "forsøkes på nytt automatisk",
    );
    expect(inboundRejectLabel("resend_api_503", "2026-11-19T20:00:00Z", now)).toContain(
      "prøves ikke lenger automatisk",
    );
    expect(inboundRejectLabel("ingest_failed", null, now)).toContain(
      "prøves ikke lenger automatisk",
    );
  });
  it("endelige avvisninger lover aldri nytt forsøk", () => {
    expect(inboundRejectLabel("email_too_large", "2026-11-20T11:59:00Z", now)).toBe(
      "E-posten var for stor.",
    );
  });
});
