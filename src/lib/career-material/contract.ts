/**
 * Karrieremateriale — felles kontrakt for nettleser og server.
 *
 * Inneholder kun rene typer, etiketter og grenser. Ingen nøkler, ingen
 * serverkall. Dokumenttypene speiler CHECK-begrensningene i
 * public.career_material_intakes.
 */

export const CAREER_MATERIAL_TYPES = [
  "stillingsinstruks",
  "prosjektnotat",
  "medarbeidersamtale",
  "attest",
  "prestasjon",
] as const;

export type CareerMaterialType = (typeof CAREER_MATERIAL_TYPES)[number];
export type CareerMaterialAiType = CareerMaterialType | "ukjent";

export const CAREER_MATERIAL_TYPE_LABELS: Record<CareerMaterialAiType, string> = {
  stillingsinstruks: "Stillingsinstruks",
  prosjektnotat: "Prosjektnotat",
  medarbeidersamtale: "Medarbeidersamtale",
  attest: "Attest / referanse",
  prestasjon: "Prestasjon",
  ukjent: "Ukjent",
};

/** Kort forklaring av hvordan hver type brukes som grunnlag. */
export const CAREER_MATERIAL_TYPE_HINTS: Record<CareerMaterialType, string> = {
  stillingsinstruks:
    "Beskriver hva rollen krevde. Brukes som kontekst — ikke som bevis på hva du faktisk har levert.",
  prosjektnotat: "Dine egne notater fra et prosjekt. Kan gi forslag til resultater og kompetanser.",
  medarbeidersamtale:
    "Referat fra medarbeidersamtale. Kan gi forslag til resultater du selv bekrefter.",
  attest:
    "Andres utsagn om deg. Kan gi forslag til resultater, men regnes ikke som bevis på kompetanse.",
  prestasjon: "En konkret prestasjon du har oppnådd. Gir forslag til resultater og kompetanser.",
};

export function isCareerMaterialType(v: unknown): v is CareerMaterialType {
  return typeof v === "string" && (CAREER_MATERIAL_TYPES as readonly string[]).includes(v);
}

/** Typer der teksten er brukerens eget materiale om egen innsats. */
export const OWN_MATERIAL_TYPES: ReadonlySet<CareerMaterialType> = new Set([
  "prosjektnotat",
  "medarbeidersamtale",
  "prestasjon",
]);

export type CareerMaterialStatus = "queued" | "processing" | "needs_type" | "completed" | "failed";

export const CAREER_MATERIAL_STATUS_LABELS: Record<CareerMaterialStatus, string> = {
  queued: "Venter på analyse",
  processing: "Analyseres",
  needs_type: "Velg dokumenttype",
  completed: "Analysert",
  failed: "Feilet",
};

/** Grenser for innliming. */
export const PASTE_TITLE_MIN = 3;
export const PASTE_TITLE_MAX = 160;
export const PASTE_TEXT_MIN = 40;
export const PASTE_TEXT_MAX = 40_000;
/** Antall tegn som sendes til analyse. Lengre originaler lagres fullt. */
export const ANALYSIS_TEXT_MAX = 40_000;
/** Maks nye inntak per bruker per døgn (kostnadskontroll). */
export const DAILY_INTAKE_LIMIT = 40;
/** Under denne sikkerheten må brukeren selv velge dokumenttype. */
export const CLASSIFICATION_MIN_CONFIDENCE = 0.6;

/**
 * Oppsummering av vedlegg på selve e-postinntaket. Støttede vedlegg (PDF/DOCX)
 * behandles som egne kilder; de andre er bare registrert.
 */
export type CareerMaterialAttachment = {
  filename: string | null;
  content_type: string | null;
  size_bytes: number | null;
  status: AttachmentStatus | "not_processed";
  reason?: string | null;
};

/** Vedlegg: grenser og statuser. */
export type AttachmentKind = "pdf" | "docx";
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_MAX_PER_EMAIL = 5;
/** Minste antall synlige tegn før et vedlegg regnes som lesbart. */
export const ATTACHMENT_TEXT_MIN = 40;

export const ATTACHMENT_STATUSES = [
  "queued",
  "processing",
  "extracted",
  "duplicate",
  "unsupported",
  "too_large",
  "skipped_limit",
  "no_text",
  "unreadable",
  "encrypted",
  "failed",
] as const;
export type AttachmentStatus = (typeof ATTACHMENT_STATUSES)[number];

export type AttachmentRegistration = {
  position: number;
  provider_attachment_id: string | null;
  filename: string | null;
  content_type: string | null;
  size_bytes: number | null;
  kind: AttachmentKind | null;
  status: "queued" | "unsupported" | "too_large" | "skipped_limit" | "failed";
  error_code: string | null;
};

export const ATTACHMENT_STATUS_LABELS: Record<AttachmentStatus, string> = {
  queued: "Venter på behandling",
  processing: "Leses",
  extracted: "Lest — egen kilde",
  duplicate: "Samme tekst finnes fra før",
  unsupported: "Ikke støttet filtype",
  too_large: "For stor",
  skipped_limit: "Ikke behandlet (for mange vedlegg)",
  no_text: "Fant ingen tekst",
  unreadable: "Kunne ikke leses",
  encrypted: "Passordbeskyttet",
  failed: "Feilet",
};

