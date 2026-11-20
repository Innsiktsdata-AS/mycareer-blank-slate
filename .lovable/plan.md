# Test- og leveranserapport: karrieremateriale og dokumentasjon

Status 20.11.2026. Ingenting er publisert. Ingen ekte brukerdata er endret eller slettet. Teststatus vises slik: **Testet** (kjørt med syntetiske data), **Kode** (bare vurdert ut fra koden) og **Usikkert**.

## 1. Kontroll av dagens produksjon mot migrasjon 0005–0008

| Kontroll | Resultat | Grunnlag |
|---|---|---|
| Halve eller doble godkjenninger | Ingen funnet | Testet (lesing av struktur, ikke innhold) |
| To like rolletitler | Kommer fra LinkedIn-importen, ikke fra godkjenning | Testet (lesing) |
| Publisert godkjenning av vanlige forslag | Virker mot den nye databasen | Testet |
| Publisert godkjenning av kildeforslag | Virker, men lager verken kildekobling eller hendelsesdato | Testet. Ingen slike forslag finnes i produksjon (0). |
| Andre importløp (LinkedIn, CV-import) | Ikke berørt. Det nye feltet for kildedokument kan stå tomt. | Kode |
| Nåtall i produksjon | 2 inntak, 0 forslag, 0 kildekoblinger, 0 manuelle kvalifikasjonsfiler, 0 CV-er sendt fra arkivet | Testet (lesing) |

**Konsekvens av de aktive migrasjonene:** De er additive. Dagens publiserte app virker som før. Hva som ikke skjer før publisering, er beskrevet i R1 under.

## 2. Tester av versjonen som skal publiseres

Testet versjon: commit `cfcae9e7` med migrasjon 0005–0008. Alle 654 automatiske tester passerer.

| Test | Resultat |
|---|---|
| Kryssbruker A/B: B prøver å lese, endre, godkjenne, sende og slette A sine fakta og kildekoblinger | Testet, ok. B får tomt svar eller avslag. |
| Syntetisk kursbevis, ny sertifisering (ITIL, år 2022) | Testet, ok. Én oppføring med årspresisjon. |
| Syntetisk kursbevis som dokumentasjon på eksisterende sertifisering (PRINCE2) | Testet, ok. Kildekobling og ingen ny oppføring. |
| Hele kjeden: import, forslag, valg, godkjenning, dato, «Dokumentert»-lenke og felles leser med periodefilter | Testet, ok |
| Dobbeltklikk og samtidig godkjenning | Testet, ok. Én oppføring. |
| Avbrudd eller feil underveis i godkjenningen | Kode. Alt skjer i én databasefunksjon, så en feil ruller tilbake alt. Nytt forsøk etter at svaret har gått tapt, gir samme resultat (testet). |
| Slettet kilde, faktum beholdt | Testet, ok. Viser «Kilde utilgjengelig». |
| Slettet kilde, faktum fjernet | Testet, ok. Oppføringen deaktiveres. |
| Rolleendring | Testet, ok. Ny rolle, eller kobling til eksisterende rolle når tittel og arbeidsgiver er like. |
| Hendelses-, import- og godkjenningsdato hver for seg, med dag, bare år og ukjent dato | Testet, ok |
| Opprydding | Testdata slettet. Én syntetisk PDF på 1,7 KB ligger igjen i testbrukerens mappe, se R3. |

## 3. CV fra arkivet til CV-importen

Etter ditt svar er dette testet med en **syntetisk CV** på testbrukeren. Din ventende PDF i produksjon er ikke rørt, og typen «Kursbevis» er ikke valgt.

| Test | Resultat |
|---|---|
| Gjenkjennes som CV, gir ingen sertifisering | Testet, ok |
| Sendt til CV-importen uten ny e-post | Testet, ok. Én importrad. |
| Dobbeltklikk, gjentatt og samtidig sending | Testet, ok. Samme import blir returnert. |
| Ingen automatisk profilendring | Testet, ok. Profilen endres først når du går gjennom CV-en. |
| Ny analyse etter feil, historikk beholdt | Kode. En feilet import kan sendes på nytt. Gamle rader beholdes. |
| Avbrudd midt i sendingen | Kode. Ingen duplikat. Det kan bli liggende en ubrukt filkopi, se R4. |

