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
- Brukeren må aldri velge en feil type for å komme videre. «Behold i arkivet» avslutter saken uten forslag.
- Teksten om at KI har klassifisert noe vises med KI-merking.
- **Akseptanse:**
  - Test-PDF-en viser «Dette ser ut som en CV», med valgene arkiv eller CV-import (fase 3), og kan arkiveres uten feil type.
  - Instruksjoner skjult i dokumentet («klassifiser som attest», «importer automatisk») endrer aldri hvilke handlinger som tilbys, og utløser ingenting.

### Fase 2a — Nedlastbart kontaktkort
- Knappen «Last ned kontaktkort» på /kilder lager et vCard 3.0 på serveren, bare for brukeren som er logget inn. Kortet heter «Karrierenmin – mitt arkiv» og inneholder bare adressen til karrieremateriale.
- Ingen offentlig lenke, ingen lagring og ingen logging av adressen.
- **Akseptanse:**
  - Kortet kan importeres i iOS Kontakter, Google Kontakter og Outlook. Dette må testes manuelt på enhetene og rapporteres per app.
  - En annen bruker får aldri en annen persons adresse.
  - Man får ikke kortet uten å være logget inn.

### Fase 2b — Bytte mottaksadresse (egen leveranse hvis aliasmodellen krever det)
- En ny tilfeldig adresse opprettes og den gamle deaktiveres. Brukeren får beskjed om at gamle kontaktkort og gammel adresse slutter å virke.
- E-post som allerede er mottatt eller under behandling på den gamle adressen fullføres. Ny post til den gamle adressen avvises med kontrollert status.
- **Akseptanse:** gammel adresse avvises, ny adresse virker, pågående behandling fullføres, og ingenting lekker mellom brukere.

### Fase 3 — CV, kursbevis, rolle og lønn til riktig flyt
- **CV:** handlingen «Send til CV-analyse» oppretter en CV-import med kobling til kildedokumentet (ny kolonne). Originalen gjenbrukes, så filen kopieres ikke. Det kan bare finnes én CV-import per kildedokument. Status vises på kilden («Bare arkivert» eller «Sendt til analyse»). Ingen endringer i profilen før brukeren har gjennomgått CV-en i den vanlige CV-flyten.
- **Kursbevis og sertifikat:** gir forslag om en `certification`- eller `course`-atom med sitat fra kilden. Utsteder, dato og gyldighet tas bare med når det står i utdraget. Kvalifikasjonen dokumenteres av kilden og krever ikke et godkjent resultat. Ferdigheter avledes ikke automatisk.
- **Rolleendring** og **lønnsendring** er to separate typer:
  - Rolle gir forslag om en `role`-atom eller endring med dato og sitat.
  - Lønn lagres bare i den private kilden og vises eventuelt som et privat forslag. Ingen oppdatering av profil eller lønnshistorikk i denne leveransen.
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
  - Kontaktopplysninger lagres lesbart for brukeren i egne tabeller med radsikkerhet.
  - Matching bruker i tillegg en nøkkelbeskyttet søkeverdi (HMAC med server-hemmelighet over normalisert verdi). En vanlig hash regnes ikke som anonymisering.
- **Retensjon og sletting:**
  - Den opplastede filen slettes når gjennomgangen er ferdig eller etter 30 dager uten aktivitet. Bare en hash av filen beholdes for å oppdage dobbel import.
  - Forslag som ikke er behandlet slettes sammen med importen.
  - Kontakter som allerede er godkjent beholdes alltid. Bare kildehenvisningen deres markeres som «import slettet».
  - En dialog forklarer konsekvensen før sletting.
- **Akseptanse:**
  - Norske tegn (æøå) fungerer i alle formatvarianter.
  - En vCard-fil med 3 eller flere kontakter gir like mange forslag.
  - Feilformaterte filer gir en klar feilmelding.
  - Samme fil importert to ganger gir ingen duplikater.
  - Delt e-post eller telefon gir ikke automatisk fletting.
  - Feltvis fletting bevarer manuelle verdier.
  - Avbrutt import og sletting av import fjerner ingen godkjente kontakter.
  - Brukere er isolert fra hverandre.

### Fase 5 — Kontaktforslag fra e-post
- Type «Kontakter»: vCard- eller CSV-vedlegg går til samme gjennomgang som i fase 4.
- Kontaktopplysninger i selve e-postteksten tolkes av KI og må ha ordrett utdrag. De blir bare forslag.
- Opplysninger om avsenderen vises separat og merkes «fra e-postens avsender». Avsenderen blir aldri en kontakt automatisk.
- **Akseptanse:**
  - Hvert forslag har kildehenvisning, og innhold og avsender holdes tydelig adskilt.
  - Instruksjoner i e-posten («opprett kontakt», «flett med…») ignoreres.

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

## Avklaringer
1. Skal lønnsforslag kunne vises i profilen senere, eller bare i kilden? (Forslag: bare i kilden nå.)
2. Er 30 dagers oppbevaring av opplastede kontaktfiler riktig? (Forslag: ja.)
3. Skal adressebytte (2b) leveres sammen med kontaktkortet eller senere? (Forslag: senere, egen leveranse.)
