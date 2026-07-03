# Containerplanner

Interactieve 3D-webapp waarin een klant zelf zeecontainers kan plaatsen,
slepen en stapelen op een terrein — inclusief een **gaussian splat** van een
drone-scan als levensechte ondergrond. Volledig statisch (three.js + Spark,
gebundeld in `vendor/planner-bundle.js`), dus te hosten op elke webserver of
GitHub Pages.

## Gebruik

Serveer de map over http (ES-workers werken niet via `file://`):

```bash
python -m http.server 8000
# open http://localhost:8000/container-planner/
```

| Actie | Hoe |
| --- | --- |
| Container toevoegen | knoppen **+ 20ft / + 40ft**, kleur via de swatches |
| Verplaatsen | klik + sleep (snapt op 0,5 m-grid) |
| Stapelen | sleep een container boven een andere; hij landt er automatisch bovenop (magneet-uitlijning bij gelijk formaat, max. stapelhoogte instelbaar) |
| Draaien / verwijderen | selecteer, dan **R** / **Delete** (of de knoppen) |
| Terrein laden | **Terrein (splat) laden…** — `.ply`, `.splat`, `.spz`, `.ksplat` |
| Terrein uitlijnen | **Kalibratie**: positie/rotatie/schaal + Auto-centreer; wordt in de layout opgeslagen |
| Opslaan / delen | **Opslaan** maakt één `.containerplan`-projectbestand met terrein + kalibratie + indeling erin; **Laden…** opent het weer (ook oude `.json`-layouts). **Deel-link** deelt alleen de indeling via de URL; autosave in de browser |
| Export | **PNG** of **PDF** (met datum en containertelling) |

De teller rechtsboven toont 20ft/40ft-aantallen en TEU live.

## Splat van een drone-scan

- Exporteer je scan als `.ply` (3DGS), `.splat`, `.spz` of `.ksplat`.
  Grote scans eerst comprimeren naar `.spz`/`.ksplat` scheelt enorm in
  laadtijd (en GitHub Pages weigert bestanden > 100 MB).
- Host je de splat online, dan kan hij automatisch meegeladen worden via
  `?splat=https://…/scan.spz` — die URL wordt ook in deel-links en
  opgeslagen layouts bewaard. Een lokaal gekozen bestand geldt alleen voor
  de eigen sessie.
- Kalibreer eenmalig (drone-scans zijn zelden recht/op schaal): rotatie X
  staat standaard op 180° (3DGS-conventie), zet met *Auto-centreer* het
  terrein rond de oorsprong en schuif de hoogte tot de containers op de
  grond staan. De kalibratie reist mee met de layout.

## Werkwijze met klanten (zonder hosting of accounts)

1. Jij: open de app, laad de drone-splat, kalibreer, klik **Opslaan** →
   één `.containerplan`-bestand (≈ zo groot als de splat).
2. Deel de app-link + dat ene bestand (Drive, WeTransfer, mail).
3. Klant: opent de link, klikt **Laden…**, kiest het bestand — het plot staat
   er gekalibreerd en wel. De klant stuurt zijn variant terug als
   `.containerplan` of als PDF.

## Publiceren

De map is self-contained. Voor een klant-link: zet de map in een (nieuw)
repo, activeer GitHub Pages, en deel
`https://<user>.github.io/<repo>/container-planner/?splat=<url-naar-splat>`.

## Ontwikkeling

- `app.js` — alle logica (scene, sleep/stapel-algoritme, kalibratie,
  opslaan/delen, export). `window.__planner` is een klein test-hook-object.
- `vendor/planner-bundle.js` — three.js r180 + @sparkjsdev/spark 2.1 + jsPDF,
  gebundeld met esbuild:

  ```bash
  npm install three@0.180.0 @sparkjsdev/spark jspdf esbuild
  esbuild entry.js --bundle --minify --format=iife --outfile=vendor/planner-bundle.js
  ```

  waarbij `entry.js` de imports op `window` zet (THREE, OrbitControls,
  SplatMesh, SparkRenderer, jsPDF).
- Containermaten zijn ISO: 20ft = 6,058 m, 40ft = 12,192 m, breedte 2,438 m,
  hoogte 2,591 m. Alles is metrisch.
