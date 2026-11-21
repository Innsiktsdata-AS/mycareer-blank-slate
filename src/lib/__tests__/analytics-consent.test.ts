import { describe, expect, it } from "vitest";
import { GTM_ID, isAnalyticsHost, parseConsent, shouldLoadGtm } from "@/lib/analytics";

describe("Google Tag Manager på karrierenmin.no", () => {
  it("bruker containeren GTM-M47S7FVV", () => {
    expect(GTM_ID).toBe("GTM-M47S7FVV");
  });
  it("tilbys bare på karrierenmin.no og www.karrierenmin.no", () => {
    expect(isAnalyticsHost("karrierenmin.no")).toBe(true);
    expect(isAnalyticsHost("www.karrierenmin.no")).toBe(true);
    expect(isAnalyticsHost("karrierenmin.lovable.app")).toBe(false);
    expect(isAnalyticsHost("localhost")).toBe(false);
  });
  it("lastes aldri uten uttrykkelig samtykke", () => {
    expect(shouldLoadGtm("karrierenmin.no", null)).toBe(false);
    expect(shouldLoadGtm("karrierenmin.no", "denied")).toBe(false);
    expect(shouldLoadGtm("karrierenmin.no", "granted")).toBe(true);
    expect(shouldLoadGtm("karrierenmin.lovable.app", "granted")).toBe(false);
  });
  it("ukjent lagret verdi tolkes som ikke valgt", () => {
    expect(parseConsent("yes")).toBeNull();
    expect(parseConsent("granted")).toBe("granted");
  });
});
