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

## Prioritert reparasjonsplan
Hvert steg krever din godkjenning før det bygges, og tester før det publiseres. KI leser aldri filer automatisk. Bare kilden brukeren selv har valgt analyseres, innenfor faste tegngrenser.

1. **Publiser fase 1 og 2a etter din test.** *Godkjenningspunkt:* du tester /kilder i forhåndsvisningen.
2. **Trygg godkjenning (atomisk):** flytt godkjenningen til ett server-RPC som lager elementet og merker forslaget i samme transaksjon, med eierskapskontroll. *Test:* feil midt i gir ingen halve tilstander, og to samtidige godkjenninger gir ett element.
3. **Hvordan godkjente funn fra kilder blir med i CV-en:** bestem regelen for når et brukergodkjent element fra en kilde kan brukes, for eksempel en egen bekreftelse i CV-gjennomgangen. Godkjenningen skal ikke automatisk regnes som `verified`. *Godkjenningspunkt:* du velger regelen, så skrives tester for hva som tas med i CV-en.
4. **Hendelsesdato:** KI kan foreslå en dato bare når den står ordrett i utdraget. Brukeren bekrefter eller retter den, og den lagres i `valid_from`/`valid_to`. Importdato og godkjenningsdato holdes adskilt og vises med navn. *Test:* ingen dato uten utdrag, og norske datoformater.
5. **Én definisjon av «dokumentert»:** et element er dokumentert når en låst kildefil er koblet til det og brukeren har godkjent koblingen. Resultater og Kvalifikasjoner skal vise det samme, og `attestation` skal fortsatt settes av databasen etter denne regelen. Rett også filteret og kommentaren om «bekreftede» elementer. *Test:* kryssbruker-test og at sidene stemmer med hverandre.
6. **Kursbevis og sertifikat (fase 3):** egen type som foreslår en `certification`/`course` med utsteder, dato og gyldighet bare fra utdraget. KI foreslår samsvar med eksisterende kvalifikasjoner hos samme bruker (navn og utsteder). Brukeren velger «dokumenterer eksisterende», «ny» eller «ingen». *Test:* ingen automatisk kobling, og ingen oppdiktet gyldighet.
7. **CV til CV-importen (fase 3):** brukeren bekrefter og kobler kilden til `cv_imports`. Unikhet avgjøres først etter at CV-flyten er kartlagt.
8. **Søknadsbrev:** serveren henter selv godkjente profilelementer (samme regel som i steg 3) i stedet for at nettleseren sender hele profilen. Klare grenser for hva som tas med, ingen kildetekst, og en budsjettert kontekst. *Test:* profil fra nettleseren ignoreres, og grensene håndheves.
9. **Testdekning:** fyll hullene i seksjon 7 som del av hvert steg.

## Åpne spørsmål
- Godkjente funn fra kilder i CV-en (steg 3): skal de kreve en egen bekreftelse i CV-gjennomgangen, eller holder godkjenningen i forslagskøen?
- «Karriereoppsummering»: holder CV-ens oppsummeringsdel, eller ønskes en egen funksjon?
