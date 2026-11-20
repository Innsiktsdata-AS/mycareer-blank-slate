# Revisjon: karrieremateriale og dokumentasjon — funn og reparasjonsplan

Revisjonen var bare lesende. Ingen kode, database, data eller hemmeligheter er endret, og ingenting er publisert. Privat innhold er ikke lest. Produksjonsbevis er bare tellinger og strukturinformasjon.

## 1. Hvorfor sertifikat, kursbevis og CV mangler i typevelgeren
- Typevelgeren på /kilder viser bare `CAREER_MATERIAL_TYPES`. Det er fem typer: stillingsinstruks, prosjektnotat, medarbeidersamtale, attest og prestasjon (`src/lib/career-material/contract.ts:9–15`, `career-material-card.tsx:289–300, 798–807`).
- Serveren håndhever det samme. Innliming godtar bare disse typene (`career-material.functions.ts:21–29`), og databasen har tilsvarende regler på `career_material_intakes`.
- CV, kursbevis og sertifikat, rolle, lønn, faktura og «annet» finnes bare som *gjenkjent* type (`RECOGNIZED_KINDS`, contract.ts:41–84). De kan arkiveres, men gir ingen behandling. Dette var et bevisst valg i fase 1. Selve behandlingen hører til fase 3, som ikke er bygget.

## 2. Hva som er implementert og publisert
| Del | I koden | Publisert |
|---|---|---|
| Innliming, e-post, vedlegg (PDF/DOCX), bakgrunnsarbeider | Ja | Ja (produksjonstest 20.11) |
| Rettelser for lagring ved usikker type og Resend-vedlegg | Ja | Ja |
| Fase 1 (gjenkjent type, arkivering) og 2a (kontaktkort), commit `691c23cb` | Ja | Nei. Siste publisering var før denne endringen, og teksten ble ikke funnet i det publiserte nettstedet. |
| Fase 2b–6 | Nei | Nei |

**Produksjonsbevis (bare tellinger):**
- 2 inntak, begge uten gjenkjent type og uten arkivering.
- 0 forslag fra karrieremateriale.
- 0 profilelementer laget fra karrieremateriale.

Hele kjeden fra kilde til profil er altså aldri kjørt i produksjon.

## 3. Kjeden fra kilde til profil
1. **Inntak:** innliming, e-post og vedlegg går alle via `createCareerMaterial` og `career_material_create`. Originalen låses i `documents` (`store.server.ts:53–90`, `inbound.server.ts`, `worker.server.ts:207–255`).
2. **Klassifisering:** `analysis.server.ts` finner prestasjoner, ferdigheter og ansvar med ordrett utdrag. Det finnes ingen datofelt i KI-svaret (`analysis.server.ts:130–156`).
3. **Forslag** (`buildCareerMaterialProposals`, analysis.server.ts:373–532):
   - Typen `achievement` og typen `skill` (med kobling til en prestasjon) lages bare for eget materiale og attest.
   - Ellers lages bare hint.
   - Utfallet er alltid `confidence: "inferred"`, `source_type: "career_material"` og `source_ref` lik dokument-ID.
4. **Godkjenning:** `approveAtomEnrichmentProposal` og `applyApprovedUserAtomProposal` (`src/lib/queries/atom-enrichment.ts:497–637`) kjører fra nettleseren. Først lages profilelementet, så merkes forslaget som godkjent, i to separate skrivinger uten felles transaksjon. Svikter den andre, kan det bli et element uten godkjent forslag.
5. **Dato:**
   - Ingen hendelsesdato settes (`valid_from` og `valid_to` er tomme).
   - Godkjenningen sender ikke datofelt videre (atom-enrichment.ts:401–415).
   - `created_at` er godkjenningstidspunktet.
   - Det finnes ingen kode som dikter opp en hendelsesdato. Risikoen er at andre deler av appen kan lese `created_at` som om det var hendelsesdatoen.
6. **Kildekobling:** profilelementet beholder dokument-ID og utdrag. `source_record_id` finnes bare på forslaget.
7. **Status «dokumentert»:** settes aldri i denne kjeden. Det finnes ingen databaseregel på `career_atoms` som setter `attestation`; de fire reglene som finnes er sjekket.

## 4. Kobling til en kvalifikasjon som allerede finnes
- **Finnes ikke automatisk.** `dropCoveredByApproved` sammenligner bare med forslag fra *samme* dokument.
- `career_atom_link_suggest` krever to kjente element-ID-er.
- **En fil kan dokumentere en eksisterende registrering bare manuelt:** på /documentation under Kvalifikasjoner, via `uploadCredentialDocument` (`credential-atoms.ts:115–175`). Den lagrer et dokument med `atom_ids: [id]` og legger filen i `structured_data.dokumentasjon`. Den setter ikke `attestation`.

## 5. Dokumentasjonskategoriene (/documentation)
- Kategoriene er Oversikt, CV-er, Søknadsbrev, Resultater, Kompetanser, Kvalifikasjoner, Case, Andre dokumenter og Dokumentpakker (`documentation-layout.tsx:6–16`).
- «Dokumentert» betyr to forskjellige ting:
  - Under Resultater vises `career_atoms.attestation` (`resultater.tsx:25, 106`).
  - Under Kvalifikasjoner vises det når elementet har vedlagte filer i `structured_data` (`credential-sections.tsx:260–288`).
