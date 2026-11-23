# Søknadspakke – frontendplan v2 (Lovable)

Denne planen erstatter v1, som står som historikk nederst i `.lovable/plan.md`. Den er bare en plan: ingen kode, ingen database og ingen publisering. Alle kommandoer og tilstander under er **ønsket Codex-kontrakt**. Ingen av dem finnes i dag.

## Arbeidsdeling og ferdig-kriterium
- **Codex:** backend, DTO-er, kontrollregler og kontraktstester.
- **Lovable:** UI og klienttester. Lovable endrer ingenting i backend eller Supabase uten et eget navngitt mandat.
- **Ferdig-kriterium:** Et steg er bare ferdig når det kjører mot ekte Codex-kontrakt med en syntetisk bruker. At det virker med mock-data teller ikke.

## Struktur
- **Inngang:** På `/applications/$id` vises et fremdriftskort med fase, én neste handling og hva som mangler. Det lenker til `/applications/$id/pakke`.
- **Fra muligheter, leads og `applications/new`:** serveren oppretter eller gjenbruker søknadsutkastet før pakken åpnes (`ensureDraftApplication`). Søknaden får aldri status «sendt» automatisk.
- **Generell CV og frittstående brev:** `/cover-letters` beholder formålet sitt, og det samme gjør `/cv-builder`, som i dag bare er en plassholder.

Fem faser vises for brukeren. Øverst står én tydelig neste handling og lagringsstatus («Lagret 12:03» eller «Kunne ikke lagre – prøv igjen»). Brukeren kan avbryte og fortsette senere, alt kan brukes med tastatur og fokus, og første versjon lages for mobil.

## Sentrale skjermer og godkjenninger
1. **Grunnlag (F0)**
   - Innhold: annonse (lenke, med tekst som reserve), kontakt fra profilen, LinkedIn med tre valg (adresse / har ikke / vil ikke), språk og eget valg av bilde for denne pakken.
   - Blokkerende konflikter i grunnlaget vises her med årsak og må løses før generering.
2. **Treff og spørsmål (F1–F4)**
   - Kort for stilling og selskap med kildeutdrag. Selskapskortet merkes «Begrenset – uten websøk».
   - Tre atskilte lister:
     - *Dokumenterte treff*
     - *Uavklart erfaring* («Vi vet ikke om du har dette»)
     - *Reelle gap*, som bare vises når brukeren selv har oppgitt at erfaringen mangler.
   - Kortet «Dette vil vi fremheve – og hvorfor»: kompetanser, roller, resultater og kvalifikasjoner med kilde og oppdatert status. Brukeren kan prioritere, rette, utelate og legge til. Merket for belegg og gyldighet kan ikke overstyres.
   - Sparring: inntil fem spørsmål samlet. Hvert spørsmål forklarer hvorfor det stilles og hvilke deler av dokumentene svaret påvirker.
   - Bekreftelse av fakta: hvert nytt faktum vises konkretisert med tre valg:
     - «Bruk i denne søknaden»
     - «Lagre bekreftet fakta i karriereprofilen»
     - «Hold utenfor»
   - Det som lagres i profilen merkes «Egenopplysning» og kalles aldri dokumentasjon.
3. **CV (F5–F7)**
   - Blokkredigering bygd mot Codex-kommandoer. Hver blokk kan låses.
   - Kontrollen av påstander kjøres også på låste blokker, og feil i låst tekst vises alltid.
   - Belegg per påstand: `CvClaimEvidencePanel` brukes som utgangspunkt.
   - Kontrollresultater for fakta, ATS, språk og layout.
   - Filer: DOCX fra serveren, med og uten bilde og ellers samme tekst. PDF vises bare når serveren melder at den kan lage PDF. Appen lover ikke to sider ut fra noe beregnet i nettleseren.
   - **Godkjenning:** «Godkjenn denne CV-versjonen (vN)».
4. **Vurdering (F8, obligatorisk)**
   - Kritisk vurdering og 2–3 intervjuspørsmål.
   - Svarene kan gi en ny versjon. Da vises forskjellen mot forrige versjon, og godkjenningen for de berørte delene oppheves.
