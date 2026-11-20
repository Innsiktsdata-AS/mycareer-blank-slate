# AGENTS.md

- Inbound e-post: rutingen bestemmes kun av aliasens `email_job_sources.intake_mode` (`forwarding` → jobb-lead, `career_material` → karrierearkiv), aldri av avsender eller innhold — så jobbvarsler og karrieremateriale aldri blandes.
- Karrieremateriale: originalen lagres først og låses i `documents`; analyse og forslag skrives bare via service-only `career_material_*`-RPC-er under lease — så alt er sporbart og retry-sikkert.
- KI-forslag fra innsendt tekst må ha et ordrett utdrag fra originalen, og tall beholdes bare når de står i utdraget — så ingenting oppdiktet kan nå profilen.
- Kompetanse-atomer fra karrieremateriale peker alltid på et godkjent resultat-atom (`applied_atom_id` → `evidence_atom_ids`); stillingsinstrukser og attester gir aldri kompetanse-atomer — evidensprinsippet.
- Karrieremateriale fra e-post behandles av bakgrunnsarbeideren (`/api/public/jobs/career-material`, planlagt jobb) med databaselås, claim/lease og pause — aldri ved sidevisning — så behandling er pålitelig og kostnadsbegrenset.
- Vedlegg valideres på filsignatur og leses uten OCR; hvert lesbart vedlegg blir en egen låst kilde med originalfil i privat lagring under brukerens mappe — så kilde- og vedleggssporing bevares.
- Valgfrie RPC-parametre uten standardverdi i databasen sendes som eksplisitt `null`, aldri `undefined` — et utelatt felt gir PGRST202 (funksjonen finnes ikke).
- Godkjenning av forslag fra karrieremateriale går kun gjennom service-only `career_material_approve_proposal` (låst rad, idempotent) og lagrer kildekobling i `career_atom_sources` — så dobbeltklikk aldri gir duplikater og godkjenningen overlever sletting av kilden.
- Hendelsesdato (`event_start/end/precision`) settes bare fra brukerbekreftet eller ordrett sitert dato, aldri fra import- eller godkjenningstid; ved kobling av kilde til eksisterende oppføring erstatter en bekreftet kildedato den gamle (tomt felt = uendret) og gammel dato lagres i forslagets `diff.previous_event` — så ingen dato diktes opp og endringen kan spores.
- Generatorer skal hente fakta via `getApprovedCareerFacts` (felles regel for brukerbekreftet), ikke egne spørringer — så alle bruker samme grunnlag.
- Nye `documents` blir sin egen dokumentgruppe via databaseregel med mindre en gruppe som tilhører samme bruker oppgis, og kvalifikasjonsopplastinger (`source_context='credential_upload'`) får `career_atom_sources`-kobling via databaseregel — så klientinnsetting aldri feiler på gruppekravet og felles faktaleser ser alle opplastinger.
