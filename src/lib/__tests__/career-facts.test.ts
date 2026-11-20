import { describe, expect, it } from "vitest";
import { formatEventRange, parseEventDate } from "@/lib/career-material/event-date";
import {
  buildCareerMaterialProposals,
  eventFromQuote,
  matchExistingQualifications,
  parseModelJson,
  validateAnalysis,
} from "@/lib/career-material/analysis.server";
import { isUserConfirmedFact, selectApprovedFacts, type FactAtomRow } from "@/lib/career-facts/approved-facts";
import { sourceStatusByAtom } from "@/lib/career-facts/source-status";

describe("hendelsesdato", () => {
  it("år gir presisjon år uten oppdiktet dag og måned", () => {
    expect(parseEventDate("2021")).toEqual({ start: "2021-01-01", end: null, precision: "year" });
    expect(formatEventRange("2021-01-01", null, "year")).toBe("2021");
  });
  it("måned og dag tolkes på norsk", () => {
    expect(parseEventDate("mars 2021")?.precision).toBe("month");
    expect(parseEventDate("15.03.2021")).toEqual({ start: "2021-03-15", end: null, precision: "day" });
    expect(parseEventDate("15. mars 2021")?.start).toBe("2021-03-15");
  });
  it("perioder og ugyldige datoer", () => {
    expect(parseEventDate("2019–2021")).toEqual({ start: "2019-01-01", end: "2021-12-31", precision: "year" });
    expect(parseEventDate("30.02.2021")).toBeNull();
    expect(parseEventDate("i fjor")).toBeNull();
    expect(parseEventDate("2021-2019")).toBeNull();
  });
  it("dato beholdes bare når den står i utdraget", () => {
    expect(eventFromQuote("mars 2021", "Bestått eksamen i mars 2021.")?.start).toBe("2021-03-01");
    expect(eventFromQuote("mars 2020", "Bestått eksamen i mars 2021.")).toBeNull();
  });
});

const CERT_SRC = "Kursbevis. Henrik Hansen har fullført PRINCE2 Foundation, utstedt av AXELOS, 15.03.2021.";
const ctx = (type: "kursbevis" | "lonnsendring" | "rolleendring") => ({
  type,
  documentId: "11111111-1111-1111-1111-111111111111",
  intakeId: "22222222-2222-2222-2222-222222222222",
  title: "t",
});

function analyse(json: object, src: string) {
  const raw = parseModelJson(JSON.stringify(json));
  if (!raw) throw new Error("parse");
  return validateAnalysis(raw, src);
}

describe("kursbevis", () => {
  const quote = "har fullført PRINCE2 Foundation, utstedt av AXELOS, 15.03.2021";
  it("gir sertifiseringsforslag med utsteder og dato fra utdraget", () => {
    const a = analyse(
      { dokumenttype: "kursbevis", sikkerhet: 0.9, kvalifikasjoner: [{ navn: "PRINCE2 Foundation", utsteder: "AXELOS", dato: "15.03.2021", gyldig_til: null, sitat: quote }] },
      CERT_SRC,
    );
    const items = buildCareerMaterialProposals(a, ctx("kursbevis"));
    expect(items).toHaveLength(1);
    const pl = items[0]!.payload as Record<string, any>;
    expect(pl["atom_type"]).toBe("certification");
    expect(pl["structured_data"]["issuer"]).toBe("AXELOS");
    expect(pl["structured_data"]["event_suggestion"]["start"]).toBe("2021-03-15");
    expect(pl["structured_data"]["valid_until_text"]).toBeNull();
  });
  it("utsteder og gyldighet som ikke står i utdraget forkastes", () => {
    const a = analyse(
      { dokumenttype: "kursbevis", sikkerhet: 0.9, kvalifikasjoner: [{ navn: "PRINCE2 Foundation", utsteder: "PMI", dato: "2020", gyldig_til: "2026", sitat: quote }] },
      CERT_SRC,
    );
    const q = a.qualifications[0]!;
    expect(q.issuer).toBeNull();
    expect(q.validUntil).toBeNull();
    expect(q.event).toBeNull();
  });
  it("matcher eksisterende kvalifikasjon på navn", () => {
    const m = matchExistingQualifications("PRINCE2 Foundation", [
      { id: "a", content: "PRINCE2 Foundation-sertifisering" },
      { id: "b", content: "Førerkort klasse B" },
    ]);
    expect(m.map((x) => x.id)).toEqual(["a"]);
  });
});

