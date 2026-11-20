# Flere inntakstyper, kontaktkort og kontaktimport — oppdatert plan

Dette er en plan. Ingenting implementeres eller publiseres før den er godkjent. Kartleggingen leste bare kode, skjema og tellinger, ikke privat innhold.

## Utgangspunkt: produksjonstesten
En e-post med et PDF-vedlegg ble lagret som to separate kilder, uten duplikater. PDF-en ble lest, men ble klassifisert som «ukjent» fordi CV ikke er en type inntaksmotoren støtter. Den står nå uten noen vei videre. Denne PDF-en brukes som gjennomgående eksempel og som akseptansetest i fase 1 og 3.

## Bekreftet i dagens løsning, og hva som må undersøkes

**Bekreftet:**
- Det finnes fem inntakstyper pluss «ukjent». Typene er låst i både koden og databasen.
- Karriere-atomer har allerede typene `certification`, `course` og `role`, med gyldighetsdatoer (`valid_from` og `valid_to`). Det finnes egne spørringer for kvalifikasjoner (`credential-atoms`).
- Regelen «kompetanse krever godkjent resultat» gjelder bare ferdigheter. Den gjelder ikke sertifiseringer eller kurs.
- CV-importen (`cv_imports`) har filsti og status, men ingen kobling til et kildedokument.
- Mottaksadressen ligger på `email_job_sources` (`inbound_alias_token`, `is_active`, `intake_mode`).
- Kontakter har bare manuelle felt for e-post og telefon i klartekst (én verdi hver). Identiteter lagres som hash pluss et forhåndsvisningsutdrag, og den eneste identitetstypen i dag er LinkedIn-URL.
- Avstemmingen har allerede valgene opprett, flett, manuell og hopp over.
- Ingen eksisterende kobling kan lese Google Kontakter. Det finnes en Outlook-kobling per bruker, men det er ikke bekreftet at den har tilgang til kontakter. iCloud har ingen åpen kontaktinnlogging.

**Må undersøkes før eller under fasen:**
- Om én bruker kan ha flere aliaser (unik indeks), og om en deaktivert adresse avvises før eller etter at e-posten er tatt imot (fase 2b).
- Hvordan CV-importen lager og låser kandidater, så en kobling til dokumentet ikke gir dobbel import (fase 3).
- Om det finnes lønnshistorikk i profilen. I dag finnes «lønn» bare i målrettings- og konfliktlogikk (fase 3).

## Ruting (presisert)
- **Adressenivå:** aliasets modus avgjør alltid om e-posten er et jobbvarsel eller karrieremateriale. Innholdet påvirker aldri dette skillet.
- **Innenfor karrieremateriale:** KI kan foreslå en type. Brukeren kan alltid overstyre. Alt som går videre (CV-import, kontaktregister, kvalifikasjoner, rolle og lønn) krever brukerens bekreftelse. KI-forslaget alene utløser aldri noe.

## Faser i prioritert rekkefølge

### Fase 1 — Ukjente og ikke-støttede typer, manuelt valg
- Det skilles mellom to slags typer:
  - **Behandlingstyper** gir forslag eller fører til en annen del av appen.
  - **Arkivtyper** lagres bare og søkes i arkivet.
- KI kan svare med en «gjenkjent, men ikke støttet» type, for eksempel CV, kontaktliste, kursbevis, lønnsbrev, faktura eller annet. Brukeren får en norsk forklaring og tre valg:
  1. Bruk en relevant eksisterende funksjon (lenke eller handling).
  2. Behold bare i arkivet.
  3. «Annet» med egen beskrivelse.
