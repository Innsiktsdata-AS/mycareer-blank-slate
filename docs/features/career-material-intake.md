# Inntak av karrieremateriale (P1.1–P1.4)

Status: implementert i forhåndsvisning, ikke publisert. E-postmottak krever konfigurasjon (se nederst).

## Flyt

1. **Original først.** Innlimt tekst (/kilder → «Karrieremateriale») eller videresendt e-post lagres
   atomisk som privat dokument i `public.documents` (kategori «Karrieremateriale», `visibility=private`,
   `confidentiality_level=confidential`) sammen med en rad i `public.career_material_intakes`
   (RPC `career_material_create`). Dokumentet vises i arkivet (/documentation/library).
   Originalen er låst av triggeren `career_material_original_guard` (både i UI og database).
2. **Klassifisering.** Serverfunksjonen `processCareerMaterial` tar en lease (`career_material_claim`),
   kontrollerer at dokumentets SHA-256 fortsatt matcher, og kaller KI-profilen
   `career_material_intake` (ai.model_profiles). Typer: stillingsinstruks, prosjektnotat,
   medarbeidersamtale, attest, prestasjon, ukjent. Brukerens valg vinner alltid; KI-typen brukes bare
   ved sikkerhet ≥ 0,6. Ellers får inntaket status `needs_type` og brukeren velger type.
3. **Atomisering.** Hvert funn må ha et ordrett utdrag som finnes i originalen, ellers forkastes det.
   Tall i formuleringer og måltall beholdes bare når de står i utdraget. Typepolicy:
   - eget materiale (prestasjon, prosjektnotat, medarbeidersamtale): resultat → `create_atom`
     (achievement); kompetanse med støttende resultat → `create_atom` (skill) som peker på
     resultatforslaget; kompetanse uten resultat → `suggest_evidence` (endrer ikke profilen).
   - attest: resultater → `create_atom` merket `basis=tredjepartsutsagn`; kompetanser → bare hint.
   - stillingsinstruks: alt blir `suggest_evidence`. Rollekrav er ikke bevis på levert innsats.
4. **Godkjenning.** Forslagene legges i eksisterende AI-kø (/forslag/ai) med tekstutdrag og lenke til
   originalen. Nye profiloppføringer kan redigeres før godkjenning. En kompetanse kan bare godkjennes
   etter at resultatet den bygger på er godkjent (`applied_atom_id` → `evidence_atom_ids`).
   Ingenting skrives til `career_atoms` uten godkjenning.
5. **Lagring av analyse** (`career_material_store_analysis`) skjer atomisk under leasen: batch,
   forslag, erstatning (`superseded`) av ventende forslag som ikke lenger foreslås, og ferdigstatus.

## Idempotens

- Samme tekst for samme bruker gir samme inntak (unik `user_id, content_sha256`).
- Samme e-post (webhook-retry) gir samme inntak (unik `inbound_delivery_id`, og leveransens claim).
- Forslag dedupliseres på `(user_id, source_record_id, source_hash)` for aktive/avgjorte statuser.
  Avviste forslag foreslås ikke på nytt. Ny analyse gjenbruker eksisterende forslag.

## E-postruting

Rutingen bestemmes kun av hvilken alias som mottok e-posten — aldri av avsender eller innhold:

| `email_job_sources.intake_mode` | Resultat |
| --- | --- |
| `forwarding` | Jobbvarsel → jobb-lead (uendret) |
| `career_material` | Karrieremateriale → privat arkiv + analyse; aldri jobb-lead |

Begge aliasene ligger på samme domene og samme webhook (`/api/public/inbound/job-email`), med
samme Svix-verifisering, alias-eierskap, rate limits og claim/finalize. Brukeren oppretter
karriereadressen selv på /kilder. Adressen vises bare når mottaket er konfigurert.

### Bakgrunnsbehandling

E-post og vedlegg behandles av en serverstyrt arbeider — brukeren trenger ikke åpne /kilder.

- Rute: `POST /api/public/jobs/career-material`, kalt av planlagt jobb `career-material-worker-1min`
  (hvert minutt). Autentiseres med den administrerte cron-hemmeligheten (`authenticateCronRequest`);
  GET gir 405, manglende/feil nøkkel gir 401.
- Single-flight: én lås i `career_material_worker_state` (lease 150 s). Samtidige kjøringer avslutter straks.
- Per kjøring: opprydding av filer for slettede kilder, høyst 3 vedlegg og 3 analyser, tidsbudsjett 40 s.
- Varig kø: vedlegg i `career_material_attachments`, analyser i `career_material_intakes`. Claim med
  token/lease; krasj gir utløpt lease som plukkes opp igjen. Eksponentiell ventetid (1, 2, 4 … maks 60 min),
  høyst 6 automatiske forsøk. Ferdige elementer behandles aldri på nytt.
