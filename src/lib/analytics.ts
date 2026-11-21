/**
 * Google Tag Manager og Google-taggen (GA4) for karrierenmin.no (Google Consent Mode v2).
 * Taggene settes inn rett etter <head> av serveren (src/server.ts), bare på det
 * publiserte domenet. Før samtykke er all lagring avslått, så ingen
 * analyse-informasjonskapsler settes; «Godta analyse» slår på analyse_storage.
 * Annonsesignaler er alltid avslått.
 */
export const GTM_ID = "GTM-M47S7FVV";
/** Google-taggen (GA4-strøm) som lastes sammen med GTM i samme dataLayer. */
export const GA4_ID = "G-40M285DMYF";
export const CONSENT_STORAGE_KEY = "karrierenmin-analytics-consent";
export type AnalyticsConsent = "granted" | "denied";

const ANALYTICS_HOSTS = new Set(["karrierenmin.no", "www.karrierenmin.no"]);

/** Analyse tilbys bare på det publiserte domenet, ikke i forhåndsvisning eller lokalt. */
export function isAnalyticsHost(hostname: string): boolean {
  return ANALYTICS_HOSTS.has(hostname.toLowerCase());
}

export function parseConsent(value: string | null | undefined): AnalyticsConsent | null {
  return value === "granted" || value === "denied" ? value : null;
}

/** Skal analyse-informasjonskapsler tillates? Krever riktig domene og uttrykkelig samtykke. */
export function analyticsStorageFor(
  hostname: string,
  consent: AnalyticsConsent | null,
): AnalyticsConsent {
  return isAnalyticsHost(hostname) && consent === "granted" ? "granted" : "denied";
}

/**
 * HTML som settes inn rett etter <head>. Samtykke-standarden settes før
 * gtm.js kjører, og leser brukerens tidligere valg fra localStorage.
 */
export function gtmHeadSnippet(): string {
  const consentScript =
    "window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}" +
    "var c=null;try{c=localStorage.getItem(" +
    JSON.stringify(CONSENT_STORAGE_KEY) +
    ")}catch(e){}" +
    "gtag('consent','default',{analytics_storage:c==='granted'?'granted':'denied'," +
    "ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});" +
    "gtag('set','ads_data_redaction',true);" +
    "gtag('set','developer_id.dZjgwMW',true);" +
    "gtag('js',new Date());" +
    "gtag('config'," +
    JSON.stringify(GA4_ID) +
    ");" +
    "dataLayer.push({'gtm.start':new Date().getTime(),event:'gtm.js'});";
  return (
    `<script>${consentScript}</script>` +
    `<script async src="https://www.googletagmanager.com/gtm.js?id=${GTM_ID}"></script>` +
    `<script async src="https://www.googletagmanager.com/gtag/js?id=${GA4_ID}"></script>`
  );
}

const HEAD_OPEN = /<head(\s[^>]*)?>/i;

/** Setter inn snutten rett etter første <head>. Uendret hvis <head> mangler. */
export function injectAfterHead(html: string, snippet: string): string {
  const match = HEAD_OPEN.exec(html);
  if (!match) return html;
  const at = match.index + match[0].length;
  return html.slice(0, at) + snippet + html.slice(at);
}

type GtagWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
};

export function readConsent(): AnalyticsConsent | null {
  try {
    return parseConsent(window.localStorage.getItem(CONSENT_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeConsent(consent: AnalyticsConsent): void {
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, consent);
  } catch {
    /* privat modus: valget gjelder bare denne visningen */
  }
}

export function clearConsent(): void {
  try {
    window.localStorage.removeItem(CONSENT_STORAGE_KEY);
  } catch {
    /* ignorer */
  }
}

/** Sender samtykkevalget til Google-taggen som allerede er lastet. */
export function applyConsent(consent: AnalyticsConsent): void {
  const w = window as GtagWindow;
  if (typeof w.gtag !== "function") return;
  w.gtag("consent", "update", {
    analytics_storage: analyticsStorageFor(w.location.hostname, consent),
  });
}

/** Trekker samtykket tilbake og laster siden på nytt med analyse avslått. */
export function withdrawConsent(): void {
  writeConsent("denied");
  applyConsent("denied");
  window.location.reload();
}