- Profilelement-spørringen kaller elementene «bekreftede», men filtrerer ikke på `user_confirmed` eller `confidence` (`documentation-atoms.ts:3–5, 57–92`).
- Kilder fra /kilder og e-post vises bare under «Andre dokumenter». De gjør ikke noe resultat eller noen kvalifikasjon dokumentert.

## 6. Hva generatorene leser
| Generator | Leser | Leser dokumentinnhold? | Grenser |
|---|---|---|---|
| Generell CV (`src/routes/api/cv/generations.ts`, `supabase/functions/_shared/cv-skills/generation/*`) | `career_atoms` med aktiv, evidens, `confidence = "verified"`, `user_confirmed`, aktiv tilstand og ingen mangel | Nei. Bare et fryst øyeblikksbilde av elementene. Kontaktinfo holdes utenfor KI. | Ingen grense på antall elementer og ingen avkorting. Svarlengde utkast 16k, omskriving 8k. Modellprofil fra databasen. |
| Søknadsbrev (`cover-letters.tsx:467–531`, edge `generate-cover-letter`) | Hele `profiles`-raden og stillingsdata, sendt fra nettleseren | Nei, og leser heller ikke `career_atoms` | Profilen kuttes ved 8 000 tegn og annonsen ved 6 000 tegn. Modellen er claude-sonnet-4-6. Profilen kommer fra klienten og kontrolleres ikke på serveren. |
| Karriereoppsummering | Ingen egen generator. Bare CV-ens «summary»-del. | Nei | Som CV |
| /cv-builder | Er bare en «kommer snart»-side | Ikke relevant | Ikke relevant |

**Hovedfunn:** elementer fra karrieremateriale får `confidence = "inferred"`, mens CV-generatoren krever `"verified"`. Godkjente funn fra kilder kan derfor aldri komme med i en CV. Søknadsbrev bruker ikke profilelementene i det hele tatt.

## 7. Tester
- **Finnes:**
  - `career-material-analysis`, `-store`, `-phase1`, `-attachments` og `-worker`
  - `inbound-career-route`
  - `cv-claim-accounting`, `cv-ats-date-mapping` og `cv-evidence-approval`
  - SQL-kanari for CV-generering
- **Mangler:**
  - Hele kjeden fra lagring via godkjenning til profilelement mot ekte database, inkludert dato, status og kildekobling
  - Delvis feil eller samtidighet ved godkjenning
  - Alle kombinasjonene av hva CV-en tar med, og at kildetekst holdes utenfor
  - Søknadsbrevets prompt og at profilen kommer fra klienten
  - At «dokumentert» betyr det samme på alle sider

## Tilleggsfunn: hva «verified» betyr i dag
- `confidence = "verified"` settes når brukeren bekrefter i CV-gjennomgangen eller legger inn manuelt (`cv-review-progress.ts:200`, `cv-review-manual-skills.ts:77`, `career-atoms.ts:310`). Kommentaren i `cv-review-progress.ts:219` sier at dette er atom-tillit, ikke tredjepartsverifisering.
- I praksis betyr «verified» altså «brukerbekreftet». Produksjon har 78 slike, 77 av dem med `user_confirmed = true`, og 15 importerte.

## Hva KI faktisk leser (presisert)
- Materiale brukeren selv sender inn (innliming, e-post til den private adressen, PDF/DOCX-vedlegg med tekstlag) analyseres automatisk.
- Analysen får tittel pluss inntil 40 000 tegn av kildeteksten, med dataavgrensning og forbud mot å følge instruksjoner i teksten. Den får ikke andre dokumenter, profilen eller kontakter.
- Det som endrer profilen eller kobler dokumentasjon, krever alltid brukerens godkjenning.
- CV-generatoren leser bare godkjente fakta, aldri kildetekst. Søknadsbrevet leser i dag profilraden (se 6).

## Implementeringsplan (prioritert)
Hvert steg testes før neste starter. Ingen publisering uten din godkjenning.

### Steg 1 — Publiseringsstatus og kontroll
- Bekreft hva som er publisert (fase 1 og 2a er det ikke ennå). Gå gjennom eksisterende funksjoner på nytt.
- *Godkjenningspunkt:* du tester /kilder i forhåndsvisningen, og deretter publiseres fase 1 og 2a.

### Steg 2 — Én atomisk godkjenning som tåler gjentak
- Et nytt server-RPC (`atom_proposal_approve`), tilgjengelig bare for serveren og kalt etter eierskapskontroll, gjør alt i én transaksjon:
  - oppretter eller oppdaterer faktaet (også godkjenning mot en eksisterende oppføring)
  - lagrer kildekoblingen
  - setter status på forslaget
