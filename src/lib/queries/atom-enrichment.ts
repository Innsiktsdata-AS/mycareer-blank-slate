// Karriereontologi v4, fase 2.2. @ts-nocheck er fjernet med vilje: typekontrollen er
// det som fanger feil måltabell, feil felttype og manglende peker-ID-er.
import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type {
  Database,
  Json,
  Tables,
  TablesInsert,
  TablesUpdate,
} from "@/integrations/supabase/types";

export type AtomEnrichmentBatchRow = Tables<"atom_enrichment_batches">;
export type AtomEnrichmentProposalRow = Tables<"atom_enrichment_proposals">;

export type AtomEnrichmentProposalAction =
  Database["public"]["Enums"]["atom_enrichment_proposal_action"];
export type AtomEnrichmentProposalStatus =
  Database["public"]["Enums"]["atom_enrichment_proposal_status"];

export const ATOM_ENRICHMENT_PROPOSAL_ACTION_LABELS: Record<AtomEnrichmentProposalAction, string> =
  {
    create_atom: "Opprett atom",
    update_atom: "Oppdater atom",
    merge_atoms: "Slå sammen atomer",
    deactivate_atom: "Deaktiver atom",
    flag_conflict: "Flagg konflikt",
    suggest_positioning: "Foreslå posisjonering",
    suggest_narrative: "Foreslå fortelling",
    suggest_evidence: "Foreslå evidens",
    suggest_preference_clarification: "Foreslå avklaring av preferanse",
  };

export const ATOM_ENRICHMENT_PROPOSAL_STATUS_LABELS: Record<AtomEnrichmentProposalStatus, string> =
  {
    pending_review: "Venter på vurdering",
    approved: "Godkjent",
    rejected: "Avvist",
    merged: "Flettet",
    needs_more_context: "Trenger mer kontekst",
    superseded: "Erstattet",
    expired: "Utløpt",
  };

export const TARGET_ATOM_TYPE_LABELS: Record<string, string> = {
  career_atom: "Karriereatom",
  // Utfaset modell. Beholdes bare så gamle forslag kan vises og avvises forståelig.
  user_preference_atom: "Preferanseatom (utfaset modell)",
  user_evidence_atom: "Evidensatom (utfaset modell)",
  opportunity_requirement_atom: "Stillingskrav-atom",
  company_profile_atom: "Selskapsprofil-atom",
  company_signal_atom: "Selskapssignal-atom",
};

/** Approving these actions records acceptance in gjennomgangen only — no rows in atom-tabeller. */
const APPROVAL_WITHOUT_ATOM_WRITE: ReadonlySet<AtomEnrichmentProposalAction> = new Set([
  "suggest_evidence",
  "suggest_preference_clarification",
  "flag_conflict",
  "suggest_positioning",
  "suggest_narrative",
  "merge_atoms",
]);

export function proposalApprovalWritesAtoms(row: AtomEnrichmentProposalRow): boolean {
  return !APPROVAL_WITHOUT_ATOM_WRITE.has(row.proposal_action);
}

export function invalidateAtomEnrichmentQueries(qc: QueryClient, userId: string): void {
  void qc.invalidateQueries({ queryKey: ["atom-enrichment-batches", userId] });
  void qc.invalidateQueries({ queryKey: ["atom-enrichment-proposals", userId] });
}

export const atomEnrichmentBatchesQuery = (userId: string) =>
  queryOptions({
    queryKey: ["atom-enrichment-batches", userId],
    enabled: !!userId,
    staleTime: 15_000,
    queryFn: async (): Promise<AtomEnrichmentBatchRow[]> => {
      const { data, error } = await supabase
        .from("atom_enrichment_batches")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AtomEnrichmentBatchRow[];
    },
  });

export const pendingAtomEnrichmentProposalsQuery = (userId: string) =>
  queryOptions({
    queryKey: ["atom-enrichment-proposals", userId, "pending"],
    enabled: !!userId,
    staleTime: 10_000,
    queryFn: async (): Promise<AtomEnrichmentProposalRow[]> => {
      const { data, error } = await supabase
        .from("atom_enrichment_proposals")
        .select("*")
        .eq("user_id", userId)
        .eq("status", "pending_review")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AtomEnrichmentProposalRow[];
    },
  });