5. **Søknadsbrev (F9, valgfritt)**
   - Ett hovedspor og ordteller. Målet er 300–420 ord, 450 er lov, og over 450 sperres.
   - Belegg vises per påstand.
   - **Godkjenning:** «Godkjenn denne brevversjonen (vN)».

Versjoner ligger i en egen skuff i pakken og er også lenket fra fanen «Dokumenter» på søknaden.

## Eksempel på fem hovedspørsmål (ingen foreslåtte tall)
Alle spørsmål har fritekst og knappene «Har ikke erfaring», «Kan ikke tallfeste» og «Anslag (skriv selv)». Appen spør aldri om noe den allerede vet.
1. **Motivasjon (alltid med):** «Hvorfor vil du ha akkurat denne jobben hos [selskap]?»
   - Finnes et svar fra før, vises det med «Behold» eller «Endre».
   - Brukeren kan velge «Jeg er usikker – hjelp meg å utforske».
   - *Påvirker:* innledningen i brevet og profilteksten i CV-en.
2. **Retning:** «Hva er viktigst for deg i neste rolle, og passer denne stillingen med det?»
   - *Påvirker:* vektlegging og avslutningen i brevet.
3. **Uregistrert erfaring:** «Annonsen ber om [krav X]. Har du erfaring med dette som ikke står i profilen din? Beskriv et konkret eksempel.»
   - *Påvirker:* treff og uavklart erfaring, og én CV-blokk.
4. **Eget bidrag:** «I [rolle/prosjekt]: hva gjorde du selv, og hva ble resultatet?»
   - *Påvirker:* resultatpunktene i CV-en.
5. **Gyldighet:** «[Sertifikat/løyve]: hvilken klasse, hvem har utstedt det, og når utløper det?»
   - Dette spørsmålet stilles bare når opplysningene mangler.
   - *Påvirker:* kvalifikasjonsseksjonen.

Blokkerende konflikter kommer i tillegg til disse spørsmålene, med forklart årsak. De presses ikke inn for å holde seg innenfor fem.

## Tilstander og kommandoer fra Codex (ønsket kontrakt)
**Tilstander**
- `package`: id, applicationId, phase, currentStep (F0–F9), nextAction, savedAt, version
- `blockers[]`: code, reason, fixTarget
- `requirements[]`: weight, sourceQuote, matchStatus (documented / unresolved / user_declared_gap)
- `highlights[]`: kind, ref, rationale, sourceStatus, validity (class, issuer, expiry, status)
- `questions[]`: why, affects[], existingAnswer, answerOptions
- `factCandidates[]`: text, scope (package / profile / excluded), attestation
- `cvVersions[]` og `letterVersions[]`, hver med: blocks (locked, checkResults[]), approvalStatus, diffFrom, files (docx, docxNoPhoto, pdf?)
- `capabilities`: pdf (true/false)
- `assessment`: findings, interviewQuestions
- `errors`: code, userAction, retryable

**Kommandoer**
- Pakke: `ensureDraftApplication`, `startOrResumePackage`, `saveBasis`
- Spørsmål og fakta: `answerQuestion`, `exploreMotivation`, `setFactScope`, `confirmFactToProfile`
- Fremheving: `setHighlightPriority`, `generateCv`
- CV-blokker: `editBlock`, `lockBlock`, `unlockBlock`
- Kontroll og vurdering: `runChecks`, `requestAssessment`, `answerAssessment`
- Godkjenning: `approveVersion(versionId)`
- Brev og filer: `generateLetter`, `exportDocx`

Alle kommandoer må være idempotente, sjekke eierskap og returnere en versjon som brukes til å oppdage samtidige endringer.

## Rekkefølge for Lovable
1. Pakkeskall og fremdriftskort med lagring og gjenopptak, mot `startOrResumePackage`.
2. Grunnlag med blokkerende konflikter.
3. Treff, fremheving og spørsmål med bekreftelse av fakta.
4. CV-redigering, kontroller, versjoner og godkjenning.
5. Vurdering.
6. Brev.
7. Innganger fra muligheter og leads.
8. Klienttester per steg mot ekte kontrakt.

## Motkontroll av fire risikoer
- **Oppdiktet erfaring**
  - UI-tiltak: dokumentene viser bare påstander med belegg eller bekreftet egenopplysning. Appen foreslår aldri tall, og utkast merkes som KI-generert.
  - Krav til Codex: kontrollen avviser påstander uten belegg, også i låst tekst.
  - Klienttest: en påstand uten belegg i en låst blokk viser feil, og godkjenning er sperret.
