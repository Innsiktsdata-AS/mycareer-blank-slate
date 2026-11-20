import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildCareerApprovalOptions, isLessPrecise } from "@/lib/career-material/approval-options";
import { parseEventDate } from "@/lib/career-material/event-date";
import { cvImportCopyPath } from "@/lib/career-material/career-material.functions";

/**
 * Når en kilde kobles til en oppføring brukeren har fra før, foreslås datoen
 * fra kilden. Datoen endres bare når brukeren eksplisitt velger det, og en
 * kjent dato erstattes aldri av en manglende eller mindre presis dato.
 */
const sql = readFileSync("drizzle/migrations/0012_career_material_link_date_explicit.sql", "utf8");
const link = (applyEventDate: boolean, currentPrecision: "day" | "month" | "year" | null) => ({
  applyEventDate,
  currentPrecision,
});

describe("dato fra kilden ved kobling til eksisterende oppføring", () => {
  it("sender datoen når brukeren eksplisitt har valgt å oppdatere", () => {
    expect(buildCareerApprovalOptions("atom-1", parseEventDate("15.03.2022"), link(true, "year"))).toEqual({
      eventStart: "2022-03-15",
      eventEnd: null,
      eventPrecision: "day",
      targetAtomId: "atom-1",
      applyEventDate: true,
    });
  });
  it("uten eksplisitt valg sendes ingen dato, så oppføringens dato står", () => {
    const o = buildCareerApprovalOptions("atom-1", parseEventDate("15.03.2022"), link(false, "year"));
    expect(o.applyEventDate).toBe(false);
    expect(o.eventStart).toBeNull();
    expect(o.targetAtomId).toBe("atom-1");
  });
  it("tomt datofelt erstatter aldri en kjent dato", () => {
    const o = buildCareerApprovalOptions("atom-1", null, link(true, "day"));
    expect(o.applyEventDate).toBe(false);
    expect(o.eventStart).toBeNull();
  });
  it("mindre presis dato (dag → år) erstatter aldri en kjent dato", () => {
    expect(isLessPrecise("year", "day")).toBe(true);
    expect(isLessPrecise("month", "day")).toBe(true);
    expect(isLessPrecise("day", "year")).toBe(false);
    expect(isLessPrecise("year", null)).toBe(false);
    const o = buildCareerApprovalOptions("atom-1", parseEventDate("2022"), link(true, "day"));
    expect(o.applyEventDate).toBe(false);
    expect(o.eventStart).toBeNull();
  });
  it("årstall gir bare år, ikke oppdiktet dag eller måned", () => {
    const o = buildCareerApprovalOptions("atom-1", parseEventDate("2022"), link(true, null));
    expect(o).toMatchObject({ eventStart: "2022-01-01", eventPrecision: "year", applyEventDate: true });
  });
  it("ny oppføring får datoen og ingen kobling", () => {
    const o = buildCareerApprovalOptions("new", parseEventDate("mars 2021"));
    expect(o).toMatchObject({ eventStart: "2021-03-01", eventEnd: null, eventPrecision: "month", targetAtomId: null, applyEventDate: false });
  });
  it("databasen endrer datoen bare ved eksplisitt valg og stopper mindre presis dato", () => {
    expect(sql).toMatch(/p_apply_event_date boolean DEFAULT false/);
    expect(sql).toMatch(/IF coalesce\(p_apply_event_date, false\) THEN/);
    expect(sql).toMatch(/IF v_rank_new < v_rank_old THEN\s+RETURN QUERY SELECT 'date_less_precise'/);
  });
  it("databasen endrer bare egen, aktiv oppføring og lagrer gammel dato", () => {
    expect(sql).toMatch(/a\.id = p_target_atom_id AND a\.user_id = p_user_id AND a\.is_active/);
    expect(sql).toMatch(/'previous_event', jsonb_build_object\('start', v_prev_start/);
  });
});

describe("CV-import fra arkivet", () => {
  it("bruker én fast filkopi per kildedokument, så avbrutte forsøk ikke hoper seg opp", () => {
    expect(cvImportCopyPath("u1", "d1", true)).toBe("u1/career-material-d1.pdf");
    expect(cvImportCopyPath("u1", "d1", false)).toBe("u1/career-material-d1.docx");
    expect(cvImportCopyPath("u1", "d1", true)).toBe(cvImportCopyPath("u1", "d1", true));
  });
});