/**
 * Taket på hvor mange forslag en statusliste henter. Listen er et utsnitt når
 * antallet treffer taket, og UI-et MÅ merke det til paginering er bygget.
 */
export const ATOM_ENRICHMENT_PROPOSAL_LIST_LIMIT = 80;

export const atomEnrichmentProposalsByStatusQuery = (
  userId: string,
  status: AtomEnrichmentProposalStatus,
) =>
  queryOptions({
    queryKey: ["atom-enrichment-proposals", userId, "status", status],
    enabled: !!userId,
    staleTime: 10_000,
    queryFn: async (): Promise<AtomEnrichmentProposalRow[]> => {
      const { data, error } = await supabase
        .from("atom_enrichment_proposals")
        .select("*")
        .eq("user_id", userId)
        .eq("status", status)
        .order("created_at", { ascending: false })
        // NB: taket kutter ved ATOM_ENRICHMENT_PROPOSAL_LIST_LIMIT. Listen er da
        // et utsnitt, ikke alt — merkes i UI til paginering finnes.
        .limit(ATOM_ENRICHMENT_PROPOSAL_LIST_LIMIT);
      if (error) throw error;
      return (data ?? []) as AtomEnrichmentProposalRow[];
    },
  });

export const atomEnrichmentProposalsByBatchQuery = (userId: string, batchId: string) =>
  queryOptions({
    queryKey: ["atom-enrichment-proposals", userId, "batch", batchId],
    enabled: !!userId && !!batchId,
    staleTime: 10_000,
    queryFn: async (): Promise<AtomEnrichmentProposalRow[]> => {
      const { data, error } = await supabase
        .from("atom_enrichment_proposals")
        .select("*")
        .eq("user_id", userId)
        .eq("batch_id", batchId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as AtomEnrichmentProposalRow[];
    },
  });

/**
 * Skjuler forslag som ikke lenger er reelle valg for brukeren:
 *  - forslag som peker på en parsekandidat som allerede er bekreftet i
 *    trinn 1–4 (databasen nekter dobbeltføring, så godkjenning ville feilet)
 *  - dobbeltoppførte forslag fra flere analysekjøringer (samme source_hash)
 */
export async function filterActionableProposals(
  userId: string,
  rows: AtomEnrichmentProposalRow[],
): Promise<AtomEnrichmentProposalRow[]> {
  const open = rows.filter(
    (r) => r.status === "pending_review" || r.status === "needs_more_context",
  );
  if (open.length === 0) return rows;

  const candidateIds = Array.from(
    new Set(
      open
        .map((r) => {
          const sd = asRecord(asRecord(r.proposal_payload)["structured_data"] as Json);
          const id = sd["parse_candidate_id"];
          return typeof id === "string" && id.trim() ? id.trim() : null;
        })
        .filter((v): v is string => v !== null),
    ),
  );

  const promoted = new Set<string>();
  if (candidateIds.length > 0) {
    const { data, error } = await supabase
      .from("cv_parse_candidates")
      .select("id, promoted_atom_id")
      .eq("user_id", userId)
      .in("id", candidateIds);
    if (error) throw error;
    for (const row of data ?? []) {
      if (row.promoted_atom_id) promoted.add(row.id);
    }
  }

  const seenHashes = new Set<string>();
  const byNewestFirst = [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const hidden = new Set<string>();

  for (const row of byNewestFirst) {
    if (row.status !== "pending_review" && row.status !== "needs_more_context") continue;
    const payload = asRecord(row.proposal_payload);
    const sd = asRecord(payload["structured_data"] as Json);

    const candidateId = sd["parse_candidate_id"];
    if (typeof candidateId === "string" && promoted.has(candidateId)) {
      hidden.add(row.id);
      continue;
    }

    const hash = sd["source_hash"];
    const atomType = payload["atom_type"];
    if (typeof hash === "string" && hash.trim()) {
      const key = `${hash}|${typeof atomType === "string" ? atomType : ""}|${row.proposal_action}`;
      if (seenHashes.has(key)) {
        hidden.add(row.id);
        continue;
      }
      seenHashes.add(key);
    }
  }

  return rows.filter((r) => !hidden.has(r.id));
}

/** Alle forslag som stammer fra én CV-import. RLS holder dem private per bruker. */
export const atomEnrichmentProposalsByImportQuery = (userId: string, importId: string | null) =>
  queryOptions({
    queryKey: ["atom-enrichment-proposals", userId, "import", importId ?? ""],
    enabled: !!userId && !!importId,
    staleTime: 5_000,
    queryFn: async (): Promise<AtomEnrichmentProposalRow[]> => {
      const { data, error } = await supabase
        .from("atom_enrichment_proposals")
        .select("*")
        .eq("user_id", userId)
        .eq("source_import_id", importId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return await filterActionableProposals(userId, (data ?? []) as AtomEnrichmentProposalRow[]);
    },
  });

function asRecord(payload: Json | null | undefined): Record<string, unknown> {
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) return {};
  return payload as Record<string, unknown>;
}

function strField(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" ? v : v != null ? String(v) : null;
}

function numField(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function strArrayField(obj: Record<string, unknown>, key: string): string[] {
  const v = obj[key];
  if (!Array.isArray(v)) return [];
  return v
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim());
}

/** Klasser som bare kan belegges indirekte — de krever pekere til andre atomer. */
const ATOM_TYPES_REQUIRING_EVIDENCE_POINTERS = new Set(["skill", "domain"]);

const CAREER_ATOM_KINDS = new Set(["evidens", "mangel", "onske", "maal", "begrensning", "verdi"]);

const CAREER_ATOM_TYPES = new Set([
  "role",
  "achievement",
  "metric",
  "context",
  "tool",
  "education",
  "skill",
  "domain",
  "language",
  "certification",
  "project",
  "volunteer",
  "summary_fragment",
]);

const CAREER_ATOM_CONFIDENCE = new Set(["imported", "inferred", "verified"]);

async function assertCareerAtomEditable(userId: string, atomId: string): Promise<void> {
  const { data, error } = await supabase
    .from("career_atoms")
    .select("id, user_locked")
    .eq("id", atomId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Fant ikke karriereatomet.");
  if (data.user_locked) {
    throw new Error(
      "Atomet er låst av deg og kan ikke endres via AI-forslag. Rediger selv under Karriereprofil.",
    );
  }
}

/**
 * Bygger et career_atoms-innslag fra forslagets payload.
 *
 * Regler som håndheves her:
 * - `atom_class` og `attestation` settes aldri herfra (databasen eier dem).
 * - `confidence` er en opprinnelsesakse (imported/inferred/verified) og har ingenting
 *   med forslagets numeriske `confidence_score` å gjøre. De konverteres ikke.
 * - Indirekte klasser (kompetanse/eksponering) krever `evidence_atom_ids`.
 */
function buildCareerAtomFields(
  payload: Record<string, unknown>,
  row: AtomEnrichmentProposalRow,
): {
  atom_kind: string;
  atom_type: string | null;
  parent_atom_id: string | null;
  content_no: string | null;
  content_en: string | null;
  structured_data: Json;
  source_type: string;
  source_ref: string | null;
  source_quote: string | null;
  evidence_atom_ids: string[];
  confidence: string;
  viktighet: number | null;
  is_active: boolean;
} {
  const atomKind = strField(payload, "atom_kind")?.trim() ?? "";
  if (!CAREER_ATOM_KINDS.has(atomKind)) {
    throw new Error(
      `Forslaget mangler gyldig atom_kind (fikk «${atomKind || "ingen"}»). Forslaget må regenereres mot karriereontologi v4.`,
    );
  }
  const rawType = strField(payload, "atom_type")?.trim() || null;
  if (atomKind === "evidens") {
    if (!rawType || !CAREER_ATOM_TYPES.has(rawType)) {
      throw new Error(`Evidensforslag krever gyldig atom_type (fikk «${rawType ?? "ingen"}»).`);
    }
  } else if (rawType) {
    throw new Error("atom_type kan bare brukes for evidens-atomer.");
  }

  const evidenceAtomIds = strArrayField(payload, "evidence_atom_ids");
  if (
    rawType &&
    ATOM_TYPES_REQUIRING_EVIDENCE_POINTERS.has(rawType) &&
    evidenceAtomIds.length === 0
  ) {
    throw new Error(
      "Forslaget mangler evidence_atom_ids. Kompetanse og eksponering kan bare belegges indirekte, via pekere til kvalifikasjons-, resultat- eller rolleatomer.",
    );
  }

  const parentAtomId = strField(payload, "parent_atom_id");
  if (rawType === "domain" && !parentAtomId) {
    throw new Error(
      "Eksponering (atom_type=domain) krever parent_atom_id som peker på et rolleatom.",
    );
  }

  const contentNo = strField(payload, "content_no")?.trim() || null;
  const contentEn = strField(payload, "content_en")?.trim() || null;
  if (!contentNo && !contentEn) {
    throw new Error("Forslaget mangler innhold (content_no eller content_en).");
  }

  const confidence = strField(payload, "confidence")?.trim() || "inferred";
  if (!CAREER_ATOM_CONFIDENCE.has(confidence)) {
    throw new Error(
      `Ugyldig confidence «${confidence}». Gyldige verdier: imported, inferred, verified. Merk at forslagets numeriske confidence_score er en annen akse og ikke skal konverteres hit.`,
    );
  }

  const viktighetRaw = numField(payload, "viktighet");
  let viktighet: number | null = null;
  if (viktighetRaw != null) {
    if (!["onske", "verdi", "begrensning"].includes(atomKind)) {
      throw new Error("viktighet gjelder bare onske, verdi og begrensning.");
    }
    const rounded = Math.round(viktighetRaw);
    if (rounded < 1 || rounded > 6) {
      throw new Error("viktighet må ligge på 1–6-skalaen og skal ikke normaliseres.");
    }
    viktighet = rounded;
  }

  const structured = payload["structured_data"];
  const structuredData: Json =
    structured != null && typeof structured === "object" && !Array.isArray(structured)
      ? (structured as Json)
      : ({} as Json);

  return {
    atom_kind: atomKind,
    atom_type: rawType,
    parent_atom_id: parentAtomId,
    content_no: contentNo,
    content_en: contentEn,
    structured_data: structuredData,
    source_type: strField(payload, "source_type")?.trim() || row.source_type || "enrichment",
    source_ref: strField(payload, "source_ref") ?? row.source_id ?? null,
    source_quote: strField(payload, "source_quote"),
    evidence_atom_ids: evidenceAtomIds,
    confidence,
    viktighet,
    is_active: payload["is_active"] !== false,
  };
}

/**
 * Applies an approved proposal to user-owned atoms only.
 * Karriereontologi v4: `career_atoms` er eneste måltabell for brukeratomer.
 * Target-side atoms stay schema-ready; application is deferred (review-only in UI).
 */
/**
 * Kompetanseforslag fra karrieremateriale peker på resultatforslag
 * (`evidence_proposal_ids`). Ved godkjenning oversettes de til atomene
 * resultatforslagene faktisk ble til — bare godkjente, egne forslag teller.
 */
async function resolveEvidenceProposalAtoms(
  userId: string,
  payload: Record<string, unknown>,
): Promise<string[]> {
  const proposalIds = strArrayField(payload, "evidence_proposal_ids");
  if (proposalIds.length === 0) return [];
  const { data, error } = await supabase
    .from("atom_enrichment_proposals")
    .select("id, status, applied_atom_id")
    .eq("user_id", userId)
    .in("id", proposalIds);
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    id: string;
    status: string;
    applied_atom_id: string | null;
  }>;
  return rows
    .filter((r) => r.status === "approved" && typeof r.applied_atom_id === "string")
    .map((r) => r.applied_atom_id as string);
}

/** Maks lengde for brukerredigert innhold før godkjenning. */
export const PROPOSAL_EDIT_MAX = 400;

async function applyApprovedUserAtomProposal(
  userId: string,
  row: AtomEnrichmentProposalRow,
  opts?: { editedContent?: string | null },
): Promise<string | null> {
  const payload = { ...asRecord(row.proposal_payload) };
  const action = row.proposal_action;

  const edited = opts?.editedContent?.trim() || null;
  if (edited) {
    if (action !== "create_atom" || row.target_atom_type !== "career_atom") {
      throw new Error("Bare nye profiloppføringer kan redigeres før godkjenning.");
    }
    if (edited.length < 2 || edited.length > PROPOSAL_EDIT_MAX) {
      throw new Error(`Teksten må være mellom 2 og ${PROPOSAL_EDIT_MAX} tegn.`);
    }
    payload["content_no"] = edited;
    payload["structured_data"] = {
      ...asRecord(payload["structured_data"] as Json),
      user_edited: true,
    };
  }

  if (strArrayField(payload, "evidence_proposal_ids").length > 0) {
    const resolved = await resolveEvidenceProposalAtoms(userId, payload);
    if (resolved.length === 0) {
      throw new Error(
        "Godkjenn først resultatet denne kompetansen bygger på. Kompetanser kan bare lagres med et konkret resultat som grunnlag.",
      );
    }
    payload["evidence_atom_ids"] = Array.from(
      new Set([...strArrayField(payload, "evidence_atom_ids"), ...resolved]),
    );
  }

  if (
    row.target_atom_type === "user_preference_atom" ||
    row.target_atom_type === "user_evidence_atom"
  ) {
    throw new Error(
      "Forslaget peker på den utfasede atommodellen (user_preference_atoms / user_evidence_atoms). Det må regenereres mot career_atoms før det kan godkjennes.",
    );
  }

  if (row.target_atom_type === "career_atom") {
    if (action === "create_atom") {
      const fields = buildCareerAtomFields(payload, row);
      const { data: inserted, error } = await supabase
        .from("career_atoms")
        .insert({
          user_id: userId,
          ...fields,
        } as TablesInsert<"career_atoms">)
        .select("id")
        .single();
      if (error) throw error;
      return inserted?.id ?? null;
    }
    if (action === "update_atom") {
      const tid = row.target_atom_id;
      if (!tid) throw new Error("Mangler mål-atom-ID for oppdatering.");
      await assertCareerAtomEditable(userId, tid);
      const fields = buildCareerAtomFields(payload, row);
      const patch: TablesUpdate<"career_atoms"> = {
        content_no: fields.content_no,
        content_en: fields.content_en,
        structured_data: fields.structured_data,
        source_quote: fields.source_quote,
        source_ref: fields.source_ref,
        evidence_atom_ids: fields.evidence_atom_ids,
        parent_atom_id: fields.parent_atom_id,
        confidence: fields.confidence,
        viktighet: fields.viktighet,
        is_active: fields.is_active,
      };
      const { error } = await supabase
        .from("career_atoms")
        .update(patch)
        .eq("id", tid)
        .eq("user_id", userId);
      if (error) throw error;
      return null;
    }
    if (action === "deactivate_atom") {
      const tid = row.target_atom_id;
      if (!tid) throw new Error("Mangler mål-atom-ID for deaktivering.");
      await assertCareerAtomEditable(userId, tid);
      const { error } = await supabase
        .from("career_atoms")
        .update({ is_active: false })
        .eq("id", tid)
        .eq("user_id", userId);
      if (error) throw error;
      return null;
    }
  }

  if (
    row.target_atom_type === "opportunity_requirement_atom" ||
    row.target_atom_type === "company_profile_atom" ||
    row.target_atom_type === "company_signal_atom"
  ) {
    throw new Error(
      "Godkjenning som skriver til stillings- eller selskapsatomer er ikke implementert ennå — visning og avvisning støttes.",
    );
  }

  throw new Error(
    `Godkjenning for handlingen «${ATOM_ENRICHMENT_PROPOSAL_ACTION_LABELS[action] ?? action}» er ikke implementert ennå.`,
  );
}

/**
 * Databasefeil er ikke Error-objekter. Uten oversettelse endte alt som
 * «Kunne ikke behandle forslaget» i UI-et, og den reelle årsaken forsvant.
 */
export function readableProposalError(e: unknown): Error {
  if (e instanceof Error) return e;
  const raw = (() => {
    if (typeof e === "string") return e;
    if (e && typeof e === "object") {
      const rec = e as Record<string, unknown>;
      const parts = [rec["message"], rec["details"], rec["hint"]].filter(
        (v): v is string => typeof v === "string" && v.trim().length > 0,
      );
      if (parts.length > 0) return parts.join(" — ");
    }
    return "";
  })();

  const lower = raw.toLowerCase();
  if (lower.includes("allerede bekreftet")) {
    return new Error(
      "Dette funnet er allerede bekreftet i CV-gjennomgangen, og kan derfor ikke legges inn en gang til.",
    );
  }
  if (lower.includes("parsekandidat")) {
    return new Error("Forslaget peker på et funn som ikke lenger finnes i importen.");
  }
  if (lower.includes("atom_type=domain") || lower.includes("parent_atom_id")) {
    return new Error("Forslaget mangler kobling til en rolle og kan ikke godkjennes som det er.");
  }
  if (lower.includes("row-level security") || lower.includes("permission denied")) {
    return new Error("Du har ikke tilgang til å endre dette forslaget.");
  }
  return new Error(raw || "Kunne ikke behandle forslaget.");
}

export type CareerMaterialApprovalOptions = {
  eventStart: string | null;
  eventEnd: string | null;
  eventPrecision: "day" | "month" | "year" | null;
  /** Kilden dokumenterer en eksisterende oppføring i stedet for å lage ny. */
  targetAtomId: string | null;
  /** Brukeren har eksplisitt valgt å oppdatere datoen på den eksisterende oppføringen. */
  applyEventDate: boolean;
};

const CAREER_APPROVE_ERRORS: Record<string, string> = {
  not_found: "Fant ikke forslaget.",
  not_pending: "Forslaget er ikke lenger til vurdering.",
  invalid_edit: `Teksten må være mellom 2 og ${400} tegn.`,
  invalid_date: "Datoen er ugyldig. Bruk f.eks. 2021, mars 2021 eller 15.03.2021.",
  invalid_payload: "Forslaget mangler innhold og kan ikke godkjennes.",
  needs_evidence:
    "Godkjenn først resultatet denne kompetansen bygger på. Kompetanser kan bare lagres med et konkret resultat som grunnlag.",
  target_not_found: "Fant ikke oppføringen du valgte.",
  date_less_precise:
    "Datoen er mindre presis enn datoen oppføringen har. Velg å beholde datoen, eller skriv en like presis dato.",
  error: "Kunne ikke godkjenne forslaget. Prøv igjen.",
};

export async function approveAtomEnrichmentProposal(
  userId: string,
  proposalId: string,
  opts?: {
    reviewerComment?: string;
    editedContent?: string | null;
    careerMaterial?: CareerMaterialApprovalOptions;
  },
): Promise<void> {
  const { data: src } = await supabase
    .from("atom_enrichment_proposals")
    .select("source_type")
    .eq("id", proposalId)
    .eq("user_id", userId)
    .maybeSingle();
  if (src?.source_type === "career_material") {
    // Samlet, gjentakbar godkjenning på serveren (én transaksjon).
    const { approveCareerMaterialProposal } = await import(
      "@/lib/career-material/career-material.functions"
    );
    const cm = opts?.careerMaterial;
    const res = await approveCareerMaterialProposal({
      data: {
        proposalId,
        editedContent: opts?.editedContent?.trim() || null,
        reviewerComment: opts?.reviewerComment?.trim() || null,
        eventStart: cm?.eventStart ?? null,
        eventEnd: cm?.eventEnd ?? null,
        eventPrecision: cm?.eventPrecision ?? null,
        targetAtomId: cm?.targetAtomId ?? null,
        applyEventDate: cm?.applyEventDate === true,
      },
    });
    if (res.status === "approved" || res.status === "linked" || res.status === "already_approved")
      return;
    throw new Error(CAREER_APPROVE_ERRORS[res.status] ?? CAREER_APPROVE_ERRORS["error"]);
  }
  try {
    const { data: row, error: fetchErr } = await supabase
      .from("atom_enrichment_proposals")
      .select("*")
      .eq("id", proposalId)
      .eq("user_id", userId)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!row) throw new Error("Fant ikke forslaget.");
    if (row.status !== "pending_review" && row.status !== "needs_more_context") {
      throw new Error("Forslaget er ikke lenger til vurdering.");
    }

    const typed = row as AtomEnrichmentProposalRow;
    let appliedAtomId: string | null = null;
    if (proposalApprovalWritesAtoms(typed)) {
      appliedAtomId = await applyApprovedUserAtomProposal(userId, typed, {
        editedContent: opts?.editedContent ?? null,
      });
    }
    const editedContent = opts?.editedContent?.trim() || null;
    const originalContent = strField(asRecord(typed.proposal_payload), "content_no");

    const now = new Date().toISOString();
    const { data: updated, error: upErr } = await supabase
      .from("atom_enrichment_proposals")
      .update({
        status: "approved",
        reviewed_at: now,
        reviewed_by: userId,
        reviewer_comment: opts?.reviewerComment?.trim() || null,
        ...(appliedAtomId ? { applied_atom_id: appliedAtomId } : {}),
        ...(editedContent && editedContent !== originalContent
          ? {
              diff: {
                edited_by_user: true,
                original_content_no: originalContent,
                content_no: editedContent,
              } as Json,
            }
          : {}),
      })
      .eq("id", proposalId)
      .eq("user_id", userId)
      .in("status", ["pending_review", "needs_more_context"])
      .select("id")
      .maybeSingle();
    if (upErr) throw upErr;
    if (!updated)
      throw new Error("Kunne ikke bekrefte forslaget — det kan ha blitt behandlet av noen andre.");
  } catch (e) {
    throw readableProposalError(e);
  }
}

export async function rejectAtomEnrichmentProposal(
  userId: string,
  proposalId: string,
  reviewerComment?: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("atom_enrichment_proposals")
    .update({
      status: "rejected",
      reviewed_at: now,
      reviewed_by: userId,
      reviewer_comment: reviewerComment?.trim() || null,
    })
    .eq("id", proposalId)
    .eq("user_id", userId)
    .in("status", ["pending_review", "needs_more_context"])
    .select("id")
    .maybeSingle();
  if (error) throw readableProposalError(error);
  if (!data) throw new Error("Fant ikke forslaget, eller det er allerede behandlet.");
}

export async function markAtomEnrichmentProposalNeedsContext(
  userId: string,
  proposalId: string,
  reviewerComment?: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("atom_enrichment_proposals")
    .update({
      status: "needs_more_context",
      reviewed_at: now,
      reviewed_by: userId,
      reviewer_comment: reviewerComment?.trim() || null,
    })
    .eq("id", proposalId)
    .eq("user_id", userId)
    .eq("status", "pending_review")
    .select("id")
    .maybeSingle();
  if (error) throw readableProposalError(error);
  if (!data) throw new Error("Fant ikke forslaget, eller det er allerede behandlet.");
}

export async function reopenAtomEnrichmentProposalToPending(
  userId: string,
  proposalId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("atom_enrichment_proposals")
    .update({
      status: "pending_review",
      reviewed_at: null,
      reviewed_by: null,
    })
    .eq("id", proposalId)
    .eq("user_id", userId)
    .eq("status", "needs_more_context")
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data)
    throw new Error("Fant ikke forslaget, eller det er ikke merket som «trenger mer kontekst».");
}

