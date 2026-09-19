# Onderdelen en hergebruik

Dit bestand beschrijft wat er in deze map zit en welke onderdelen los te maken zijn voor
een ander project. Bedoeld om mee te nemen naar een ander gesprek of een andere tool, zonder
dat je deze zoektocht hoeft te kennen.

## Wat dit project is

Een zoektocht naar een vrijstaande villa op de noordelijke Costa Blanca (Calpe/Benissa-Costa,
Moraira, Benitachell, Jávea), budget €500.000–€700.000. Het bestaat uit twee helften:

1. **Een werkwijze** — vastgelegde eisen, een wekelijkse zoekronde en een logboek per ronde.
2. **Een deelbare pagina** — één zelfstandig HTML-bestand met de shortlist, een kaart, filters,
   een eisenraster per villa, prijshistorie en de mogelijkheid om te markeren en te reageren.

De zoektocht zelf is afgerond (er is een huis gevonden). Wat overblijft is bruikbaar materiaal.

## Bestanden

| Bestand | Wat het is | Grootte |
|---|---|---|
| `zoekprofiel.md` | Eisen, wensen, regio's en de werkwijze per zoekronde | 3 KB |
| `shortlist-2026-08-06.md` | Ronde 1 — de volledige lijst | 7 KB |
| `shortlist-2026-08-10.md` | Ronde 2 — alleen de delta | 2 KB |
| `shortlist-2026-08-11.md` | Ronde 3 — alleen de delta | 4 KB |
| `shortlist-2026-08-17.md` | Ronde 4 — alleen de delta | 5 KB |
| `makelaars-uitvraag.md` | Kant-en-klare mails aan makelaars, met adressen | 9 KB |
| `facebook-post.md` | Oproep in het Nederlands en Spaans | 3 KB |
| `pagina/villa-zoektocht.bron.html` | De bron van de pagina, 1.632 regels | 78 KB |
| `pagina/villa-zoektocht.html` | Het gepubliceerde bestand, lettertype ingesloten | 165 KB |
| `pagina/README.md` | Hoe de pagina in elkaar zit en hoe je hem bijwerkt | 5 KB |

Van die 165 KB is 87 KB het ingesloten lettertype. De pagina zelf is dus klein.

## Hoe de pagina is opgebouwd

Eén bestand, geen build, geen afhankelijkheden, geen netwerk nodig. Alles — opmaak, logica,
gegevens en lettertype — zit erin. Dubbelklikken opent hem in elke browser.

Alle gegevens staan onderaan in vier structuren, allemaal op volgnummer:

- `K` — de array met villa's; elk item levert een kaart én een stip op de landkaart
- `HISTORIE` — per villa de waarnemingen `[datum, prijs]` uit de zoekrondes
- `EISEN` — per villa zeven velden voor het raster, elk `[staat, korte tekst]`
- `PERCEEL` — perceeloppervlak in m², voor het staafje

De rest van de pagina bouwt zichzelf daaruit op. Wil je een onderdeel elders gebruiken, dan is
het werk vooral het schrijven van die vertaalslag naar jouw eigen datamodel — niet het
overzetten van het onderdeel zelf.

## Inventaris

Regelnummers gelden voor de huidige versie van `villa-zoektocht.bron.html`; de
commentaarregels erboven (`/* ---- eisenraster ---- */`, `// --- pinnen op de kaart ---`)
blijven kloppen ook als er iets verschuift.

### Eisenraster — hoog herbruikbaar

CSS regel 319, opbouw in de kaartenlus vanaf regel 1232. Ongeveer 70 regels totaal.

Zeven velden per villa met vier standen: `ja` (✓ groen), `krap` (≈ oranje), `nee` (– grijs) en
`?` (onbekend). Elk veld is `[staat, korte tekst]`, dus de cel toont een concrete waarde
("800 m²", "carport", "9×4,5") in plaats van alleen een symbool. Bij het perceel komt er een
staafje onder dat naar 1.000 m² vult.

