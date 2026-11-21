import { describe, expect, it } from "vitest";
import {
  GA4_ID,
  GTM_ID,
  analyticsStorageFor,
  gtmHeadSnippet,
  injectAfterHead,
  isAnalyticsHost,
  parseConsent,
} from "@/lib/analytics";

describe("Google Tag Manager på karrierenmin.no", () => {
  it("bruker containeren GTM-M47S7FVV", () => {
    expect(GTM_ID).toBe("GTM-M47S7FVV");
    expect(gtmHeadSnippet()).toContain(
      '<script async src="https://www.googletagmanager.com/gtm.js?id=GTM-M47S7FVV"></script>',
    );
  });
  it("laster Google-taggen G-40M285DMYF én gang, etter samtykke-standarden", () => {
    const s = gtmHeadSnippet();
    expect(GA4_ID).toBe("G-40M285DMYF");
    expect(s.match(/gtag\/js\?id=G-40M285DMYF/g)?.length).toBe(1);
    expect(s).toContain(`gtag('config',"G-40M285DMYF")`);
    expect(s.indexOf("gtag('consent','default'")).toBeLessThan(s.indexOf("gtag('config'"));
  });
  it("tilbys bare på karrierenmin.no og www.karrierenmin.no", () => {
    expect(isAnalyticsHost("karrierenmin.no")).toBe(true);
    expect(isAnalyticsHost("www.karrierenmin.no")).toBe(true);
    expect(isAnalyticsHost("karrierenmin.lovable.app")).toBe(false);
    expect(isAnalyticsHost("localhost")).toBe(false);
  });
  it("analyse-lagring er avslått uten uttrykkelig samtykke", () => {
    expect(analyticsStorageFor("karrierenmin.no", null)).toBe("denied");
    expect(analyticsStorageFor("karrierenmin.no", "denied")).toBe("denied");
    expect(analyticsStorageFor("karrierenmin.no", "granted")).toBe("granted");
    expect(analyticsStorageFor("karrierenmin.lovable.app", "granted")).toBe("denied");
  });
  it("samtykke-standarden settes før gtm.js, og annonsesignaler er alltid av", () => {
    const s = gtmHeadSnippet();
    expect(s.indexOf("gtag('consent','default'")).toBeLessThan(s.indexOf("gtm.js?id="));
    expect(s).toContain("ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'");
    expect(s).toContain("analytics_storage:c==='granted'?'granted':'denied'");
  });
  it("settes inn rett etter <head>, og bare én gang", () => {
    const html = '<!DOCTYPE html><html lang="nb"><head><meta charset="utf-8"></head><body><head></head></body></html>';
    const out = injectAfterHead(html, "<X>");
    expect(out).toBe('<!DOCTYPE html><html lang="nb"><head><X><meta charset="utf-8"></head><body><head></head></body></html>');
    expect(injectAfterHead("<p>ingen head</p>", "<X>")).toBe("<p>ingen head</p>");
  });
  it("ukjent lagret verdi tolkes som ikke valgt", () => {
    expect(parseConsent("yes")).toBeNull();
    expect(parseConsent("granted")).toBe("granted");
  });
});