export type BulkProposalOutcome = { ok: number; failed: { id: string; message: string }[] };

export async function bulkApproveAtomEnrichmentProposals(
  userId: string,
  proposalIds: string[],
  opts?: { reviewerComment?: string },
): Promise<BulkProposalOutcome> {
  const failed: { id: string; message: string }[] = [];
  let ok = 0;
  for (const id of proposalIds) {
    try {
      await approveAtomEnrichmentProposal(userId, id, { reviewerComment: opts?.reviewerComment });
      ok += 1;
    } catch (e) {
      failed.push({ id, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { ok, failed };
}

export async function bulkRejectAtomEnrichmentProposals(
  userId: string,
  proposalIds: string[],
  reviewerComment?: string,
): Promise<BulkProposalOutcome> {
  const failed: { id: string; message: string }[] = [];
  let ok = 0;
  for (const id of proposalIds) {
    try {
      await rejectAtomEnrichmentProposal(userId, id, reviewerComment);
      ok += 1;
    } catch (e) {
      failed.push({ id, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { ok, failed };
}

export async function bulkMarkAtomEnrichmentProposalsNeedsContext(
  userId: string,
  proposalIds: string[],
  reviewerComment?: string,
): Promise<BulkProposalOutcome> {
  const failed: { id: string; message: string }[] = [];
  let ok = 0;
  for (const id of proposalIds) {
    try {
      await markAtomEnrichmentProposalNeedsContext(userId, id, reviewerComment);
      ok += 1;
    } catch (e) {
      failed.push({ id, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { ok, failed };
}

export async function bulkReopenAtomEnrichmentProposalsToPending(
  userId: string,
  proposalIds: string[],
): Promise<BulkProposalOutcome> {
  const failed: { id: string; message: string }[] = [];
  let ok = 0;
  for (const id of proposalIds) {
    try {
      await reopenAtomEnrichmentProposalToPending(userId, id);
      ok += 1;
    } catch (e) {
      failed.push({ id, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { ok, failed };
}

export async function supersedeAtomEnrichmentProposal(
  userId: string,
  proposalId: string,
  supersededByProposalId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("atom_enrichment_proposals")
    .update({
      status: "superseded",
      reviewed_at: new Date().toISOString(),
      reviewed_by: userId,
      superseded_by_proposal_id: supersededByProposalId,
    })
    .eq("id", proposalId)
    .eq("user_id", userId)
    .eq("status", "pending_review")
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Fant ikke forslaget, eller det er ikke lenger til vurdering.");
}

/**
 * Lokal utvikling: oppretter én eksempel-batch med ett ventende forslag (preferanse).
 * Kjør kun når migrasjonen er brukt lokalt. Ikke bruk i produksjon.
 */
export async function insertLocalDevSamplePendingProposal(userId: string): Promise<{
  batchId: string;
  proposalId: string;
} | null> {
  if (!import.meta.env.DEV) {
    // Stille null her ga en «Testforslag opprettet»-toast uten at noe ble opprettet.
    throw new Error("Testforslag kan bare opprettes i utviklingsmiljø.");
  }

  const { data: batch, error: bErr } = await supabase
    .from("atom_enrichment_batches")
    .insert({
      user_id: userId,
      title: "Test — eksempelforslag (kun utvikling)",
      source_type: "dev_seed",
      context: { note: "Slettes trygt etter testing" },
    })
    .select("id")
    .single();
  if (bErr) throw bErr;
  const batchId = batch!.id as string;

  const proposalPayload: Json = {
    atom_kind: "onske",
    content_no: "Ønsker hovedsakelig hjemmekontor med planlagte kontordager.",
    structured_data: { dimensjon: "arbeidsform", etikett: "Hybrid (2–3 dager kontor)" },
    // Opprinnelsesakse, ikke styrke. Skal ikke utledes av forslagets confidence-tall.
    confidence: "inferred",
    viktighet: 5,
    source_type: "dev_seed",
    evidence_atom_ids: [],
  };

  const { data: prop, error: pErr } = await supabase
    .from("atom_enrichment_proposals")
    .insert({
      user_id: userId,
      batch_id: batchId,
      proposal_action: "create_atom",
      target_atom_type: "career_atom",
      source_type: "dev_seed",
      proposal_payload: proposalPayload,
      rationale: "Dette er et kunstig testforslag for utviklere — ikke ekte brukerdata.",
      explanation:
        "I produksjon skal slike testforslag ikke opprettes. Brukes bare for å sjekke skjema og tilganger lokalt.",
      confidence: 0.5,
      inferred: true,
      status: "pending_review",
    })
    .select("id")
    .single();
  if (pErr) throw pErr;

  return { batchId, proposalId: prop!.id as string };
}
