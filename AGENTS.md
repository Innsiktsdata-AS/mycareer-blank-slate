# AGENTS.md

- Inbound e-post: rutingen bestemmes kun av aliasens `email_job_sources.intake_mode` (`forwarding` → jobb-lead, `career_material` → karrierearkiv), aldri av avsender eller innhold — så jobbvarsler og karrieremateriale aldri blandes.
- Karrieremateriale: originalen lagres først og låses i `documents`; analyse og forslag skrives bare via service-only `career_material_*`-RPC-er under lease — så alt er sporbart og retry-sikkert.
- KI-forslag fra innsendt tekst må ha et ordrett utdrag fra originalen, og tall beholdes bare når de står i utdraget — så ingenting oppdiktet kan nå profilen.
- Kompetanse-atomer fra karrieremateriale peker alltid på et godkjent resultat-atom (`applied_atom_id` → `evidence_atom_ids`); stillingsinstrukser og attester gir aldri kompetanse-atomer — evidensprinsippet.
- Karrieremateriale fra e-post behandles av bakgrunnsarbeideren (`/api/public/jobs/career-material`, planlagt jobb) med databaselås, claim/lease og pause — aldri ved sidevisning — så behandling er pålitelig og kostnadsbegrenset.
- Vedlegg valideres på filsignatur og leses uten OCR; hvert lesbart vedlegg blir en egen låst kilde med originalfil i privat lagring under brukerens mappe — så kilde- og vedleggssporing bevares.
