# Revisjonsrapport: karrieremateriale, dokumentasjon og generatorer

Status 20.11.2026. Bare lesing i denne runden. Merk at forrige runde allerede gjorde endringer i forhåndsvisningen (commit a250f377). Rapporten skiller mellom tre ting: **publisert**, **bare i forhåndsvisning** og **ikke bekreftet**.

## 1. Publiseringsstatus

| Del | Status | Bevis |
|---|---|---|
| Fase 1: ikke-støttede typer og «Behold i arkivet» | **Publisert** | Teksten står i lazy-lastede filer i den publiserte appen. Skjermbildet ditt viser knappen i produksjon. |
| Fase 2a: kontaktkort (vCard) | **Publisert** | Lå i samme publisering som fase 1. Finnes i lazy-lastede filer. |
| Nye typer (kursbevis, rolleendring, lønnsendring) og hendelsesdato | Bare forhåndsvisning | Endret i kode, men ikke publisert. |
| Treff på kvalifikasjon du allerede har, og atomisk godkjenning | Bare forhåndsvisning. Databasedelen er aktiv. | Migrasjon 0005 og rettelsen 0008 er kjørt i databasen. Databasen er felles for forhåndsvisning og produksjon. Knappene som bruker dem, er bare i forhåndsvisningen. |
| Dokumentasjonsstatus og felles leser for fakta | Bare forhåndsvisning | Kode i `src/lib/career-facts/*` |
| Send CV videre til CV-importen | Bare forhåndsvisning. Databasedelen er aktiv. | Migrasjon 0006 og 0007 |

At produksjonen hadde 0 forslag og 0 oppføringer fra karrieremateriale, betyr ikke at koden er upublisert. Det betyr bare at ingen forslag var godkjent ennå. Det eneste ekte dokumentet i produksjon ble klassifisert som «ukjent» og venter på at du velger type.

**Usikkerhet:** Eldre publiserte versjoner av godkjenningsknappen kan ikke kalle den nye godkjenningsfunksjonen. Den kan bare kalles fra serveren. Det er bekreftet. Jeg har ikke testet hva som skjer om noen godkjenner et kildeforslag i den publiserte appen før neste publisering.

## 2. Kodefunn per område

**Kategorivelgeren (det som var årsaken)**
- Den publiserte velgeren viser bare de fem opprinnelige typene. CV og sertifikat blir derfor gjenkjent, men forklart som typer som ikke støttes.
- I forhåndsvisningen er listen utvidet: `src/lib/career-material/contract.ts:9-31`. Tilsvarende sperrer i databasen er utvidet i migrasjon 0005.

**Dato**
- Publisert: Forslag får ingen hendelsesdato. Det eneste tidspunktet som lagres, er når noe ble lagt inn.
- Forhåndsvisning:
  - `event-date.ts:74` tolker dato (`parseEventDate`), og `:110` viser den (`formatEventRange`). Presisjonen er dag, måned eller år.
  - `analysis.server.ts:406` (`eventFromQuote`) beholder bare datoer som står ordrett i utdraget.
  - Brukeren bekrefter datoen i forslagskortet.
  - Registreringsdato, godkjenningsdato og hendelsesdato lagres hver for seg.

**Godkjenning**
- Publisert: Godkjenning skjer i flere steg fra nettleseren i `atom-enrichment.ts`. Det er ingen lås mot dobbeltklikk.
- Forhåndsvisning:
  - `atom-enrichment.ts:636-642` sender kildeforslag til `approveCareerMaterialProposal` (`career-material.functions.ts:171`). Den kaller databasefunksjonen `career_material_approve_proposal`.
  - Databasefunksjonen låser raden og tåler at samme godkjenning sendes flere ganger.
  - Feilen med tvetydig kolonne (42702) er rettet i migrasjon 0008.

**Eksisterende dokumentasjon**
- Publisert: Det finnes ingen automatisk kobling til en kvalifikasjon du allerede har. Det fungerer bare ved manuell opplasting på Kvalifikasjoner, der filen lagres som vedlegg i `structured_data`.
- Forhåndsvisning:
  - `matchExistingQualifications` (`analysis.server.ts:437`) foreslår treff, men brukeren velger selv. Generiske ord som «Foundation» teller ikke som treff.
  - Ved godkjenning lages det en kobling i `career_atom_sources`. Det lages ingen ny oppføring.
  - Gamle vedlegg ble flyttet over til `career_atom_sources` i migrasjon 0005.
  - «Dokumentert» vises bare når filen finnes og ikke er slettet. Ellers vises «Kilde utilgjengelig», og oppføringen beholdes.