Dit is het sterkste idee van de pagina. Het vervangt het lezen van lange opsommingen, en
daardoor konden de positieve punten achter een uitklap terwijl alleen de aandachtspunten in
beeld blijven — ruwweg de helft minder tekst per kaart.

Eén technisch detail dat de moeite waard is: de scheidingslijnen lopen via `box-shadow` op de
cellen in plaats van via gaten in het raster. Daardoor houdt de lege ruimte in de laatste rij
de kleur van de kaart, in plaats van dat je een grijs gat ziet.

### Prijshistorie — hoog herbruikbaar

CSS regel 297, logica in de kaartenlus vanaf regel 1164. Ongeveer 30 regels.

Per villa een reeks waarnemingen. Elke ronde vul je één paar aan bij wat je daadwerkelijk hebt
gecontroleerd. De pagina leidt daar zelf uit af wat er onder de vraagprijs komt te staan:

| Situatie | Weergave |
|---|---|
| Laatste prijs lager dan de eerste | Vlag **Prijs verlaagd**, met beide bedragen |
| Laatste waarneming ouder dan de huidige ronde | Oranje vlag **Niet opnieuw gecheckt** + datum |
| Meerdere gelijke waarnemingen | "Prijs ongewijzigd · N controles sinds …" |
| Eén waarneming in de huidige ronde | Vlag **Nieuw deze ronde** |

De constante `RONDE` bovenaan bepaalt wat "deze ronde" is. Daardoor valt meteen op welk item
is overgeslagen, in plaats van dat een oude prijs stilzwijgend als vers doorgaat. Werkt voor
alles wat je periodiek volgt, niet alleen voor huizen.

### Favorieten met notities — hoog herbruikbaar

CSS regel 376, logica vanaf regel 1114 en het verzamelen vanaf regel 1488. Ongeveer 120 regels.
Volledig op zichzelf staand.

Per kaart een ★, een ✕ en een eigen notitie, bewaard in `localStorage` onder de sleutel
`villa-oordeel-v1`. Twee filters (alleen favorieten, afgevallene verbergen) en onderaan een
knop die alles verzamelt tot een plakbaar bericht, gegroepeerd in "deze springen eruit",
"deze liever niet" en "opmerkingen".

Bewust ontwerp: de opslagsleutel staat los van de inhoud, zodat markeringen blijven staan als
de lijst wordt bijgewerkt. Verander de sleutel alleen als de nummering op de schop gaat —
anders horen oude markeringen opeens bij een ander item. Alle lees- en schrijfacties zitten in
een `try/catch`, want in privémodus kan `localStorage` gooien.

### Afstand en Street View — hoog herbruikbaar

In de kaartenlus vanaf regel 1211. Ongeveer 10 regels.

Per villa een regel als "≈ 1,2 km van zee · 1,2 km van Moraira", en een link die Google Street
View opent op de urbanisatie via een veld `pano` met "breedtegraad,lengtegraad". Dat laatste
is verrassend nuttig: in dertig seconden zie je hoe steil een straat is en hoe dicht de buren
op elkaar staan — precies wat uit een advertentietekst nooit blijkt.

### Kaart met projectie — deels herbruikbaar

CSS regel 128, SVG in de sectie rond regel 548, stippen vanaf regel 1376.

Een handgetekende SVG (`viewBox="0 0 640 772"`) van de kust tussen Calpe en Jávea, met een
gelijkhoekige projectie van 32 pixels per kilometer:

```
x = (lengtegraad - 0.015) * 2780.8
y = (38.815 - breedtegraad) * 3552
```

Genummerde stippen, klikken springt naar de bijbehorende kaart, en ze dimmen mee met de
filters. Kleur codeert de prijsstatus, een streepjesring betekent "ligging bij benadering".

De formule en de stipmechaniek zijn generiek. De kustlijn is één `<path>` die je vervangt door
die van jouw gebied; de plaatsnamen zitten in een aparte groep ernaast.

### Themakleuren — hoog herbruikbaar

Bovenaan het bestand, regel 11 tot 57.

