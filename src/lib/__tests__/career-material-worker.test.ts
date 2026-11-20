/**
 * Bakgrunnsarbeideren: single-flight, begrenset arbeid, kretsbryter (pause
 * med én prøve per kjøring), stopp ved 429 og trygg vedleggsbehandling.
 */
import { describe, expect, it, vi } from "vitest";
import { runCareerMaterialWorker } from "@/lib/career-material/worker.server";
import type { ProcessResult } from "@/lib/career-material/store.server";

type Call = { fn: string; args: Record<string, unknown> };

function fakeAdmin(opts: {
  acquired?: boolean;
  paused?: string | null;
  attachments?: Array<Record<string, unknown>>;
  due?: Array<{ intake_id: string; user_id: string }>;
  createStatus?: "created" | "duplicate";
  existingFilePath?: string | null;
}) {
  const calls: Call[] = [];
  const queue = [...(opts.attachments ?? [])];
  const admin = {
    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
      calls.push({ fn, args });
      switch (fn) {
        case "career_material_worker_acquire":
          return {
            data: [{ acquired: opts.acquired ?? true, paused_reason: opts.paused ?? null }],
            error: null,
          };
        case "career_material_storage_gc_candidates":
          return { data: [], error: null };
        case "career_material_attachment_claim_next":
          return { data: queue.length ? [queue.shift()] : [], error: null };
        case "career_material_attachment_finish":
          return { data: "ok", error: null };
        case "career_material_create":
          return {
            data: [
              {
                status: opts.createStatus ?? "created",
                intake_id: "intake-a",
                document_id: "doc-a",
              },
            ],
            error: null,
          };
        case "career_material_due_intakes":
          return { data: (opts.due ?? []).slice(0, Number(args["p_limit"] ?? 3)), error: null };
        case "career_material_worker_release":
          return { data: "ok", error: null };
        default:
          return { data: null, error: null };
      }
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { file_path: opts.existingFilePath ?? null },
              error: null,
            }),
          }),
        }),
      }),
    }),
  };
  return { admin: admin as never, calls };
}

const storage = () => ({
  upload: vi.fn(async () => true),
  remove: vi.fn(async () => true),
});

const attachmentRow = {
  id: "att-1",
  user_id: "user-1",
  inbound_delivery_id: "del-1",
  parent_intake_id: null,
  provider_email_id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c",
  provider_attachment_id: "2a0c9ce0-3112-4728",
  filename: "Attest_Kari.pdf",
  content_type: "application/pdf",
  declared_size_bytes: 100,
  kind: "pdf",
  claim_token: "tok",
  attempt_count: 1,
};

const okDownload = vi.fn(async () => ({
  ok: true as const,
  bytes: new Uint8Array([37, 80, 68, 70, 45]),
  contentType: "application/pdf",
}));

function release(calls: Call[]) {
  return calls.find((c) => c.fn === "career_material_worker_release")!.args;
}

