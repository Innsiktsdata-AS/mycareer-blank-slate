// Lesing av karrieremateriale-inntak for innlogget bruker (RLS: kun egne rader).
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type {
  AttachmentStatus,
  CareerMaterialAttachment,
  CareerMaterialStatus,
} from "@/lib/career-material/contract";

export type CareerMaterialIntakeView = {
  id: string;
  documentId: string;
  title: string;
  documentDeleted: boolean;
  channel: "paste" | "email";
  status: CareerMaterialStatus;
  declaredType: string | null;
  aiType: string | null;
  aiConfidence: number | null;
  aiRationale: string | null;
  userType: string | null;
  effectiveType: string | null;
  errorCode: string | null;
  retryable: boolean | null;
  attemptCount: number;
  proposalsCreated: number;
  proposalsReused: number;
  itemsDropped: number;
  truncated: boolean;
  attachments: CareerMaterialAttachment[];
  createdAt: string;
  processedAt: string | null;
  leaseActive: boolean;
  pendingProposals: number;
  /** Elementer som allerede er godkjent fra denne kilden (vises alltid). */
  approved: Array<{ atomId: string; content: string; active: boolean }>;
  sourceContext: string | null;
  fileName: string | null;
  filePath: string | null;
};

type IntakeRow = {
  id: string;
  document_id: string;
  channel: string;
  status: string;
  declared_type: string | null;
  ai_type: string | null;
  ai_confidence: number | null;
  ai_rationale: string | null;
  user_type: string | null;
  effective_type: string | null;
  error_code: string | null;
  retryable: boolean | null;
  attempt_count: number;
  proposals_created: number;
  proposals_reused: number;
  items_dropped: number;
  truncated: boolean;
  attachments: unknown;
  created_at: string;
  processed_at: string | null;
  lease_expires_at: string | null;
};

export const careerMaterialKeys = {
  intakes: (userId: string) => ["career-material-intakes", userId] as const,
  emailFailures: (userId: string) => ["career-material-email-failures", userId] as const,
  attachments: (userId: string) => ["career-material-attachments", userId] as const,
  worker: (userId: string) => ["career-material-worker", userId] as const,
};

export const careerMaterialIntakesQuery = (userId: string) =>
  queryOptions({
    queryKey: careerMaterialKeys.intakes(userId),
    enabled: !!userId,
    queryFn: async (): Promise<CareerMaterialIntakeView[]> => {
      const { data: intakes, error } = await supabase
        .from("career_material_intakes")
        .select(
          "id, document_id, channel, status, declared_type, ai_type, ai_confidence, ai_rationale, user_type, effective_type, error_code, retryable, attempt_count, proposals_created, proposals_reused, items_dropped, truncated, attachments, created_at, processed_at, lease_expires_at",
        )
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      const rows = (intakes ?? []) as unknown as IntakeRow[];
      if (rows.length === 0) return [];
      const docIds = rows.map((r) => r.document_id);
      const [docsRes, propsRes] = await Promise.all([
        supabase
          .from("documents")
          .select("id, title, deleted_at, source_context, file_name, file_path")
          .in("id", docIds),
        supabase
          .from("atom_enrichment_proposals")
          .select("source_record_id, status, applied_atom_id")
          .eq("source_type", "career_material")
          .in("source_record_id", docIds)
          .in("status", ["pending_review", "needs_more_context", "approved"]),
      ]);
      if (docsRes.error) throw docsRes.error;
      if (propsRes.error) throw propsRes.error;
      const docRows = (docsRes.data ?? []) as Array<{
        id: string;
        title: string;
        deleted_at: string | null;
        source_context: string | null;
        file_name: string | null;
        file_path: string | null;
      }>;
      const docs = new Map(docRows.map((d) => [d.id, d]));
      const pending = new Map<string, number>();
      const approvedIds = new Map<string, string[]>();
      for (const p of (propsRes.data ?? []) as Array<{
        source_record_id: string | null;
        status: string;
        applied_atom_id: string | null;
      }>) {
        if (!p.source_record_id) continue;
        if (p.status === "approved") {
          if (p.applied_atom_id) {
            const list = approvedIds.get(p.source_record_id) ?? [];
            list.push(p.applied_atom_id);
            approvedIds.set(p.source_record_id, list);
          }
          continue;
        }
        pending.set(p.source_record_id, (pending.get(p.source_record_id) ?? 0) + 1);
      }
      const allAtomIds = Array.from(new Set(Array.from(approvedIds.values()).flat()));
      const atoms = new Map<string, { content: string; active: boolean }>();
      if (allAtomIds.length > 0) {
        const { data: atomRows, error: atomErr } = await supabase
          .from("career_atoms")
          .select("id, content_no, is_active")
          .in("id", allAtomIds);
        if (atomErr) throw atomErr;
        for (const a of (atomRows ?? []) as Array<{
          id: string;
          content_no: string | null;
          is_active: boolean | null;
        }>) {
          atoms.set(a.id, { content: a.content_no ?? "", active: a.is_active !== false });
        }
      }
      const now = Date.now();
      return rows.map((r) => {
        const doc = docs.get(r.document_id);
        return {
          id: r.id,
          documentId: r.document_id,
          title: doc?.title ?? "Karrieremateriale",
          documentDeleted: Boolean(doc?.deleted_at),
          channel: r.channel as "paste" | "email",
          status: r.status as CareerMaterialStatus,
          declaredType: r.declared_type,
          aiType: r.ai_type,
          aiConfidence: r.ai_confidence == null ? null : Number(r.ai_confidence),
          aiRationale: r.ai_rationale,
          userType: r.user_type,
          effectiveType: r.effective_type,
          errorCode: r.error_code,
          retryable: r.retryable,
          attemptCount: r.attempt_count,
          proposalsCreated: r.proposals_created,
          proposalsReused: r.proposals_reused,
          itemsDropped: r.items_dropped,
          truncated: r.truncated,
          attachments: Array.isArray(r.attachments)
            ? (r.attachments as CareerMaterialAttachment[])
            : [],
          createdAt: r.created_at,
          processedAt: r.processed_at,
          leaseActive: r.lease_expires_at ? new Date(r.lease_expires_at).getTime() > now : false,
          pendingProposals: pending.get(r.document_id) ?? 0,
          approved: (approvedIds.get(r.document_id) ?? [])
            .filter((id) => atoms.has(id))
            .map((id) => ({ atomId: id, ...atoms.get(id)! })),
          sourceContext: doc?.source_context ?? null,
          fileName: doc?.file_name ?? null,
          filePath: doc?.file_path ?? null,
        };
      });
    },
    // Bakgrunnsjobben kan behandle e-post når som helst; mens noe står i kø
    // eller analyseres, oppdateres listen jevnlig.
    refetchInterval: (q) =>
      (q.state.data ?? []).some(
        (r) => (r.status === "processing" && r.leaseActive) || r.status === "queued",
      )
        ? 10_000
        : false,
  });