- Brukeren må aldri velge en feil type for å komme videre. «Behold i arkivet» betyr bare at kilden ikke lenger krever handling. Den er reversibel, så kilden kan senere gis en type eller sendes til CV-analyse eller en annen flyt.
- Teksten om at KI har klassifisert noe vises med KI-merking.
- **Akseptanse:**
  - Test-PDF-en viser «Dette ser ut som en CV», med valgene arkiv eller lenke til eksisterende manuell CV-import (ingen egen importknapp før fase 3 er klar). Den kan arkiveres uten feil type.
  - Instruksjoner skjult i dokumentet («klassifiser som attest», «importer automatisk») endrer aldri hvilke handlinger som tilbys, og utløser ingenting.

### Fase 2a — Nedlastbart kontaktkort
- Knappen «Last ned kontaktkort» på /kilder lager et vCard 3.0 på serveren, bare for brukeren som er logget inn. Kortet heter «Karrierenmin – mitt arkiv» og inneholder bare adressen til karrieremateriale.
- Ingen offentlig lenke, ingen lagring og ingen logging av adressen.
- **Akseptanse:**
  - Kortet testes manuelt i iOS Kontakter, Google Kontakter og Outlook, og resultatet rapporteres per app. En plattform som ikke er tilgjengelig under testingen rapporteres som «ikke testet», aldri som verifisert.
  - En annen bruker får aldri en annen persons adresse.
  - Man får ikke kortet uten å være logget inn.

### Fase 2b — Bytte mottaksadresse (egen leveranse hvis aliasmodellen krever det)
- En ny tilfeldig adresse opprettes og den gamle deaktiveres. Brukeren får beskjed om at gamle kontaktkort og gammel adresse slutter å virke.
- E-post som allerede er mottatt eller under behandling på den gamle adressen fullføres. Etter byttet knyttes den gamle adressen ikke lenger til brukerens arkiv. Det loves ikke at avsenderen får en avvisning (SMTP), fordi Resend tar imot e-posten før webhooken kjører. Hva avsenderen faktisk opplever, testes i den reelle konfigurasjonen.
- **Akseptanse:** gammel adresse avvises, ny adresse virker, pågående behandling fullføres, og ingenting lekker mellom brukere.

### Fase 3 — CV, kursbevis, rolle og lønn til riktig flyt
- **CV:** «Send til CV-analyse» kobler kilden til den eksisterende CV-importen. Mål: gjenbruke originalen og unngå dobbel registrering. Den tekniske løsningen (kopi eller referanse, én eller flere importer per kilde) velges først etter at lagring, tilgang, sletting og den eksisterende importen er kontrollert. Ny analyse av samme kilde må være mulig uten dobbel registrering og uten tap av historikk. Status vises på kilden («Bare arkivert» eller «Sendt til analyse»). Ingen endringer i profilen før brukeren har gjennomgått CV-en i den vanlige CV-flyten.
- **Kursbevis og sertifikat:** gir forslag om en `certification`- eller `course`-atom med sitat fra kilden. Utsteder, dato og gyldighet tas bare med når det står i utdraget. Kvalifikasjonen dokumenteres av kilden og krever ikke et godkjent resultat. Ferdigheter avledes ikke automatisk.
- **Rolleendring** og **lønnsendring** er to separate typer:
  - Rolle gir forslag om en `role`-atom eller endring med dato og sitat.
  - Lønn: beløpet vises bare i den private kilden. Et eventuelt forslag sier bare at «en lønnsendring er funnet», uten å kopiere beløpet. Ingen oppdatering av profil eller lønnshistorikk i denne leveransen.
- **Evidens:** regler settes per type etter den eksisterende ontologien. Utdrag, tall og datoer må stå i kilden.
- **Akseptanse:**
  - Test-PDF-en sendes til CV-importen uten ny e-post, og et nytt klikk gir ikke en ny import.
  - Profilen er uendret før CV-gjennomgangen er godkjent.
  - Et kursbevis uten utløpsdato gir ingen oppdiktet gyldighet.
  - Lønnstall vises aldri utenfor kilden.