- **Uregistrert erfaring blir oversett**
  - UI-tiltak: «Uavklart» er en egen liste, aldri «gap». Spørsmål 3 og «Legg til» på fremhevingskortet fanger opp det som mangler i profilen.
  - Krav til Codex: `matchStatus=unresolved` brukes som standard, og `user_declared_gap` settes bare når brukeren selv har oppgitt det.
  - Klienttest: et krav uten treff vises som uavklart, aldri som gap.
- **Feil eller utløpt sertifikat**
  - UI-tiltak: klasse, utsteder og utløp vises med varsel om at sertifikatet er utløpt. Appen påstår aldri fornyelse uten belegg.
  - Krav til Codex: `validity.status` beregnes på serveren, og kontrollen stopper utløpte sertifikater.
  - Klienttest: et utløpt sertifikat sperrer godkjenning til det er rettet eller utelatt.
- **Generisk motivasjon**
  - UI-tiltak: motivasjon er alltid med. Utkastet viser brukerens egne ord som kilde, og appen finner ikke på interesse for kultur eller selskap.
  - Krav til Codex: motivasjonen genereres bare fra brukerens svar og kildeutdrag. Ved for lite grunnlag returneres «begrenset».
  - Klienttest: når motivasjon mangler, sperres generering av brevet, og «Utforsk» gir et ærlig begrenset resultat.

## Gjenstående produktvalg (Henrik)
1. Kan CV-en godkjennes og lastes ned når vurderingen (F8) er gjennomført, men brukeren har valgt å ikke svare på intervjuspørsmålene? Eller må svarene inn først?
2. Skal fremdriftskortet på søknaden vise de fem fasene eller bare neste handling?
3. Skal «Lagre bekreftet fakta i karriereprofilen» være forhåndsvalgt for nye resultater, eller skal brukeren alltid velge aktivt? Forslag: alltid aktivt valg.
4. Hva skal skje med godkjente versjoner når annonsen endres? Skal de bli merket utdatert eller låses?
5. Skal pakken kunne deles som en kontakt i nettverksarbeidet (kobling til nettverk), eller er det en senere fase?


---

# Historikk: v1

# Søknadspakke – frontendvurdering mot 731463d (kun analyse)

Ingen endringer er gjort. Alt under «kontrakt» er ønsket Codex-backend, ikke eksisterende endepunkter.

## 1) Gjenbruk per inngang
- `src/routes/_authenticated/applications/new.tsx` – har allerede to steg (`import` → `form`, linje 49–123) med annonseuttrekk og `register_lead`. Gjenbruk som F0-inngang: annonsetekst/lenke med fallback til tekst. Avslutt med «Start søknadspakke» i stedet for bare å lagre.
- `src/routes/_authenticated/applications/$id.tsx` – 7 faner (linje 168–174). `DokumenterTab` (580–612) lister bare dokumenter. Legg til en egen fane «Søknadspakke» som første fane (eller kort i `OversiktTab`), og bruk `ImportJobAdModal` (316) for annonse.
- `src/routes/_authenticated/nettverk.muligheter.$id.tsx` (309–314) og `job-leads.tsx` (1214) – lenker i dag til `/cover-letters?application=` og `/cv-builder` hver for seg. Begge bør peke til én pakkerute.
- `src/routes/_authenticated/cover-letters.tsx` (1152 linjer) – fungerende brevflyt via edge function `generate-cover-letter` (525), med språkvalg og redigering. Ta ut redigering og forhåndsvisning som komponenter til F9. Behold ruten som inngang for dem som bare vil lage brev.
- `src/components/cv/CvClaimEvidencePanel.tsx` – ferdig belegg-panel (props `documentId`, rewrite/add/remove), men **ikke brukt noe sted**. Gjenbruk i F5/F6 som «Hva hver påstand bygger på».
- `src/routes/_authenticated/soknadsdokumenter.tsx` – navigasjonsside. Kan bli pakkeoversikten.
- `src/lib/cover-letter-job-store.ts`, `src/lib/career-facts/approved-facts.ts` (`getApprovedCareerFacts`) – faktagrunnlag og jobbkontekst. Lovable skal bare lese resultatet via kontrakt.