- Kretsbryter: konfigurasjonsfeil eller 401/402/403 fra analysetjenesten setter varig pause
  (`paused_reason`). Under pause prøves høyst ett inntak per kjøring; første suksess opphever pausen.
  429 stopper kjøringen; resten venter til neste minutt. Pausen vises for administratorer på /kilder.
- Innlimt tekst analyseres fortsatt straks brukeren lagrer (brukerhandling).

### Vedlegg

- Støttet: PDF med tekstlag og Word (.docx), maks 10 MB, 60 sider, 5 vedlegg per e-post.
- Webhooken registrerer alle vedlegg (også ikke-støttede, for store og over grensen) med endelig status.
  Støttede legges i kø. E-post med bare vedlegg tas imot; uten tekst og uten støttede vedlegg avvises
  den med `no_supported_content`.
- Arbeideren henter fersk `download_url` via `GET /emails/receiving/:email_id/attachments/:id`
  (fast API-origin, server-only nøkkel), laster ned bare fra `https://*.resend.com`, følger ikke
  omdirigeringer og stopper ved størrelsesgrensen.
- Filtypen avgjøres av filsignatur (`%PDF-` / ZIP med `word/document.xml`), ikke filnavn. Zip-bomb-vern:
  `document.xml` over 15 MB pakkes ikke ut.
- Hvert lesbart vedlegg blir en egen låst kilde (`source_context = career_material_attachment`) med
  originalfilen i privat lagring `career-material/<bruker-id>/<vedlegg-id>.<pdf|docx>`, og analyseres
  som annet karrieremateriale.
- **Ingen OCR.** PDF uten tekstlag (typisk skannet) får status «Fant ingen tekst»; passordbeskyttet
  PDF får «Passordbeskyttet». Originalen lagres slik at brukeren kan laste den ned, men lager ingen kilde.
- Samme tekst som en eksisterende kilde gir status «Samme tekst finnes fra før»; den ekstra filen fjernes.

### Typeendring etter godkjenning

Godkjente elementer fra kilden beholdes og vises på kilden. Ny analyse foreslår ikke på nytt det som
allerede er godkjent (resultater med overlappende utdrag, kompetanser med samme navn); kompetanser som
bygde på et slikt resultat kobles til det godkjente resultatet. Brukeren får en bekreftelse som sier
hvor mange som beholdes og hvor mange ventende forslag som erstattes.

### Sletting

- «Slett» på kilden: original, inntak, alle forslag fra kilden og originalfil slettes. Godkjente
  elementer beholdes som standard; brukeren kan krysse av for å fjerne dem (de arkiveres via
  `career_atom_delete`, som ved vanlig sletting av profilelementer).
- Sletting av dokumentet utenom appen (direkte via databasen) fjerner også forslagene (trigger), og
  filen ryddes av arbeideren.
- Vedlegg uten kilde (ulesbart/skannet/ikke støttet) kan fjernes fra listen, med fil.

## Sikkerhet

- RLS: brukeren kan bare lese egne inntak og vedlegg. Ingen insert/update/delete fra klient
  (rettighetene er trukket tilbake). Lagring: brukeren kan bare lese filer i egen mappe.
- Alle `career_material_*`-funksjoner er SECURITY INVOKER og kan bare kjøres av service_role.
- Serverfunksjonene sjekker eierskap med brukerens egen klient før adminklienten brukes.
- Tekst og e-postinnhold logges aldri; bare feilkoder.
- Dokumentteksten sendes til modellen som avgrenset data; systemprompten forbyr å følge
  instruksjoner i teksten, og avgrensningen kan ikke lukkes fra innholdet.

## Konfigurasjon

- KI: profil `career_material_intake_v1` (ai.model_profiles) og eksisterende servernøkkel.
- E-post: `INBOUND_EMAIL_DOMAIN`, `RESEND_WEBHOOK_SECRET`, `RESEND_API_KEY` + DNS/MX og Resend-webhook
  (se `docs/operations/inbound-email-domain-setup.md`). Ingen ny konfigurasjon for karriereadressen.
- Vedlegg krever `RESEND_API_KEY` (samme nøkkel). Uten den venter vedleggene i kø med feilkode
  `resend_not_configured` og prøves igjen.
- Bakgrunnsjobben kaller publisert app; den virker først etter publisering.

## Verifisert / ikke verifisert

Se roadmap.md og leveranserapporten for hva som er testet ende til ende.
