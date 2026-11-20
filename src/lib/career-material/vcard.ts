/**
 * Kontaktkort (vCard 3.0) for brukerens private mottaksadresse for
 * karrieremateriale. Lages i nettleseren fra adressen brukeren allerede ser —
 * ingen offentlig lenke, ingen lagring på serveren.
 */

export const ARCHIVE_VCARD_NAME = "Karrierenmin – mitt arkiv";
export const ARCHIVE_VCARD_FILENAME = "karrierenmin-mitt-arkiv.vcf";

const EMAIL_RE = /^[a-z0-9._+-]{1,64}@[a-z0-9.-]{1,253}\.[a-z]{2,}$/i;

/** Escaping etter RFC 2426 (backslash, komma, semikolon, linjeskift). */
export function escapeVcardText(v: string): string {
  return v
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/** Returnerer null for en adresse som ikke ser gyldig ut (ingen injeksjon i kortet). */
export function buildArchiveVcard(address: string): string | null {
  const email = address.trim();
  if (!EMAIL_RE.test(email)) return null;
  const name = escapeVcardText(ARCHIVE_VCARD_NAME);
  return [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN;CHARSET=UTF-8:${name}`,
    `N;CHARSET=UTF-8:${escapeVcardText("mitt arkiv")};${escapeVcardText("Karrierenmin")};;;`,
    `ORG;CHARSET=UTF-8:Karrierenmin`,
    `EMAIL;TYPE=INTERNET:${email}`,
    `NOTE;CHARSET=UTF-8:${escapeVcardText(
      "Privat adresse for karrieremateriale. Alle som har adressen kan sende materiale til arkivet ditt.",
    )}`,
    "END:VCARD",
    "",
  ].join("\r\n");
}