## 4. Eksisterende dokumentkoblinger

- **Kopiert, ikke flyttet:** Migrasjon 0005 kopierte koblingen fra gamle kvalifikasjonsfiler til `career_atom_sources`. Filen, dokumentraden og listen på oppføringen ble ikke rørt. Produksjon hadde 0 slike filer, så ingen ekte rader ble kopiert.
- **Dokumentasjonssider:** Kvalifikasjoner viser fortsatt antall dokumenter fra oppføringen selv. Testet syntetisk, ok.
- **Sletting og utilgjengelig fil:** Sletter du en fil, får koblingen statusen «Kilde utilgjengelig», og faktaet beholdes. En annen opplastet fil teller fortsatt som dokumentasjon.
- **Tilbakeføring:** En slettet kilde kan ikke gjenopprettes. Den må sendes inn på nytt.
- **Betydning:** Før stod det «N dokumenter» eller «Ikke dokumentert». Nå står det «Dokumentert», definert som at det finnes en låst kilde du selv har koblet til. Det betyr ikke at noen andre har kontrollert opplysningen. Koblingen endrer ikke `confidence` eller `attestation`, og den påvirker ikke hva CV-generatoren tar med.

## 5. Generatorene (neste fase, ikke bygget)

For at CV, søknadsbrev og oppsummeringer senere skal kunne bruke den felles leseren, gjenstår dette:

- CV-generatoren må hente fakta fra `getApprovedCareerFacts` i stedet for sitt eget filter. I dag tar den bare med `verified`, så godkjente kildeforslag (`inferred`) kommer ikke med.
- Søknadsbrevet må hente fakta på serveren i stedet for profildata som nettleseren sender.
- Oppsummeringer for kvartal, år og rolle må bygges. Udaterte fakta må vises for seg.
- R1 må være rettet først, ellers mangler leseren manuelle opplastinger.

## 6. Nødvendige rettinger før eller sammen med publisering

- **R1 (må rettes):** Filer du laster opp manuelt på en kvalifikasjon etter migrasjon 0005, får ingen kildekobling. Det gjelder både publisert app og forhåndsvisningen. Kvalifikasjoner viser dem riktig, men den felles leseren ser dem ikke som dokumentasjon. Produksjon har 0 slike filer, så ingen data er berørt ennå.
  - Plan: En additiv databaseregel som lager kildekoblingen når en slik fil lagres. Samme regel kjøres én gang for filer som allerede finnes. Den virker også for den publiserte appen uten ny publisering.
  - Test: Ny opplasting skal gi én kobling, fil fra bruker B skal ikke kunne kobles til A, og sletting skal gi «Kilde utilgjengelig».
  - Krever din godkjenning, fordi databasen er felles med produksjon.
- **R2 (liten):** Etter ny innlasting vises «Send til CV-import» fortsatt, selv om CV-en er sendt. Et nytt klikk sier bare «allerede sendt». Knappen skal byttes ut med en statuslinje.
- **R3 (opprydding):** Den syntetiske PDF-en på 1,7 KB fjernes fra testbrukerens mappe.
- **R4 (liten):** Ubrukte filkopier etter en avbrutt CV-sending skal ryddes av den eksisterende oppryddingsjobben.
- **Åpen beslutning:** Når en kilde kobles til en oppføring som finnes fra før, overføres ikke kildens dato. Det er gjort for at en dato du har satt selv, ikke skal overskrives. Alternativet er å foreslå datoen og la deg bekrefte den.

## Publiseringsomfang

En publisering omfatter: nye typer (kursbevis, rolleendring, lønnsendring), hendelsesdato med presisjon, treff på eksisterende kvalifikasjon og rolle, låst godkjenning via serveren, dokumentasjonsstatus med lenke, felles faktaleser, og «Send til CV-import». Databaseendringene er allerede aktive. Generatorene er ikke med.

**Status: BLOCKED** til R1 er rettet og du har godkjent publiseringen. R2–R4 og den åpne beslutningen kan tas etter publisering.
