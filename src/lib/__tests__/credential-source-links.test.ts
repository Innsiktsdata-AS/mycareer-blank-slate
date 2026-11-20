import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { sourceStatusByAtom } from "@/lib/career-facts/source-status";

/**
 * Filer lastet opp på en kvalifikasjon blir kildekobling automatisk, men bare
 * til brukerens egne oppføringer. Nye dokumenter blir sin egen dokumentgruppe
 * med mindre de legges i en gruppe som tilhører samme bruker.
 */
const links = readFileSync("drizzle/migrations/0009_credential_upload_source_links.sql", "utf8");
const group = readFileSync("drizzle/migrations/0010_documents_default_own_group.sql", "utf8");

describe("kildekobling fra opplastet kvalifikasjonsfil", () => {
  it("kobler bare til oppføringer som tilhører samme bruker som filen", () => {
    expect(links).toMatch(/a\.id = x\.atom_id AND a\.user_id = NEW\.user_id/);
  });
  it("gjelder bare filer lastet opp på en kvalifikasjon", () => {
    expect(links).toMatch(/WHEN \(NEW\.source_context = 'credential_upload'\)/);
  });
  it("gir aldri dobbel kobling for samme fil og oppføring", () => {
    expect(links).toMatch(/ON CONFLICT \(atom_id, document_id\) DO NOTHING/);
  });
  it("slettet fil gir «Kilde utilgjengelig», ikke «Dokumentert»", () => {
    const m = sourceStatusByAtom([
      { atom_id: "a", document_id: "d", document_exists: true, document_deleted: true },
    ]);
    expect(m.get("a")?.kind).toBe("unavailable");
  });
});

describe("dokumentgruppe for nye dokumenter", () => {
  it("bruker egen gruppe når gruppen ikke tilhører samme bruker", () => {
    expect(group).toMatch(/g\.id = NEW\.document_group_id AND g\.user_id = NEW\.user_id/);
    expect(group).toMatch(/NEW\.document_group_id := NEW\.id/);
  });
});
