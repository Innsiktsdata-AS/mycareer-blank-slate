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

E-postinntak analyseres når brukeren åpner /kilder (inntak med status `queued` startes ett om gangen).
Det finnes ingen bakgrunnsjobb ennå.

### Vedlegg

Vedleggsinnhold lastes **ikke** ned. Resend tilbyr et eget vedlegg-API, men det er ikke koblet på.
Vedlegg registreres med filnavn, type og størrelse med status «ikke behandlet», og vises på /kilder.
E-post med bare vedlegg (under 40 tegn tekst) avvises med `text_too_short` og vises som
«E-poster som ikke ble tatt imot».

## Sikkerhet

- RLS: brukeren kan bare lese egne inntak. Ingen insert/update/delete fra klient.
- Alle `career_material_*`-funksjoner er SECURITY INVOKER og kan bare kjøres av service_role.
- Serverfunksjonene sjekker eierskap med brukerens egen klient før adminklienten brukes.
- Tekst og e-postinnhold logges aldri; bare feilkoder.
- Dokumentteksten sendes til modellen som avgrenset data; systemprompten forbyr å følge
  instruksjoner i teksten, og avgrensningen kan ikke lukkes fra innholdet.

## Konfigurasjon

- KI: profil `career_material_intake_v1` (ai.model_profiles) og eksisterende servernøkkel.
- E-post: `INBOUND_EMAIL_DOMAIN`, `RESEND_WEBHOOK_SECRET`, `RESEND_API_KEY` + DNS/MX og Resend-webhook
  (se `docs/operations/inbound-email-domain-setup.md`). Ingen ny konfigurasjon for karriereadressen.

## Verifisert / ikke verifisert

Se roadmap.md og leveranserapporten for hva som er testet ende til ende.
