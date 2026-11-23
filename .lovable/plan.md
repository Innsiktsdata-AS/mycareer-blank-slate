# Søknadspakke – frontendplan v3 (Lovable)

Dette er bare en plan: ingen appkode, backend, database eller publisering. v1 og v2 ligger i git-historikken (v2 vurdert i 42d4aa3d) og er ikke kopiert inn her. Alle kontraktnavn er **foreslått Codex-kontrakt**, ikke eksisterende endepunkter.

## Arbeidsdeling og ferdig-nivåer
- **Codex:** backend, DTO-er, kontrollregler og kontraktstester.
- **Lovable:** UI og klienttester. Lovable endrer ingenting i backend eller Supabase uten et eget navngitt mandat.
- **UI-eksempel ferdig:** skjermene virker med typede eksempeldata etter foreslått DTO. Dette nivået er nok for en avgrenset skisseleveranse.
- **Integrasjon ferdig:** samme skjermer mot ekte Codex-kontrakt med en syntetisk bruker, og klienttester består. Bare dette nivået gjelder som ferdig produkt.

## Struktur
- **Fremdriftskort på `/applications/$id`:** de fem fasene vises kompakt med én fremhevet neste handling. Kortet lenker til `/applications/$id/pakke`.
- **Inngang fra muligheter, leads og `applications/new`:** serveren oppretter eller gjenbruker søknadsutkastet idempotent i `createOrResumePackage`. Søknaden får aldri status «sendt» automatisk, og det lages aldri to søknadsobjekter.
- **Generell CV og frittstående brev:** beholder sine formål.
- **Nettverk:** v1 bare lenker til eksisterende relevante nettverks- og søknadsobjekter. Pakken deler ikke, sender ikke og oppretter ikke kontakter.
- **Felles i hele pakken:** automatisk lagring, gjenopptak etter avbrudd, tastatur og fokus, og første versjon lages for mobil.

## Skjermer og godkjenninger
1. **Grunnlag (F0) – `saveIntake`**
   - Innhold: annonse (lenke, med tekst som reserve), kontakt fra profilen, LinkedIn med tre valg (adresse / har ikke / vil ikke), språk og bilde valgt for denne pakken. Bildefri variant har samme tekst.
   - Blokkerende konflikter i grunnlaget vises med årsak og må løses før generering. De telles ikke med i de fem spørsmålene.
   - Endres annonsen senere, lages en ny revisjon (se Versjoner).
2. **Treff og spørsmål (F1–F4)**
   - Stillings- og selskapskort med kildeutdrag. Selskapskortet merkes «Begrenset – uten websøk».
   - Tre atskilte lister:
     - *Dokumenterte treff*
     - *Uavklart erfaring* (standard når appen ikke vet noe)
     - *Reelle gap*: oppgitt av brukeren selv, eller et formelt obligatorisk krav (for eksempel gyldig løyve) uten belegg for at det er aktuelt. Overførbar erfaring kan aldri dekke et formelt krav.
   - Kortet «Dette vil vi fremheve – og hvorfor»: brukeren kan prioritere, rette, utelate og legge til. Hvert element viser egen kildetype og dokumentasjonsstyrke. Kontrollen av belegg og gyldighet kan ikke overstyres.
   - Spørsmål – `submitAnswers`: maks fem hovedspørsmål, uten skjulte underskjema. Hvert spørsmål forklarer hvorfor det stilles og hvilke deler av dokumentene svaret påvirker.
   - Endring av fakta – `confirmFactChanges`: nye kandidatfakta (resultater, erfaring, bidrag) vises konkretisert, uten forhåndsavkryssing. Brukeren har to valg:
     - «Bekreft og lagre i karriereprofilen»
     - «Utelat»
   - Ingen fakta lagres bare i pakken i første leveranse. Motivasjon, vinkling og preferanser lagres bare i pakken.
   - Kilde vises etter faktisk opphav: egenopplysning, kilde/dokument og dokumentasjonsstyrke holdes adskilt. Ingenting omdøpes.
3. **CV (F5–F7)**
   - Generering: `generateCv`.
   - Blokkredigering: `updateBlock`, med lås som felt i kommandoen. Dette er et kontraktbehov.
   - Kontroll av påstander: `reviewClaims`, med `CvClaimEvidencePanel` som utgangspunkt for visningen. Kontrollen kjøres også på låste blokker, og feil vises alltid.
   - Filer: `requestExport` gir DOCX med og uten bilde. PDF vises bare når serveren melder at den kan lage PDF. Appen lover ingen sideantall fra nettleseren.
   - **Godkjenning:** `approveDocumentVersion(versionId, revision, contentHash)`. Hvis teksten senere endres, oppheves godkjenningen og kontrollen kjøres på nytt.
4. **Vurdering (F8)**
   - Henting: `getAssessment`. Vurderingen må være gjennomført før CV-en kan eksporteres.
   - Det er ikke påkrevd å svare på intervjuspørsmålene.
   - Svar sendes med `applyAssessmentAnswers` og gir en ny versjon med forskjeller vist. Godkjenningen for de berørte delene oppheves.
   - Avslutning uten brev: `finishCvOnly`.
5. **Søknadsbrev (F9, valgfritt)**
   - Generering og redigering: `generateLetter` og `updateLetter`.
   - Ordteller: målet er 300–420 ord, 450 er lov, og over 450 sperres.
   - Belegg vises per påstand.
   - **Godkjenning:** `approveDocumentVersion`.

**Versjoner – `listVersions`**
- Viser revisjon, annonserevisjon, godkjenning og hash.
- Dokumenter fra en eldre annonse merkes «Knyttet til tidligere annonse». Den historiske godkjenningen gjelder den eksakte gamle versjonen og arves aldri av ny revisjon.
- Godkjente historiske filer kan fortsatt lastes ned, med tydelig versjonskontekst.