## 2) Lovable-oppgaver i rekkefølge
1. Pakkeskall: rute `/applications/$id/pakke` med 5 faser, en fremdriftslinje, lagringsstatus, avbryt/fortsett. Lages med mock-kontrakt mens backend bygges.
2. Grunnlag (F0): annonse, kontakt fra profilen, LinkedIn med tre valg (adresse / har ikke / vil ikke), valgfritt bilde, språk. Vis hva som mangler.
3. Treff og spørsmål (F1–F4): korte kort for stilling og selskap med kildeutdrag og merket «Begrenset – uten websøk». Treff og uavklarte krav vises i klartekst. Spørsmålsskjema: maks 5 spørsmål, alltid fritekst, «kan ikke tallfeste» og «anslag», ingen foreslåtte tall.
4. CV (F5–F7): blokkvisning med lås for blokker brukeren har redigert, `CvClaimEvidencePanel`, kontrollresultater, nedlasting av DOCX med og uten bilde. PDF er skjult til renderingsløpet er avklart.
5. Vurdering (F8): kritisk vurdering, 2–3 intervjuspørsmål og knapp for ny versjon.
6. Søknadsbrev (F9): ett hovedspor, ordteller (mål 300–420, sperre ved 450) og belegg per påstand.
7. Versjonsliste og innganger fra nettverk/muligheter og leads.

Kontraktbehov fra Codex (typer og navn må avtales): opprett/hent pakke med fase- og stegstatus; F1/F2-resultat med kilder; liste over treff og uavklarte krav; spørsmål og svar, der faktasvar går gjennom Codex' skrivevei og motivasjon er pakkekontekst; CV-blokker og låser; resultat fra kontrollene; filer; versjoner; feilkoder brukeren kan rette.

## 3) Stubber og manglende flyt
- Bare `ComingSoonStub`: `cv-builder/index.tsx`, `interview-prep/index.tsx`, `offer-analysis/index.tsx`.
- Ingen samlet flyt: `soknadsdokumenter.tsx` er bare lenker. `cover-letters.tsx` står alene uten spørsmål eller vurdering. `CvClaimEvidencePanel` er ikke koblet inn. Søknadsdetaljen har ingen pakkestatus.

## 4) Plassering
- Oversikt: en «Søknadspakke»-fane eller kort på søknadsdetaljen, med fase, neste handling og hva som mangler.
- Spørsmål: samlet i fase 2, aldri spredt over fasene.
- Godkjenning: der den aktuelle artefakten vises (CV-blokk, brev), med eksplisitt knapp.
- Versjoner: egen skuff eller fane i pakken, også lenket fra `DokumenterTab`.
- Hva som mangler: øverst i hver fase som en kort liste, med lenke til der det rettes (profil, dokumentasjon, spørsmål).

## 5) Avklaringer før bygging
1. Er pakken egen rute eller fane i søknadsdetaljen? Og hva skjer med `/cover-letters` og `/cv-builder` som frittstående sider?
2. Skal svar på spørsmål om fakta bli profilfakta med en gang, eller først etter en egen godkjenning (evidensprinsippet)? Hvor ser brukeren forskjellen fra motivasjon?
3. Brukerlåste CV-blokker og «ny versjon» etter vurdering: overstyrer ny versjon låste blokker, og hvordan vises forskjeller?
4. Bilde: lagres det i profilen eller per pakke, og er bildefri DOCX standard?
5. Må en søknad finnes før pakken starter? Fra nettverk/muligheter finnes kanskje bare et lead.

## Kildefiler
src/routes/_authenticated/applications/{new,$id,index}.tsx, cover-letters.tsx, soknadsdokumenter.tsx, cv-builder/index.tsx, interview-prep/index.tsx, offer-analysis/index.tsx, nettverk.muligheter.$id.tsx, job-leads.tsx, my-applications.tsx; src/components/cv/CvClaimEvidencePanel.tsx, src/components/coming-soon-stub.tsx; src/lib/cover-letter-job-store.ts, src/lib/career-facts/approved-facts.ts, src/lib/cv-claim-evidence.functions.ts, src/lib/cv-skills-contract.ts.