### Fase 4 — Kontaktimport fra fil
- Støttede formater:
  - CSV fra Google Kontakter og Outlook (komma og semikolon, UTF-8 med og uten BOM, og Windows-1252).
  - vCard 3.0 og 4.0 med flere kontakter i én fil, inkludert linjer som fortsetter på neste linje og quoted-printable.
- Felter som leses: navn, organisasjon, tittel, flere e-postadresser merket jobb/privat/annet, telefonnumre og LinkedIn-URL.
- Forhåndsvisning der brukeren kan redigere før lagring.
- Grenser: filstørrelse, antall kontakter og lengde per felt. Filtypen sjekkes på innholdet, og bilder og eksterne lenker i filen ignoreres.
- **Matching:**
  - Lik e-post, telefon eller LinkedIn-URL gir et *sterkt forslag*, aldri automatisk fletting, fordi felles sentralbord og delte postbokser forekommer.
  - Likt navn, eller navn og firma, regnes som usikker match.
  - Feltene sammenlignes ett for ett, og brukeren velger opprett, flett, rediger eller hopp over.
  - Manuelle verdier overskrives aldri uten eksplisitt valg.
- **Lagring og beskyttelse:**
  - Kontaktopplysninger lagres lesbart for brukeren i en ny kanaltabell med radsikkerhet (flere e-poster og telefoner med etikett).
  - Matching bruker i tillegg en nøkkelbeskyttet søkeverdi (HMAC med server-hemmelighet, beregnet med bruker-ID og normalisert verdi). Søk og treff gjelder alltid bare den enkelte brukeren. En vanlig hash regnes ikke som anonymisering.
  - Konsistens: de eksisterende manuelle feltene for e-post og telefon overføres til kanaltabellen. Så lenge appen bruker begge, synkroniseres de i databasen, slik at de gamle feltene og kanalene ikke kan gli fra hverandre. Den gamle modellen avløses først når matching og lagring er ferdig testet.
  - HMAC-nøkkelen: bare serveren har tilgang, og den lagres som hemmelighet. Søkeverdiene får en nøkkelversjon. Ved rotasjon beregnes verdiene på nytt i en bakgrunnsjobb, og begge versjonene godtas til jobben er ferdig.
- **Livsløp og sletting:**
  - Uferdig import: filen, kandidatdata og utdrag slettes etter 30 dager uten aktivitet (foreløpig frist).
  - Fullført import: filen slettes med en gang. Kandidatdata og utdrag slettes etter 30 dager. Kildehenvisningen på godkjente kontakter beholdes, men utdraget fjernes.
  - Filhashen finnes bare for å kjenne igjen en fil ved ny opplasting. Den slettes sammen med importen, og senest etter 90 dager.
  - Brukeren kan når som helst avbryte og slette en pågående import. Da forsvinner fil, kandidater og hash. Kontakter som allerede er godkjent beholdes alltid.
  - Når en konto slettes, slettes alt: importer, kandidater, filer, hasher, kontakter og kanaler.
  - En dialog forklarer konsekvensen før sletting.
- **Akseptanse (i tillegg til punktene under):** samtidige godkjenninger, avbrutt og gjenopptatt import, mange kontakter (opptil grensen), delte kanaler, nøkkelrotasjon, sletting av originalen, og at en CSV med ukjent oppsett avvises og ikke feiltolkes.
- **Publisering:** kontaktimporten publiseres ikke før fletting, sletting og ny import er testet samlet.
- **Akseptanse:**
  - Norske tegn (æøå) fungerer i alle formatvarianter.
  - En vCard-fil med 3 eller flere kontakter gir like mange forslag.
  - Feilformaterte filer gir en klar feilmelding.
  - Når samme fil lastes opp igjen, kjenner systemet den igjen, viser tidligere status og tilbyr en trygg ny gjennomgang. Det oppstår ingen duplikater, men ny import er tillatt, for eksempel etter avbrudd eller etter at en kontakt er slettet.
  - Delt e-post eller telefon gir ikke automatisk fletting.
  - Feltvis fletting bevarer manuelle verdier.
  - Avbrutt import og sletting av import fjerner ingen godkjente kontakter.
  - Brukere er isolert fra hverandre.

