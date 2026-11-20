# Flere inntakstyper, kontaktkort og kontaktimport — kartlegging og plan

Ingen implementering eller publisering før planen er godkjent. Kartleggingen leste bare kode, skjema og tellinger, ikke private innholdsfelt.

## Funn fra kartleggingen

- **Inntakstyper i dag:** fem typer (stillingsinstruks, prosjektnotat, medarbeidersamtale, attest, prestasjon) pluss «ukjent». Typene er låst både i koden og i databasen. Dokumenter som ikke passer, for eksempel PDF-en fra testen (KI-en mente med 0,85 sikkerhet at den ikke passet noen type), blir stående på «Velg type» uten noen type som passer.
- **CV:** det finnes en egen CV-import med opplasting, atomisering og gjennomgang. En CV som kommer på e-post bør sendes dit, ikke lages som et eget forslagsløp i karrierearkivet.
- **Kontakter:** nettverksmodulen har kontakter, identiteter og LinkedIn-import med avstemming. Brukeren godkjenner hvert punkt (ny, flett, manuell, hopp over). Identitetstypen i dag er bare LinkedIn-profil-URL; feltene for e-post og telefon finnes bare som manuelle felt.
- **Personlig mottaksadresse:** hver bruker har én tilfeldig, ugjettelig adresse knyttet til sin konto. Den kan legges i et kontaktkort.
- **Integrasjoner som faktisk er tilgjengelige (sjekket):**
  - Google: det finnes ingen kobling for Google Kontakter. Gmail-, Disk- og Kalender-koblinger finnes, men de gir ikke adresseboken.
  - Outlook: det finnes en kobling der hver bruker kobler sin egen Microsoft-konto. At den kan lese kontakter er ikke bekreftet. Det må testes før vi lover noe.
  - iCloud: Apple har ingen åpen innlogging for kontakter. Eneste direkte vei krever at brukeren lager og oppgir et app-spesifikt passord, og det anbefales ikke.
  - Konklusjon: filimport er hovedveien for alle tre. Google og iCloud eksporterer vCard (.vcf). Google og Outlook eksporterer også CSV.

## Prioritert gjennomføring

### Fase 1 — Flere typer, manuelt valg og tydelig beskjed (høyest prioritet)
1. Nye typer: **Kursbevis/sertifikat**, **Endret rolle/lønn**, **Øvrig (egen beskrivelse)**, pluss rutetypene **CV** og **Kontakter**.
2. Brukeren kan alltid velge type selv, både ved innliming og på mottatt materiale. «Øvrig» krever en kort egen beskrivelse.
3. **CV** sendes til den eksisterende CV-importen (originalen beholdes; ingen dobbel behandling). **Kontakter** (.vcf/.csv som vedlegg) sendes til kontaktimporten i fase 3.
4. Filer og innhold vi ikke kan behandle får en klar norsk melding om hva som ikke støttes og hva brukeren kan gjøre i stedet. Ingen stille feil.
5. Evidensregler per type:
   - Kursbevis gir forslag om sertifisering med sitat fra dokumentet.
   - Endret rolle/lønn gir forslag til karrierelogg. Lønn behandles som sensitivt og vises bare for brukeren.
   - «Øvrig» gir forslag bare når det finnes et ordrett sitat som støtter dem.
   - Ingen av typene gir kompetanse uten et godkjent resultat (som i dag).
6. Eksisterende «ukjent»-kilder, som testmeldingen, kan få en av de nye typene.

### Fase 2 — Kontaktkort (vCard) med personlig mottaksadresse
1. Knapp på /kilder: «Last ned kontaktkort». Kortet lages på serveren bare for brukeren som er logget inn, og inneholder visningsnavnet «Karrierenmin — mitt arkiv» og brukerens egen adresse.
2. Ingen offentlig lenke. Kortet lagres ikke, og adressen logges ikke.
3. Kort tekst om at alle som har adressen kan sende materiale til arkivet, og at adressen kan byttes.
4. Valgfritt (spørsmål under): knapp for å bytte adresse. Den gamle adressen slutter da å virke.