describe("lønnsendring", () => {
  it("gir ingen forslag (beløp blir i kilden)", () => {
    const src = "Din lønn er endret til 812 000 kroner fra 1. januar 2025.";
    const a = analyse(
      { dokumenttype: "lonnsendring", sikkerhet: 0.9, prestasjoner: [{ tekst: "Lønn 812 000", sitat: "Din lønn er endret til 812 000 kroner" }] },
      src,
    );
    expect(buildCareerMaterialProposals(a, ctx("lonnsendring"))).toHaveLength(0);
  });
});

const base: FactAtomRow = {
  id: "x", atom_kind: "evidens", atom_type: "achievement", content_no: "c", parent_atom_id: null,
  confidence: "verified", user_confirmed: true, is_active: true, source_type: "user_input",
  state: null, mangel_state: null, event_start: null, event_end: null, event_precision: null,
  created_at: "2026-11-20T10:00:00Z",
};

describe("felles faktagrunnlag", () => {
  it("overgangsregel mot eksisterende datatilstander", () => {
    const none = new Set<string>();
    expect(isUserConfirmedFact(base, none)).toBe(true);
    expect(isUserConfirmedFact({ ...base, user_confirmed: false }, none)).toBe(false);
    expect(isUserConfirmedFact({ ...base, confidence: "imported" }, none)).toBe(false);
    // Gammel inferred-oppføring med user_confirmed slipper ikke gjennom.
    expect(isUserConfirmedFact({ ...base, confidence: "inferred" }, none)).toBe(false);
    const cm = { ...base, confidence: "inferred", source_type: "career_material" };
    expect(isUserConfirmedFact(cm, none)).toBe(false);
    expect(isUserConfirmedFact(cm, new Set(["x"]))).toBe(true);
    expect(isUserConfirmedFact({ ...base, is_active: false }, none)).toBe(false);
    expect(isUserConfirmedFact({ ...base, state: "erstattet" }, none)).toBe(false);
  });
  it("filtrerer på periode og rolle, og skiller ut udaterte", () => {
    const atoms: FactAtomRow[] = [
      { ...base, id: "a", event_start: "2021-01-01", event_precision: "year", parent_atom_id: "r1" },
      { ...base, id: "b", event_start: "2023-03-01", event_precision: "month", parent_atom_id: "r1" },
      { ...base, id: "c", parent_atom_id: "r1" },
      { ...base, id: "d", event_start: "2021-06-01", event_precision: "month", parent_atom_id: "r2" },
    ];
    const r = selectApprovedFacts(atoms, new Set(), new Map(), { roleId: "r1", from: "2021-06-01", to: "2021-12-31" });
    expect(r.dated.map((f) => f.id)).toEqual(["a"]);
    expect(r.undated.map((f) => f.id)).toEqual(["c"]);
    expect(r.undated[0]!.event).toBeNull();
    expect(r.undated[0]!.registeredAt).toBe("2026-11-20T10:00:00Z");
  });
  it("dokumentasjonsstatus: gyldig kobling gir dokumentert, slettet gir utilgjengelig", () => {
    const m = sourceStatusByAtom([
      { atom_id: "a", document_id: "d1", document_exists: true, document_deleted: false },
      { atom_id: "b", document_id: "d2", document_exists: true, document_deleted: true },
      { atom_id: "c", document_id: null, document_exists: false, document_deleted: false },
    ]);
    expect(m.get("a")).toEqual({ kind: "documented", documentId: "d1", count: 1 });
    expect(m.get("b")).toEqual({ kind: "unavailable" });
    expect(m.get("c")).toEqual({ kind: "unavailable" });
  });
});

describe("matching: generiske ord gir ikke treff", () => {
  it("ITIL 4 Foundation matcher ikke PRINCE2 Foundation", () => {
    expect(matchExistingQualifications("ITIL 4 Foundation", [{ id: "a", content: "PRINCE2 Foundation" }])).toEqual([]);
  });
});