export type CareerAttachmentView = {
  id: string;
  filename: string | null;
  kind: string | null;
  status: AttachmentStatus;
  errorCode: string | null;
  retryable: boolean | null;
  attemptCount: number;
  sizeBytes: number | null;
  pageCount: number | null;
  storagePath: string | null;
  documentId: string | null;
  intakeId: string | null;
  createdAt: string;
};

/** Vedlegg fra e-post til karriereadressen, med status per fil. */
export const careerMaterialAttachmentsQuery = (userId: string) =>
  queryOptions({
    queryKey: careerMaterialKeys.attachments(userId),
    enabled: !!userId,
    queryFn: async (): Promise<CareerAttachmentView[]> => {
      const { data, error } = await supabase
        .from("career_material_attachments")
        .select(
          "id, filename, kind, status, error_code, retryable, attempt_count, size_bytes, declared_size_bytes, page_count, storage_path, document_id, intake_id, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      type Row = {
        id: string;
        filename: string | null;
        kind: string | null;
        status: string;
        error_code: string | null;
        retryable: boolean | null;
        attempt_count: number;
        size_bytes: number | null;
        declared_size_bytes: number | null;
        page_count: number | null;
        storage_path: string | null;
        document_id: string | null;
        intake_id: string | null;
        created_at: string;
      };
      return ((data ?? []) as unknown as Row[]).map((a) => ({
        id: a.id,
        filename: a.filename,
        kind: a.kind,
        status: a.status as AttachmentStatus,
        errorCode: a.error_code,
        retryable: a.retryable,
        attemptCount: a.attempt_count,
        sizeBytes: a.size_bytes ?? a.declared_size_bytes ?? null,
        pageCount: a.page_count,
        storagePath: a.storage_path,
        documentId: a.document_id,
        intakeId: a.intake_id,
        createdAt: a.created_at,
      }));
    },
    refetchInterval: (q) =>
      (q.state.data ?? []).some((a) => a.status === "queued" || a.status === "processing")
        ? 10_000
        : false,
  });

export type CareerWorkerStateView = {
  pausedReason: string | null;
  pausedAt: string | null;
  pauseErrorCode: string | null;
  lastRunAt: string | null;
};

/** Arbeiderstatus — bare synlig for administratorer (RLS). */
export const careerMaterialWorkerStateQuery = (userId: string) =>
  queryOptions({
    queryKey: careerMaterialKeys.worker(userId),
    enabled: !!userId,
    queryFn: async (): Promise<CareerWorkerStateView | null> => {
      const { data } = await supabase
        .from("career_material_worker_state")
        .select("paused_reason, paused_at, pause_error_code, last_run_at")
        .maybeSingle();
      if (!data) return null;
      return {
        pausedReason: data.paused_reason,
        pausedAt: data.paused_at,
        pauseErrorCode: data.pause_error_code,
        lastRunAt: data.last_run_at,
      };
    },
  });

export type CareerEmailFailure = {
  id: string;
  outcome: string;
  rejectReason: string | null;
  at: string | null;
};

/** Siste e-poster til karriereadressen som ikke kunne tas imot. */
export const careerMaterialEmailFailuresQuery = (userId: string) =>
  queryOptions({
    queryKey: careerMaterialKeys.emailFailures(userId),
    enabled: !!userId,
    queryFn: async (): Promise<CareerEmailFailure[]> => {
      const { data: source } = await supabase
        .from("email_job_sources")
        .select("id")
        .eq("intake_mode", "career_material")
        .limit(1)
        .maybeSingle();
      if (!source) return [];
      const { data, error } = await supabase
        .from("inbound_email_deliveries")
        .select("id, outcome, reject_reason, last_attempt_at")
        .eq("email_job_source_id", source.id)
        .in("outcome", ["parse_failed", "ingest_failed"])
        .order("last_attempt_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      const rows = (data ?? []) as Array<{
        id: string;
        outcome: string;
        reject_reason: string | null;
        last_attempt_at: string | null;
      }>;
      return rows.map((d) => ({
        id: d.id,
        outcome: d.outcome,
        rejectReason: d.reject_reason,
        at: d.last_attempt_at,
      }));
    },
  });