### Fase 3 — Kontaktimport fra fil (Outlook, Google, iCloud)
1. Opplasting av .vcf (vCard 3.0/4.0) og CSV (Google- og Outlook-format), og de samme filene som e-postvedlegg (typen «Kontakter»).
2. Parseren kjører på serveren med grenser (filstørrelse, antall kontakter, feltlengder), sjekker hva filen faktisk er, og leser ingen lenker eller bilder i filen.
3. Felter: navn, organisasjon, tittel, flere e-postadresser merket jobb/privat/annet (fra vCard-felt og CSV-kolonner), telefon og LinkedIn-URL hvis den finnes.
4. Nye identitetstyper for kontakter: e-post (normalisert og lagret som hash, med bare et maskert utdrag synlig) og telefon (normalisert til internasjonalt format og hashet).
5. Trygg matching, lagt til den eksisterende avstemmingen:
   - Sikker match (samme e-post, telefon eller LinkedIn-URL hos samme bruker) gir forslag om fletting.
   - Bare likt navn, eller navn og firma, gir «mulig duplikat» som brukeren må avgjøre.
   - Ingenting flettes uten brukerens godkjenning når matchen er usikker, og manuelle felt overskrives aldri.
6. Godkjenningen skjer i den eksisterende gjennomgangen (ny / flett / manuell / hopp over). Hvor hver opplysning kom fra lagres sammen med kontakten.
7. Personvern: kontaktdata er tredjepersoners data. De er bare synlige for brukeren, kan slettes per import, og den opplastede filen slettes etter behandling (bare en hash beholdes for å hindre dobbel import).

### Fase 4 — Direkte kontokobling (bare etter at det er bevist mulig)
1. Outlook: test først med en testbruker om koblingen kan få lesetilgang til kontakter. Bygg bare hvis det virker, og bruk samme gjennomgang som filimporten.
2. Google: ingen kobling i dag. Det krever egen godkjenning hos Google for kontakttilgang, og blir ikke en del av denne leveransen.
3. iCloud: bare filimport.

## Sikkerhet og personvern (gjelder alle faser)
- All lesing skjer på serveren. Rutingen styres av adressen og brukerens valg, aldri av innholdet. Innhold, adresser og filer logges aldri.
- Alle data er knyttet til brukeren, og nye tabeller får riktige tilganger og radsikkerhet.
- Testing skjer med syntetiske kontakter og filer: kryssbrukertest, duplikater, kodingsfeil, veldig store filer og forsøk på skadelig innhold i vCard.

## Teknisk
- Typer: utvid `CAREER_MATERIAL_TYPES` og CHECK-reglene i en ny migrasjon. Legg til `user_note` for «Øvrig» og rute-utfall (`routed_to_cv`, `routed_to_contacts`) i `career_material_intakes`. Bump prompt- og normaliseringsversjon slik at analysesignaturene blir nye.
- CV-ruting: gjenbruk `cv_imports` med lenke til kildedokumentet.
- vCard: serverfunksjon som returnerer `text/vcard` fra aliaset til brukeren som er logget inn.
- Kontakter: tabell for importkjøringer, utvidede verdier for `identity_kind` (`email`, `phone`) med hash pluss maskert utdrag, og gjenbruk av avstemmingspartiene.
- Hver fase verifiseres med tester, sjekk mot databasen og en kjøring i nettleseren før neste fase starter.

## Spørsmål (forslag til svar står i parentes)
1. Skal lønn ved «Endret rolle/lønn» lagres som tall i profilen, eller bare som tekst i kilden? (Bare i kilden, til det er avklart.)
2. Skal adressen kunne byttes i fase 2? (Ja.)
3. Skal kontakter fra fil bare kunne slås sammen med eksisterende nettverkskontakter, eller også opprettes som nye? (Begge, etter godkjenning.)