/** Forklaring til brukeren per status. Ingen OCR: skannede PDF-er leses ikke. */
export const ATTACHMENT_STATUS_HINTS: Partial<Record<AttachmentStatus, string>> = {
  unsupported: "Vi leser bare PDF med tekst og Word (.docx).",
  too_large: `Maks ${ATTACHMENT_MAX_BYTES / (1024 * 1024)} MB og 60 sider per vedlegg.`,
  skipped_limit: `Vi behandler høyst ${ATTACHMENT_MAX_PER_EMAIL} vedlegg per e-post. Send resten i en ny e-post.`,
  no_text:
    "PDF-en ser ut til å være skannet eller består av bilder. Vi leser ikke tekst fra bilder (ingen OCR). Lim inn teksten selv, eller send en PDF med tekst.",
  unreadable: "Filen er skadet eller ikke en gyldig PDF/Word-fil.",
  encrypted: "Fjern passordet og send filen på nytt.",
  // «Prøves på nytt» avgjøres i attachmentHint ut fra faktisk køstatus.
  failed: "Behandlingen feilet.",
};

export function attachmentFailureHint(errorCode: string | null | undefined): string | null {
  if (!errorCode) return null;
  if (errorCode === "missing_attachment_id") return "E-posttjenesten oppga ikke vedlegget.";
  if (errorCode === "signature_mismatch") return "Innholdet stemmer ikke med filtypen.";
  if (errorCode === "attempt_limit") return "Ga opp etter flere forsøk.";
  return null;
}

/** Maks automatiske forsøk per vedlegg (samme grense som i databasekøen). */
export const ATTACHMENT_MAX_AUTO_ATTEMPTS = 6;
/** Maks automatiske forsøk per inntak (career_material_due_intakes). «Prøv igjen» tillater flere. */
export const INTAKE_MAX_AUTO_ATTEMPTS = 6;

/**
 * Forklaring for et vedlegg. «Prøves automatisk på nytt» vises bare når køen
 * faktisk vil prøve igjen (gjenforsøkbar feil og forsøk igjen).
 */
export function attachmentHint(a: {
  status: AttachmentStatus;
  errorCode: string | null;
  retryable: boolean | null;
  attemptCount: number;
}): string | null {
  const specific = attachmentFailureHint(a.errorCode);
  if (specific) return specific;
  if (a.status === "failed") {
    return a.retryable === true && a.attemptCount < ATTACHMENT_MAX_AUTO_ATTEMPTS
      ? "Behandlingen feilet. Den prøves automatisk på nytt."
      : "Behandlingen feilet og prøves ikke automatisk på nytt.";
  }
  return ATTACHMENT_STATUS_HINTS[a.status] ?? null;
}

/** Brukervendte feilmeldinger for sikre feilkoder. */
export const CAREER_MATERIAL_ERROR_LABELS: Record<string, string> = {
  missing_api_key: "Analysetjenesten er ikke konfigurert.",
  missing_profile: "Analysetjenesten er ikke konfigurert.",
  model_timeout: "Analysen tok for lang tid. Prøv igjen.",
  model_error: "Analysetjenesten svarte ikke som forventet. Prøv igjen.",
  invalid_model_output: "Analysen ga et svar vi ikke kunne bruke. Prøv igjen.",
  original_changed: "Originalteksten samsvarer ikke lenger med det som ble lagret.",
  document_missing: "Fant ikke originaldokumentet.",
  store_failed: "Kunne ikke lagre forslagene. Prøv igjen.",
  attempt_limit: "Dokumentet er analysert for mange ganger.",
  // Løfte om nytt forsøk legges til av visningen bare når køen faktisk prøver igjen.
  rate_limited: "Analysetjenesten er travel.",
  provider_blocked: "Analysetjenesten avviste forespørselen.",
};

export function careerMaterialErrorLabel(code: string | null | undefined): string {
  if (!code) return "Ukjent feil.";
  return CAREER_MATERIAL_ERROR_LABELS[code] ?? "Analysen feilet. Prøv igjen.";
}

/** Brukervendte årsaker for e-post som ikke ble tatt imot. */
export const INBOUND_REJECT_LABELS: Record<string, string> = {
  empty_message_body: "E-posten var tom.",
  no_supported_content:
    "E-posten hadde for lite tekst, og ingen vedlegg vi kan lese (PDF med tekst eller Word).",
  email_too_large: "E-posten var for stor.",
  text_too_short: "E-posten hadde for lite tekst til å analyseres.",
  ingest_failed: "Kunne ikke lagre e-posten.",
};

/**
 * Nye forsøk for avviste e-poster kommer bare fra e-posttjenestens egne
 * gjenleveringer, med høyst 10 timer mellom hvert. Uten nytt forsøk på 12
 * timer kommer det ingen flere.
 */
export const INBOUND_REDELIVERY_WINDOW_MS = 12 * 60 * 60 * 1000;

function isRetryableInboundReason(code: string): boolean {
  return code === "ingest_failed" || code.startsWith("resend_api_") || code.startsWith("fetch_");
}

export function inboundRejectLabel(
  code: string | null | undefined,
  lastAttemptAt?: string | null,
  now: number = Date.now(),
): string {
  if (!code) return "Ukjent feil.";
  const base =
    code.startsWith("resend_api_") || code.startsWith("fetch_")
      ? "Kunne ikke hente e-posten fra e-posttjenesten."
      : (INBOUND_REJECT_LABELS[code] ?? "E-posten kunne ikke behandles.");
  if (!isRetryableInboundReason(code)) return base;
  const at = lastAttemptAt ? Date.parse(lastAttemptAt) : NaN;
  const stillRetrying = Number.isFinite(at) && now - at < INBOUND_REDELIVERY_WINDOW_MS;
  return stillRetrying
    ? `${base} Den forsøkes på nytt automatisk.`
    : `${base} Den prøves ikke lenger automatisk — send e-posten på nytt.`;
}
