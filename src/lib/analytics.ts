/**
 * Google Tag Manager for karrierenmin.no.
 * Lastes bare på det publiserte domenet og bare etter at besøkende har
 * godtatt analyse-informasjonskapsler (ekomloven og personvernerklæringen).
 * Alle funksjoner som rører nettleseren kalles fra effekter eller klikk.
 */
export const GTM_ID = "GTM-M47S7FVV";
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

/** Skal GTM lastes? Krever både riktig domene og uttrykkelig samtykke. */
export function shouldLoadGtm(hostname: string, consent: AnalyticsConsent | null): boolean {
  return isAnalyticsHost(hostname) && consent === "granted";
}

type GtagWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
  __kmGtmLoaded?: boolean;
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

/** Laster GTM-containeren én gang. Annonsesignaler er alltid avslått. */
export function loadGtm(): void {
  const w = window as GtagWindow;
  if (w.__kmGtmLoaded || !shouldLoadGtm(w.location.hostname, readConsent())) return;
  w.__kmGtmLoaded = true;
  w.dataLayer = w.dataLayer || [];
  w.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params -- gtag trenger arguments-objektet
    w.dataLayer!.push(arguments);
  };
  w.gtag("consent", "default", {
    analytics_storage: "granted",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });
  w.gtag("js", new Date());
  w.dataLayer.push({ "gtm.start": new Date().getTime(), event: "gtm.js" });
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtm.js?id=${GTM_ID}`;
  document.head.appendChild(script);
}

/** Trekker samtykket tilbake. Siden lastes på nytt så GTM ikke lenger kjører. */
export function withdrawConsent(): void {
  const w = window as GtagWindow;
  writeConsent("denied");
  if (w.__kmGtmLoaded && w.gtag) {
    w.gtag("consent", "update", { analytics_storage: "denied" });
    w.location.reload();
  }
}
