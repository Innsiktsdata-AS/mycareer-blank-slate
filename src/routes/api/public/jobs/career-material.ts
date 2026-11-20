// POST /api/public/jobs/career-material
//
// Bakgrunnsarbeider for karrieremateriale: henter og leser vedlegg fra
// e-post, og analyserer mottatte kilder uten at brukeren må åpne siden.
//
// Sikkerhetskontrakt:
//   - POST-only (405 ellers)
//   - planlagt jobb autentiseres med den administrerte cron-hemmeligheten
//   - bruker-JWT gir ingen tilgang
//   - saniterte svar: bare antall og statuskoder, aldri innhold eller filnavn
import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

function fail(status: number, code: string) {
  return Response.json({ ok: false, error: { code } }, { status });
}

export const Route = createFileRoute("/api/public/jobs/career-material")({
  server: {
    handlers: {
      GET: async () => fail(405, "method_not_allowed"),
      POST: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;

        const [{ supabaseAdmin }, { runCareerMaterialWorker }] = await Promise.all([
          import("@/integrations/supabase/client.server"),
          import("@/lib/career-material/worker.server"),
        ]);
        try {
          const summary = await runCareerMaterialWorker({
            admin: supabaseAdmin,
            resendApiKey: process.env["RESEND_API_KEY"]?.trim() || null,
          });
          return Response.json({ ok: true, summary });
        } catch (err) {
          console.error(
            "[career-material-worker] run failed",
            err instanceof Error ? err.message.slice(0, 60) : "unknown",
          );
          return fail(500, "worker_error");
        }
      },
    },
  },
});
