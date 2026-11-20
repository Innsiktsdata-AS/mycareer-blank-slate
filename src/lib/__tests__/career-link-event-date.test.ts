import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildCareerApprovalOptions } from "@/lib/career-material/approval-options";
import { parseEventDate } from "@/lib/career-material/event-date";

/**
 * Når en kilde kobles til en oppføring brukeren har fra før, foreslås datoen
 * fra kilden som ny dato på oppføringen. Tomt felt lar datoen stå uendret.
 */
const sql = readFileSync(
  "drizzle/migrations/0011_career_material_link_updates_event_date.sql",
  "utf8",
);

describe("dato fra kilden ved kobling til eksisterende oppføring", () => {
  it("sender bekreftet dato med når kilden kobles til en eksisterende oppføring", () => {
    const o = buildCareerApprovalOptions("atom-1", parseEventDate("15.03.2022"));
    expect(o).toEqual({
      eventStart: "2022-03-15",
      eventEnd: null,
      eventPrecision: "day",
      targetAtomId: "atom-1",
    });
  });
  it("tomt datofelt ved kobling sender ingen dato, så oppføringens dato står", () => {
    const o = buildCareerApprovalOptions("atom-1", null);
    expect(o.eventStart).toBeNull();
    expect(o.eventPrecision).toBeNull();
    expect(o.targetAtomId).toBe("atom-1");
  });
  it("ny oppføring får datoen og ingen kobling", () => {
    const o = buildCareerApprovalOptions("new", parseEventDate("2021"));
    expect(o).toEqual({ eventStart: "2021-01-01", eventEnd: null, eventPrecision: "year", targetAtomId: null });
  });
  it("databasen oppdaterer datoen bare når en dato er oppgitt, og bare på egen aktiv oppføring", () => {
    expect(sql).toMatch(/a\.id = p_target_atom_id AND a\.user_id = p_user_id AND a\.is_active/);
    expect(sql).toMatch(/IF p_event_start IS NOT NULL AND \(/);
  });
  it("gammel dato lagres på forslaget for sporing", () => {
    expect(sql).toMatch(/'previous_event', jsonb_build_object\('start', v_prev_start/);
  });
});