Alle kleuren als tokens op `:root`, opnieuw gedefinieerd onder
`@media (prefers-color-scheme: dark)` met de bewaking `:root:not([data-theme="light"])`, en
nog een keer onder `:root[data-theme="dark"]`. Daarmee klopt het in alle drie de toestanden
die een lezer kan hebben: systeemvoorkeur, expliciet licht, expliciet donker. Nagemeten in
een browser, alle drie.

Dit is het bewerkelijkste stukje om zelf goed te krijgen, en het kost niets om over te nemen.

Het lettertype (Fraunces, SIL Open Font License) zit als base64 data-URI in het bestand. Dat
is geen luxe maar noodzaak: in een gepubliceerd artifact worden lettertype-CDN's geblokkeerd,
dus een `<link>` naar Google Fonts valt stilletjes terug op een standaardletter.

### Filters — matig herbruikbaar

CSS regel 171, logica vanaf regel 1421.

Prijsschuif, regioknoppen, eisenknoppen, live telling, en de kaart dimt mee. Eén bewuste
keuze: villa's zonder gepubliceerde prijs blijven altijd staan bij het filteren op prijs —
dat zijn juist de interessantste. Zit verder vast aan de villavelden, dus dit is meer een
patroon dan een kant-en-klaar onderdeel.

### Inklapbare details — patroon, geen code

Aandachtspunten blijven altijd zichtbaar; positieve punten gaan achter een `<details>`. Dat
werkt alleen omdat het raster de positieve punten al samenvat. Bij de kaarten die meerdere
villa's bundelen is er geen raster, en daar blijft daarom alles zichtbaar.

### De werkwijze — hoog herbruikbaar, losstaand van de code

`zoekprofiel.md` legt vast wat de eisen zijn, welke portalen je afgaat, en één regel die veel
oplevert: **alleen advertenties die je daadwerkelijk hebt geopend en gecontroleerd komen op de
shortlist**. Wat je wel vindt maar niet kunt openen gaat onder een kopje "nog te verifiëren"
in het rondebestand, en blijft van de pagina af. Daardoor blijft de lijst betrouwbaar, ook als
een ronde in een omgeving draait die niet overal bij kan.

Verder: elke ronde een eigen `shortlist-JJJJ-MM-DD.md` met alleen de delta, en elke
gecontroleerde prijs als waarneming toegevoegd aan `HISTORIE`.

## Wat er niet in zit

**Foto's.** Geen enkele. De zoekrondes draaiden in een omgeving die de makelaarssites niet mocht
openen, dus er was niets op te halen. Ook plattegronden ontbreken — Spaanse advertenties
publiceren die zelden; die komen meestal pas op verzoek, en daar zijn de mails in
`makelaars-uitvraag.md` op ingericht.

Wil je beeld toevoegen: in een gepubliceerd artifact worden externe afbeeldingen geblokkeerd,
dus foto's moeten als base64 in het bestand zelf. Reken op enkele honderden KB per foto, dus
schaal ze eerst terug.

## Twee beslissingen die het verschil maken

**Het vraagteken is een volwaardige stand.** In het raster staat `?` voor "de advertentie zegt
het niet". Dat is geen gat in de gegevens maar informatie: het is precies de vraag die je aan
de makelaar stelt. Wegpoetsen naar "nee" of naar een aanname maakt de lijst onbetrouwbaar.

**Markeringen staan los van de inhoud.** Wat iemand aanvinkt hoort bij die persoon, niet bij de
lijst. Daarom in de browser, onder een sleutel die niet meeverandert als de lijst wordt
bijgewerkt — en daarom ook een knop om het als bericht te versturen, in plaats van te doen
alsof het gedeeld wordt.

## Hoe je de pagina bijwerkt

Zie `pagina/README.md` voor de velden per villa en de projectieformule. Kort:

1. Pas `K` aan, en de drie tabellen eronder.
2. Vervang `__FRAUNCES_B64__` in de bron door het lettertype uit het bestaande
   `villa-zoektocht.html`, en schrijf het resultaat weg als `villa-zoektocht.html`.
3. Publiceer dat bestand. Geef bij het publiceren de bestaande URL mee, anders ontstaat er
   een nieuwe link.
