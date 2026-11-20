/**
 * Ruting i Resend-mottaket: en `career_material`-alias arkiverer originalen
 * som karrieremateriale og lager ALDRI et jobb-lead; en jobbalias går som før.
 */
import { createHmac, randomBytes } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET_BYTES = randomBytes(32);
const SECRET = `whsec_${SECRET_BYTES.toString("base64")}`;
const DOMAIN = "jobb.karrierenmin.no";
const ALIAS = "abcdefghijklmnopqrstuvwxyz";
const EMAIL_ID = "6229f547-f3a1-4de6-8e26-1b6b5e2e1b7a";

vi.stubEnv("INBOUND_EMAIL_DOMAIN", DOMAIN);
vi.stubEnv("RESEND_WEBHOOK_SECRET", SECRET);
vi.stubEnv("RESEND_API_KEY", "re_test");

const state = {
  intakeMode: "career_material" as "career_material" | "forwarding",
  claimStatus: "claimed" as "claimed" | "duplicate",
  finalizes: [] as Array<{ outcome: string; reason: string | null }>,
  creates: [] as Array<Record<string, unknown>>,
  createStatus: "created" as "created" | "duplicate",
};

function chain(result: unknown) {
  const target = {
    select: () => chain(result),
    insert: () => chain(result),
    update: () => chain(result),
    eq: () => chain(result),
    gte: () => chain(result),
    not: () => chain(result),
    limit: () => chain(result),
    single: async () => result,
    maybeSingle: async () => result,
    then: (res: (v: unknown) => unknown) => Promise.resolve(result).then(res),
  };
  return target as never;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "email_job_sources") {
        return chain({
          data: {
            id: "source-1",
            user_id: "user-1",
            source_system: "other",
            intake_mode: state.intakeMode,
            email_connection_id: null,
            is_active: true,
          },
          error: null,
        });
      }
      return chain({ data: { id: "rate-1" }, count: 0, error: null });
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "inbound_email_claim_delivery") {
        return {
          data: [
            {
              status: state.claimStatus,
              delivery_id: "delivery-1",
              claim_token: state.claimStatus === "claimed" ? "token-1" : null,
              attempt_number: 1,
            },
          ],
          error: null,
        };
      }
      if (fn === "career_material_create") {
        state.creates.push(args);
        return {
          data: [{ status: state.createStatus, intake_id: "intake-1", document_id: "doc-1" }],
          error: null,
        };
      }
      state.finalizes.push({
        outcome: String(args["p_outcome"]),
        reason: (args["p_reject_reason"] as string | null) ?? null,
      });
      return { data: [{ status: "finalized" }], error: null };
    },
  },
}));

const ingestSpy = vi.fn(async () => ({ importedJobEmailId: "import-1", jobLeadId: "lead-1" }));
vi.mock("@/lib/job-leads/ingest", () => ({
  ingestParsedEmail: (...a: unknown[]) => ingestSpy(...(a as [])),
}));

const fetchSpy = vi.fn();
vi.mock("@/lib/job-leads/resend-receiving.server", () => ({
  fetchReceivedEmail: (...args: unknown[]) => fetchSpy(...(args as [])),
}));

const { Route } = await import("@/routes/api/public/inbound/job-email");
const POST = (
  Route.options as never as {
    server: { handlers: { POST: (c: { request: Request }) => Promise<Response> } };
  }
).server.handlers.POST;

function request(): Request {
  const raw = JSON.stringify({
    type: "email.received",
    created_at: "2026-09-11T08:00:00.000Z",
    data: {
      email_id: EMAIL_ID,
      from: "meg@example.com",
      to: [`${ALIAS}@${DOMAIN}`],
      subject: "Fwd: Notat",
    },
  });
  const id = "msg_career";
  const ts = Math.floor(Date.now() / 1000);
  const mac = createHmac("sha256", SECRET_BYTES).update(`${id}.${ts}.${raw}`).digest("base64");
  return new Request("https://karrierenmin.no/api/public/inbound/job-email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": id,
      "svix-timestamp": String(ts),
      "svix-signature": `v1,${mac}`,
    },
    body: raw,
  });
}

const BODY =
  "Prosjektnotat: Jeg ledet innføringen av nytt CRM for salgsavdelingen og fikk alle 30 selgere i gang.";

function fetched(text = BODY, attachments: unknown[] = []) {
  return {
    ok: true as const,
    email: {
      id: EMAIL_ID,
      from: "meg@example.com",
      to: `${ALIAS}@${DOMAIN}`,
      subject: "Fwd: Notat fra CRM-prosjektet",
      text,
      html: null,
      messageIdHeader: "<abc@example.com>",
      attachments,
    },
  };
}

beforeEach(() => {
  state.intakeMode = "career_material";
  state.claimStatus = "claimed";
  state.finalizes = [];
  state.creates = [];
  state.createStatus = "created";
  ingestSpy.mockClear();
  fetchSpy.mockReset();
  fetchSpy.mockResolvedValue(fetched());
});

describe("Resend-mottak: ruting av karrieremateriale", () => {
  it("karrierealias lagrer originalen og lager aldri jobb-lead", async () => {
    const res = await POST({ request: request() });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, route: "career_material" });
    expect(ingestSpy).not.toHaveBeenCalled();
    expect(state.creates).toHaveLength(1);
    expect(state.creates[0]).toMatchObject({
      p_user_id: "user-1",
      p_channel: "email",
      p_title: "Notat fra CRM-prosjektet",
      p_inbound_delivery_id: "delivery-1",
      p_text: BODY,
    });
    expect(state.finalizes).toEqual([{ outcome: "accepted", reason: null }]);
  });

  it("vedlegg registreres som ikke behandlet", async () => {
    fetchSpy.mockResolvedValue(
      fetched(BODY, [
        { id: "att-1", filename: "attest.pdf", contentType: "application/pdf", sizeBytes: 1234 },
      ]),
    );
    await POST({ request: request() });
    expect(state.creates[0]!["p_attachments"]).toEqual([
      {
        filename: "attest.pdf",
        content_type: "application/pdf",
        size_bytes: 1234,
        status: "not_processed",
        reason: "attachments_not_supported",
      },
    ]);
  });

  it("for kort tekst avvises permanent uten å lagre noe", async () => {
    fetchSpy.mockResolvedValue(fetched("Se vedlegg."));
    const res = await POST({ request: request() });
    expect(res.status).toBe(422);
    expect(state.creates).toHaveLength(0);
    expect(state.finalizes).toEqual([{ outcome: "parse_failed", reason: "text_too_short" }]);
  });

  it("webhook-retry av allerede mottatt e-post lagrer ikke på nytt", async () => {
    state.claimStatus = "duplicate";
    const res = await POST({ request: request() });
    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(state.creates).toHaveLength(0);
  });

  it("jobbalias går fortsatt til jobb-lead-importen", async () => {
    state.intakeMode = "forwarding";
    fetchSpy.mockResolvedValue({
      ...fetched(),
      email: {
        ...fetched().email,
        subject: "Ny stilling",
        text: "Se stilling https://www.finn.no/job/fulltime/ad.html?finnkode=123",
      },
    });
    await POST({ request: request() });
    expect(state.creates).toHaveLength(0);
    expect(ingestSpy).toHaveBeenCalledTimes(1);
  });
});