- Brukes for alle forslag, ikke bare de fra karrieremateriale.
- Gjentak er trygt: radlås på forslaget, og et forslag som allerede er godkjent returnerer samme ID uten ny oppføring.
- *Test:* samtidige klikk gir én oppføring, en feil midt i ruller tilbake alt, nye forsøk gir ingen duplikater, og kryssbruker-test.

### Steg 3 — Bekreftelsesnivå, datoer og dokumentasjonsmodell
- **Tre adskilte nivåer:**
  1. *Brukerbekreftet:* godkjenning i forslagskøen eller i CV-gjennomgangen. Den ene godkjenningen er nok, og faktaet blir da kandidat til senere generering.
  2. *Dokumentert:* koblet til en låst kilde (fil eller innlimt tekst), og koblingen er godkjent av brukeren.
  3. *Uavhengig verifisert:* finnes ikke ennå, og settes ikke av appen.
- **Overgang uten å svekke kontrollen:** dagens `verified` og `user_confirmed = true` tolkes som brukerbekreftet, uten å endre data. Godkjenning i forslagskøen gir samme nivå. Generatorens krav endres fra «verified» til «brukerbekreftet», med uendret strenghet. Ingen gammel oppføring oppgraderes til «dokumentert» uten en faktisk godkjent kobling. Dagens `attestation` vises som før, med forklaring.
- **Datoer hver for seg:**
  - Hendelsesdato eller -periode fra dokumentet: `event_start`/`event_end` med presisjon (dag, måned eller år). KI foreslår den bare fra ordrett utdrag, og brukeren bekrefter eller retter.
  - Importdato: kildens mottakstid.
  - Godkjenningsdato: når forslaget ble godkjent.
  - Mangler hendelsesdato, vises «Registrert [importdato]», aldri som hendelsesdato. Et dokument som bare oppgir år, lagres med presisjon «år», uten oppdiktet dag og måned.
- **Dokumentasjonskobling:** en ny tabell `career_atom_sources` (fakta ↔ dokument, utdrag, hvem som godkjente, når, status). Gjelder både filer og låste tekstkilder.
  - «Dokumentert» med lenke vises likt under Resultater og Kvalifikasjoner.
  - Eksisterende `structured_data.dokumentasjon` leses som en godkjent kobling (lastet opp av brukeren selv), uten at noe annet oppgraderes.
- *Test:* ukjent dato, bare år, kryssbruker-test, sletting av kilden (koblingen vises som «kilde slettet» og faktaet beholdes), og ingen oppgradering av gamle oppføringer.

### Steg 4 — Inntakstyper som kan velges
- Brukeren kan velge: CV, kursbevis/sertifikat, rolleendring, lønnsendring og «annet» med egen beskrivelse, i tillegg til dagens fem.
  - **Kursbevis/sertifikat:** forslag om sertifisering eller kurs med utsteder, dato og gyldighet bare fra utdraget. Systemet foreslår samsvar med brukerens egne kvalifikasjoner (normalisert navn og utsteder). Brukeren velger «dokumenterer eksisterende», «ny» eller «ingen». Dette bruker godkjenningen fra steg 2 og koblingen fra steg 3.
  - **Rolleendring:** forslag om rolle med hendelsesdato fra utdraget.
  - **Lønnsendring:** beløpet blir bare i den private kilden. Et forslag sier bare at en lønnsendring er funnet, uten beløp, og ingen profiloppdatering.
- *Test:* nytt kursbevis, og kursbevis som dokumenterer en eksisterende sertifisering (riktig forslag, valg, dato, oppføring og «Dokumentert» med lenke), gjentatt import og samtidige godkjenninger.

### Steg 5 — Mottatt CV til CV-importen
- Etter brukerens valg kobles kilden til den eksisterende CV-importen (`cv_imports` med kildekobling). Unikhet og ny analyse avgjøres etter kartlegging. Ingen automatisk profilendring.
- *Test:* test-PDF-en uten ny e-post, dobbeltklikk gir ingen duplikat, og historikk ved ny analyse beholdes.

### Steg 6 — Felles henting av fakta (grunnlag for neste fase)
- En felles server-leser `getApprovedCareerFacts(userId, filter)` henter aktive, brukerbekreftede fakta med hendelsesdato og presisjon, registreringsdato, kilde og dokumentasjonsstatus. Den kan filtreres på rolle og periode, og fakta uten hendelsesdato leveres separat.
- Avviste, slettede og inaktive fakta og andre brukeres opplysninger følger aldri med.
- Generatorene (CV, søknadsbrev, kvartals-, års- og stillingsoppsummering) bygges ikke nå. Søknadsbrevets bruk av profilraden noteres til neste fase.
- *Test:* filtrering på rolle og periode, ukjent dato skilt ut, og utelukkelse av avviste, slettede og andre brukeres fakta.

### Steg 7 — Hele kjeden og dokumentasjon
- Kjede-test fra inntak til «Dokumentert» med syntetiske data, med opprydding etterpå.
- Dokumentere hvilke fakta som er klare til neste fase, og hvilken tekst som sendes til analyse.

## Åpne spørsmål
- Ingen. Valgene om bekreftelsesnivå og karriereoppsummering er avklart av deg.