## Eksempel på fem hovedspørsmål (svarvalg etter type, ingen foreslåtte tall)
1. **Motivasjon (alltid med; har brukeren svart før, vises svaret med «Behold» eller «Endre»):** «Hvorfor vil du ha akkurat denne jobben hos [selskap]?»
   - *Svarvalg:* fritekst eller «Jeg er usikker – hjelp meg å utforske».
   - *Påvirker:* brevet, og bare vinklingen av CV-profilen. Personlige motiver skrives ikke inn som erfaringsfakta.
2. **Retning:** «Hva er viktigst for deg i neste rolle?»
   - *Svarvalg:* fritekst eller «Usikker».
   - *Påvirker:* vektlegging.
3. **Uregistrert erfaring:** «Annonsen ber om [krav X]. Har du erfaring med dette som ikke står i profilen? Beskriv et konkret eksempel.»
   - *Svarvalg:* fritekst eller «Har ikke erfaring».
   - *Påvirker:* treff og én CV-blokk.
   - Et konkret svar går videre til `confirmFactChanges`.
4. **Eget bidrag:** «I [rolle/prosjekt]: hva gjorde du selv, og hva ble resultatet?»
   - *Svarvalg:* fritekst, «Kan ikke tallfeste» eller «Anslag (skriv selv)».
   - *Påvirker:* resultatpunktene.
   - Svaret går videre til `confirmFactChanges`.
5. **Gyldighet (bare når opplysninger mangler eller sertifikatet er utløpt):** «[Sertifikat/løyve]: hvilken klasse, hvem har utstedt det, og er det gyldig nå?»
   - *Svarvalg:* klasse, utsteder og utløpsdato, eller «Ukjent» / «Utløpt».
   - *Påvirker:* kvalifikasjonsseksjonen og eventuelt et gap.

Et ubesvart nødvendig spørsmål gir statusen `requires_input`. Svaret «usikker» teller som besvart.

## Tilstander fra Codex (foreslåtte DTO-felt)
- `package`: id, applicationId, adRevision, phase, currentStep F0–F9, nextAction, savedAt, version
- `blockers[]`: code, reason, fixTarget
- `requirements[]`: weight, mandatory, sourceQuote, matchStatus (documented / unresolved / declared_gap / mandatory_unmet)
- `highlights[]`: kind, ref, rationale, sourceType, evidenceStrength, validity (class, issuer, expiry, status)
- `questions[]`: type, why, affects[], existingAnswer, answerOptions, required
- `factChanges[]`: proposedText, sourceType, status
- `versions[]`: kind, revision, adRevision, contentHash, blocks (locked, claimChecks[]), approval, diffFrom, files, staleReason
- `capabilities.pdf`, `assessment` (completed, findings, interviewQuestions), `errors[]` (code, userAction, retryable)

Alle kommandoene må være idempotente, sjekke eierskap og bruke versjon for å oppdage samtidige endringer.

**Kontraktbehov som ikke er avklart:**
- blokklås i `updateBlock`
- «utforsk motivasjon» som modus i `submitAnswers`
- prioritering av fremhevinger, for eksempel i `saveIntake` eller `submitAnswers`
- `approveDocumentVersion`

## Kontrollregler UI skal speile (eies av Codex)
- **Sertifikat:** CV-en blokkeres ikke av et utløpt historisk sertifikat. En påstand om *aktuell* autorisasjon uten belegg sperres, mens presis historisk omtale er lov. Krever stillingen gyldig løyve, vises et gap. Utløpt eller ukjent klasse eller gyldighet utløser spørsmål 5.
- **Motivasjon:** Svaret «usikker» gir hjelp og et ærlig, nøkternt brev. Oppdiktet interesse for selskap eller kultur sperres.

## Rekkefølge for Lovable
1. Pakkeskall og fremdriftskort.
2. Grunnlag.
3. Treff, fremheving og spørsmål med `confirmFactChanges`.
4. CV-redigering, kontroll og godkjenning.
5. Vurdering og `finishCvOnly`.
6. Brev.
7. Versjoner.
8. Lenker fra muligheter og leads.

Hvert steg leveres først som UI-eksempel og deretter som integrasjon med klienttester.

## Motkontroll av fire risikoer
- **Oppdiktet erfaring**
  - Tiltak: nye fakta må bekreftes aktivt og lagres i profilen, eller utelates. Appen foreslår aldri tall, og `reviewClaims` kontrollerer også låste blokker.
  - Klienttest: en påstand uten belegg sperrer godkjenning.
- **Uregistrert erfaring blir oversett**
  - Tiltak: «uavklart» er standard, spørsmål 3 og «Legg til» fanger opp det som mangler, og gap vises bare når det er oppgitt eller er et formelt krav.
  - Klienttest: et krav uten treff vises som uavklart.
- **Feil eller utløpt sertifikat**
  - Tiltak: kontrollen gjelder aktuell autorisasjon. Historisk omtale er lov, og et formelt krav vises som gap.
  - Klienttest: et utløpt sertifikat gir ingen påstand om aktuell autorisasjon, og CV-en kan fortsatt eksporteres.
- **Generisk motivasjon**
  - Tiltak: motivasjon er alltid med, og brukerens egne ord brukes som grunnlag. «Usikker» gir et ærlig, nøkternt brev. Oppdiktet selskapsinteresse sperres.
  - Klienttest: et ubesvart spørsmål gir `requires_input`, mens «usikker» gir et nøkternt brev uten oppdiktede påstander.

## Gjenstående
Ingen produktvalg står igjen for Henrik etter disse avklaringene. Kontraktbehovene over avklares mellom Codex og Lovable.
