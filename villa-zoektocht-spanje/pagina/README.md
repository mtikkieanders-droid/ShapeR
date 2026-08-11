# De gedeelde pagina

**Live URL (blijft altijd gelijk):**
https://claude.ai/code/artifact/1599bdf7-149c-4ce8-a95d-59003076ea6c

## Twee bestanden

| Bestand | Wat het is |
|---|---|
| `villa-zoektocht.bron.html` | De bron om te bewerken. Bevat de placeholder `__FRAUNCES_B64__` in plaats van het ingesloten lettertype, dus goed leesbaar en te diffen. |
| `villa-zoektocht.html` | Het gepubliceerde bestand, met het lettertype als data-URI erin. Wordt gegenereerd uit de bron. |

## Bijwerken bij een nieuwe zoekronde

Alle villagegevens staan in één JavaScript-array `K` onderaan `villa-zoektocht.bron.html`.
Een kandidaat toevoegen, wijzigen of verwijderen betekent alleen die array aanpassen —
de kaarten, de stippen op de kaart en de filters worden daaruit opgebouwd.

Velden per kandidaat:

| Veld | Betekenis |
|---|---|
| `nr` | Volgnummer = kijkvolgorde; verschijnt ook in de stip op de kaart |
| `regio` | `calpe-benissa` \| `moraira` \| `benitachell` \| `javea` — stuurt het regiofilter |
| `prijs` | Getal, of `null` als de prijs niet gepubliceerd is (die blijven altijd zichtbaar bij filteren) |
| `status` | `bevestigd` \| `opvragen` \| `boven` — bepaalt de kleur van de stip en de chip |
| `gastenverblijf`, `gelijkvloers`, `zwembad84` | Booleans voor de "alleen tonen met"-filters |
| `x`, `y` | Positie op de kaart, zie projectie hieronder |
| `precies` | `false` tekent een streepjesring: ligging bij benadering |
| `feiten`, `punten`, `links`, `maps` | Inhoud van de kaart; `punten` zijn paren `["ja"\|"wens"\|"let", tekst]` |

### Positie op de kaart uitrekenen

De kaart is een handgetekende SVG met een gelijkhoekige projectie, 32 pixels per kilometer:

```
x = (lengtegraad - 0.015) * 2780.8
y = (38.815 - breedtegraad) * 3552
```

Voorbeeld, Los Molinos (38,745 N / 0,167 O): x = 422,6 en y = 248,6.
Coördinaten van een urbanisatie zijn op te zoeken via Google Maps (rechtsklik → coördinaten).
Het zichtbare gebied loopt van Calpe (linksonder) tot Jávea (linksboven) en Cap de la Nao (rechts).

### Publiceren

1. Bewerk `villa-zoektocht.bron.html`.
2. Vervang `__FRAUNCES_B64__` door de inhoud van het base64-lettertypebestand en schrijf het
   resultaat weg als `villa-zoektocht.html`.
3. Publiceer dat bestand met de Artifact-tool. Vanuit een ander gesprek moet de bovenstaande
   URL als `url` worden meegegeven, anders ontstaat er een nieuwe link.
4. Zet beide bestanden terug in deze map en commit.

Het lettertype (Fraunces, SIL Open Font License) wordt opgehaald bij Google Fonts; in een
omgeving zonder internettoegang kan stap 2 worden overgeslagen door het bestaande
`villa-zoektocht.html` als basis te nemen en daar dezelfde bewerking in te doen.