describe("runCareerMaterialWorker", () => {
  it("avslutter straks når en annen kjøring har låsen", async () => {
    const { admin, calls } = fakeAdmin({ acquired: false });
    const s = await runCareerMaterialWorker({ admin, resendApiKey: "re", storage: storage() });
    expect(s.skipped).toBe("locked");
    expect(calls.map((c) => c.fn)).toEqual(["career_material_worker_acquire"]);
  });

  it("leser vedlegg, lagrer filen privat under brukerens mappe og lager kilde", async () => {
    const { admin, calls } = fakeAdmin({ attachments: [attachmentRow] });
    const st = storage();
    const s = await runCareerMaterialWorker({
      admin,
      resendApiKey: "re",
      storage: st,
      download: okDownload,
      extract: async () => ({
        ok: true,
        text: "Kari ledet migreringen og reduserte feil med 30 prosent.",
        pageCount: 1,
        truncated: false,
      }),
      processIntake: async () => ({ status: "completed", created: 1, reused: 0, superseded: 0 }),
    });
    expect(s.attachments).toEqual({ extracted: 1 });
    expect(st.upload).toHaveBeenCalledWith(
      "user-1/att-1.pdf",
      expect.any(Uint8Array),
      "application/pdf",
    );
    const create = calls.find((c) => c.fn === "career_material_create")!.args;
    expect(create).toMatchObject({
      p_user_id: "user-1",
      p_channel: "email",
      p_title: "Attest Kari",
      p_source_context: "career_material_attachment",
      p_file_path: "user-1/att-1.pdf",
    });
    const fin = calls.find((c) => c.fn === "career_material_attachment_finish")!.args;
    expect(fin).toMatchObject({
      p_status: "extracted",
      p_intake_id: "intake-a",
      p_document_id: "doc-a",
    });
  });

  it("ekte duplikat: ekstra fil fjernes, status duplicate", async () => {
    const { admin, calls } = fakeAdmin({
      attachments: [attachmentRow],
      createStatus: "duplicate",
      existingFilePath: null,
    });
    const st = storage();
    await runCareerMaterialWorker({
      admin,
      resendApiKey: "re",
      storage: st,
      download: okDownload,
      extract: async () => ({ ok: true, text: "x".repeat(60), pageCount: 1, truncated: false }),
    });
    expect(st.remove).toHaveBeenCalledWith(["user-1/att-1.pdf"]);
    expect(calls.find((c) => c.fn === "career_material_attachment_finish")!.args).toMatchObject({
      p_status: "duplicate",
      p_storage_path: null,
    });
  });

  it("nytt forsøk etter avbrudd: egen original gjenkjennes, filen beholdes", async () => {
    const { admin, calls } = fakeAdmin({
      attachments: [attachmentRow],
      createStatus: "duplicate",
      existingFilePath: "user-1/att-1.pdf",
    });
    const st = storage();
    await runCareerMaterialWorker({
      admin,
      resendApiKey: "re",
      storage: st,
      download: okDownload,
      extract: async () => ({ ok: true, text: "x".repeat(60), pageCount: 1, truncated: false }),
    });
    expect(st.remove).not.toHaveBeenCalled();
    expect(calls.find((c) => c.fn === "career_material_attachment_finish")!.args).toMatchObject({
      p_status: "extracted",
    });
  });

  it("skannet PDF: originalen lagres for nedlasting, ingen kilde opprettes", async () => {
    const { admin, calls } = fakeAdmin({ attachments: [attachmentRow] });
    const st = storage();
    await runCareerMaterialWorker({
      admin,
      resendApiKey: "re",
      storage: st,
      download: okDownload,
      extract: async () => ({
        ok: false,
        status: "no_text",
        errorCode: "no_text_layer",
        pageCount: 1,
      }),
    });
    expect(st.upload).toHaveBeenCalledTimes(1);
    expect(calls.some((c) => c.fn === "career_material_create")).toBe(false);
    expect(calls.find((c) => c.fn === "career_material_attachment_finish")!.args).toMatchObject({
      p_status: "no_text",
      p_error_code: "no_text_layer",
      p_storage_path: "user-1/att-1.pdf",
    });
  });

  it("midlertidig nedlastingsfeil markeres retry-bar", async () => {
    const { admin, calls } = fakeAdmin({ attachments: [attachmentRow] });
    await runCareerMaterialWorker({
      admin,
      resendApiKey: "re",
      storage: storage(),
      download: async () => ({ ok: false, kind: "retryable", reason: "resend_api_503" }),
    });
    expect(calls.find((c) => c.fn === "career_material_attachment_finish")!.args).toMatchObject({
      p_status: "failed",
      p_error_code: "resend_api_503",
      p_retryable: true,
    });
  });

  it("krasj under vedlegg gir retry-bar feil og slipper låsen", async () => {
    const { admin, calls } = fakeAdmin({ attachments: [attachmentRow] });
    await runCareerMaterialWorker({
      admin,
      resendApiKey: "re",
      storage: storage(),
      download: async () => {
        throw new Error("boom");
      },
    });
    expect(calls.find((c) => c.fn === "career_material_attachment_finish")!.args).toMatchObject({
      p_status: "failed",
      p_error_code: "worker_exception",
      p_retryable: true,
    });
    expect(calls.at(-1)!.fn).toBe("career_material_worker_release");
  });

  it("uten Resend-nøkkel venter vedlegget (retry), ingen nedlasting", async () => {
    const { admin, calls } = fakeAdmin({ attachments: [attachmentRow] });
    const dl = vi.fn();
    await runCareerMaterialWorker({
      admin,
      resendApiKey: null,
      storage: storage(),
      download: dl as never,
    });
    expect(dl).not.toHaveBeenCalled();
    expect(calls.find((c) => c.fn === "career_material_attachment_finish")!.args).toMatchObject({
      p_error_code: "resend_not_configured",
      p_retryable: true,
    });
  });

  it("429 stopper kjøringen; resten venter til neste kjøring", async () => {
    const due = [1, 2, 3].map((i) => ({ intake_id: `i${i}`, user_id: "u" }));
    const { admin, calls } = fakeAdmin({ due });
    const processIntake = vi.fn(
      async (): Promise<ProcessResult> => ({
        status: "failed",
        errorCode: "rate_limited",
        retryable: true,
        pause: "rate_limited",
      }),
    );
    const s = await runCareerMaterialWorker({
      admin,
      resendApiKey: "re",
      storage: storage(),
      processIntake,
    });
    expect(processIntake).toHaveBeenCalledTimes(1);
    expect(s.stoppedBy).toBe("rate_limited");
    expect(release(calls)).toMatchObject({ p_pause_reason: null, p_clear_pause: false });
  });

  it("avvisning fra analysetjenesten setter varig pause", async () => {
    const due = [1, 2].map((i) => ({ intake_id: `i${i}`, user_id: "u" }));
    const { admin, calls } = fakeAdmin({ due });
    const processIntake = vi.fn(
      async (): Promise<ProcessResult> => ({
        status: "failed",
        errorCode: "provider_blocked",
        retryable: true,
        pause: "provider_blocked",
      }),
    );
    await runCareerMaterialWorker({ admin, resendApiKey: "re", storage: storage(), processIntake });
    expect(processIntake).toHaveBeenCalledTimes(1);
    expect(release(calls)).toMatchObject({
      p_pause_reason: "provider_blocked",
      p_pause_error_code: "provider_blocked",
    });
  });

  it("under pause prøves høyst ett inntak, og suksess opphever pausen", async () => {
    const due = [1, 2, 3].map((i) => ({ intake_id: `i${i}`, user_id: "u" }));
    const { admin, calls } = fakeAdmin({ due, paused: "configuration" });
    const processIntake = vi.fn(
      async (): Promise<ProcessResult> => ({
        status: "completed",
        created: 2,
        reused: 0,
        superseded: 0,
      }),
    );
    const s = await runCareerMaterialWorker({
      admin,
      resendApiKey: "re",
      storage: storage(),
      processIntake,
    });
    expect(calls.find((c) => c.fn === "career_material_due_intakes")!.args).toMatchObject({
      p_limit: 1,
    });
    expect(processIntake).toHaveBeenCalledTimes(1);
    expect(s.pausedNow).toBeNull();
    expect(release(calls)).toMatchObject({ p_clear_pause: true });
  });

  it("tidsbudsjett: nye elementer startes ikke etter fristen", async () => {
    const due = [1, 2, 3].map((i) => ({ intake_id: `i${i}`, user_id: "u" }));
    const { admin } = fakeAdmin({ due });
    let t = 0;
    const processIntake = vi.fn(async (): Promise<ProcessResult> => {
      t += 50_000;
      return { status: "completed", created: 0, reused: 0, superseded: 0 };
    });
    const s = await runCareerMaterialWorker({
      admin,
      resendApiKey: "re",
      storage: storage(),
      processIntake,
      now: () => t,
    });
    expect(processIntake).toHaveBeenCalledTimes(1);
    expect(s.stoppedBy).toBe("time_budget");
  });
});