**CV-generering**
- Bruker et fryst øyeblikksbilde av aktive oppføringer som er `verified` og brukerbekreftet (`career-atom-adapter.ts:32-36, 120-121`). Rå kildetekst leses aldri.
- Oppføringer fra kildeforslag lagres som `inferred` med brukerbekreftelse. De kommer derfor **ikke** med i CV-en i dag.
- Dette er bevisst. Planen sa at filteret i CV-generatoren ikke skulle endres nå.

**Søknadsbrev**
- `generate-cover-letter` bruker en profilrad som nettleseren sender, pluss data om stillingen.
- Funksjonen leser ikke `career_atoms` eller dokumenttekst. Det er altså ingen kobling til evidens.

**Oppsummeringer**
- Det finnes ingen egen generator for karriereoppsummering.
- Den felles leseren `getApprovedCareerFacts` (`career-facts.functions.ts:19`, regler i `approved-facts.ts:56,76`) er klar. Den kan filtrere på rolle og periode, men ingen generator bruker den ennå.

**CV mottatt på e-post**
- Publisert: Kan bare beholdes i arkivet.
- Forhåndsvisning: `sendCareerMaterialToCvImport` (`career-material.functions.ts:215`). Originalen beholdes. En unik sperre hindrer kopier, men ny import er mulig etter en feil.

## 3. Bekreftet i produksjon (bare struktur, ikke innhold)
- 2 kilder fra karrieremateriale, 0 forslag, 0 oppføringer fra karrieremateriale.
- 93 oppføringer med tom `attestation`.
- 77 oppføringer er `verified` og brukerbekreftet.
- Ingen private innholdsfelt er lest.

## 4. Testdekning
- **Finnes:**
  - 651 automatiske tester passerer, blant dem `career-facts.test.ts`. Den dekker dato, kursbevis, lønn, treff på eksisterende kvalifikasjon, overgangsregelen for gamle data og dokumentasjonsstatus.
  - Syntetisk test i nettleseren: ny og eksisterende sertifisering, dobbeltklikk, felles leser med periodefilter, og sletting av kilde.
- **Mangler:**
  - Kryssbrukertest av den felles leseren med en ekte bruker B.
  - Send til CV-import med en ekte PDF.
  - Rolleendring med ekte innhold.
  - Test i den publiserte appen.
  - Regresjonstest som sikrer at søknadsbrev og CV ikke tar med kildeforslag som ikke er godkjent.

## 5. Prioritert løsningsplan

1. **Publiser forhåndsvisningen** etter godkjenning fra deg. Så skal dette sjekkes i produksjon, i denne rekkefølgen:
   - Velg typen «Kursbevis» på det ventende dokumentet.
   - Godkjenn forslaget én gang.
   - Kontroller at det kom én oppføring og én kildekobling.
2. **Kryssbrukertest:** Bruker B skal få tomt svar fra den felles leseren og ikke se kildekoblingene til bruker A.
3. **CV-generatoren** skal hente fakta fra den felles leseren. Kildeforslag du har godkjent, kommer da med.
   - Test: Et godkjent kursbevis vises i CV-utkastet. Et forslag som ikke er godkjent, vises ikke.
4. **Søknadsbrev** skal hente fakta fra serveren gjennom den felles leseren, ikke fra profildata nettleseren sender.
   - Test: Påstander i brevet kan spores til godkjente fakta.
5. **Oppsummering** for kvartal, år eller rolle skal bygge på den felles leseren. Udaterte fakta merkes for seg.
6. **Rydding:**
   - Vise dato og presisjon på Kvalifikasjoner og Resultater.
   - Skjule CV-knappen når filen ikke er PDF eller Word.

## Tekniske detaljer
- Migrasjoner som er kjørt: 0005 til 0008 (de er additive). Ingen av dem er tilbakestilt.
- Prosjektregelen om at generatorer skal bruke `getApprovedCareerFacts` står i AGENTS.md.