### Fase 5 — Kontaktforslag fra e-post
- Type «Kontakter»: vCard- eller CSV-vedlegg går til samme gjennomgang som i fase 4.
- Kontaktopplysninger i selve e-postteksten tolkes av KI og blir bare forslag. Hvert forslag viser både det ordrette utdraget og den tolkede verdien, så brukeren kan se om tolkningen stemmer. Godkjenning er alltid nødvendig.
- Opplysninger fra avsenderfeltet og fra videresendt tekst holdes adskilt og merkes hver for seg. Avsenderen blir aldri en kontakt automatisk.
- **Akseptanse:**
  - Hvert forslag har kildehenvisning, og innhold og avsender holdes tydelig adskilt.
  - Instruksjoner i e-posten («opprett kontakt», «flett med…») ignoreres.
  - En e-post med flere vedlegg av ulike typer gir riktig behandling per vedlegg.

### Fase 6 — Undersøke direkte kontokoblinger (ingen løfter)
- For Microsoft, Google og iCloud undersøkes faktisk tilgang, godkjenningskrav hos leverandøren, samtykke og frakobling. Dette ender i et beslutningsnotat.
- Ingen passord oppgis i chat, og app-spesifikke passord for iCloud anbefales ikke.

## Avhengigheter
```text
Fase 1 ─┬─> Fase 3 (bruker handlingene og typene fra fase 1)
        └─> Fase 5 (typen «Kontakter»)
Fase 2a (uavhengig) -> Fase 2b (etter at aliasmodellen er undersøkt)
Fase 4 ───> Fase 5 (samme gjennomgang)
Fase 6 bygger på fase 4
```

## Sikkerhet og personvern (alle faser)
- Alle data er knyttet til brukeren med radsikkerhet. Endringer skrives via serverfunksjoner eller RPC-er med eierskapskontroll.
- Dokumentinnhold, kontaktopplysninger, mottaksadresser og hemmeligheter logges aldri.
- Instruksjoner i dokumenter og e-post behandles som data, aldri som kommandoer.
- Det lagres minst mulig data, med faste grenser for filer og felt og kontrollerte feilstatuser.

## Teknisk (migrasjoner, bare additive)
- **Fase 1:** utvid CHECK-reglene for typer med nye behandlingstyper, og legg til `archive_only` og `recognized_unsupported_type` på intakes. Legg til `user_note` for «Annet». Ny prompt- og normaliseringsversjon.
- **Fase 2b:** eventuelt ny indeks eller logikk for aktiv adresse per bruker, og et rotasjons-RPC.
- **Fase 3:** `cv_imports.source_document_id`, unik når den er satt. Typene `kursbevis`, `rolleendring` og `lonnsendring`. Mapping til eksisterende atomtyper.
- **Fase 4:** nye tabeller `contact_imports`, `contact_import_candidates`, `network_contact_channels` (e-post og telefon med etikett og lesbar verdi) og `identity_kind`-verdiene `email` og `phone` med HMAC-søkeverdi. Ny server-hemmelighet for HMAC. Alle tabeller får GRANT og radsikkerhet.
- Hver fase verifiseres med syntetiske data, kryssbrukertest, test i nettleseren og opprydding av testdata før neste fase starter.

## Avklaringer (besluttet)
1. Lønn: beløpet vises bare i den private kilden i denne leveransen.
2. Oppbevaring: 30 dager for uferdige importer, med fristene for kandidatdata og hash beskrevet i fase 4.
3. Adressebytte: egen leveranse, etter at aliasmodellen og den faktiske mottaksatferden er undersøkt.
4. Rekkefølge: fase 1 og kontaktkortet (2a) først.
