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

/** Vedlegg som ikke behandles — kun metadata lagres. */
export type CareerMaterialAttachment = {
  filename: string | null;
  content_type: string | null;
  size_bytes: number | null;
  status: "not_processed";
  reason: "attachments_not_supported";
};

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
};

export function careerMaterialErrorLabel(code: string | null | undefined): string {
  if (!code) return "Ukjent feil.";
  return CAREER_MATERIAL_ERROR_LABELS[code] ?? "Analysen feilet. Prøv igjen.";
}

/** Brukervendte årsaker for e-post som ikke ble tatt imot. */
export const INBOUND_REJECT_LABELS: Record<string, string> = {
  empty_message_body: "E-posten hadde ingen tekst (bare vedlegg støttes ikke).",
  email_too_large: "E-posten var for stor.",
  text_too_short: "E-posten hadde for lite tekst til å analyseres.",
  ingest_failed: "Kunne ikke lagre e-posten. Den forsøkes på nytt automatisk.",
};

export function inboundRejectLabel(code: string | null | undefined): string {
  if (!code) return "Ukjent feil.";
  if (code.startsWith("resend_api_") || code.startsWith("fetch_"))
    return "Kunne ikke hente e-posten fra e-posttjenesten. Den forsøkes på nytt automatisk.";
  return INBOUND_REJECT_LABELS[code] ?? "E-posten kunne ikke behandles.";
}
