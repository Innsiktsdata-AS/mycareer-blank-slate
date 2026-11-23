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
