# Unreal 3D-walkthroughs — lightweight, zonder zware gehuurde servers

> **Status:** landingsplek / work-in-progress. Dit bestand bundelt de draad van een
> eerder gesprek zodat context niet opnieuw kwijtraakt. Aangemaakt op 2026-07-22.
> Vul aan zodra het oorspronkelijke gesprek is teruggevonden.

## Doel

Mooie realtime 3D-walkthroughs (Unreal-kwaliteit) naar bezoekers brengen **zonder**
per-bezoeker een dure GPU-cloudserver te hoeven huren (het klassieke Pixel
Streaming-kostenprobleem).

## Kernidee

Verplaats het renderwerk naar **de client** (browser/toestel van de bezoeker) of
naar **bakken vooraf**, en host alleen **statische bestanden** vanaf goedkope
objectstorage/CDN. Geen altijd-aan GPU-server.

## Kandidaat-aanpakken

| Aanpak | Hoe | Kosten | Kwaliteit | Beperking |
|---|---|---|---|---|
| **Gaussian Splatting** | Scene → 3D-splat → in-browser viewer (WebGL/WebGPU) | Alleen static hosting/CDN | Fotorealistisch, client-GPU | Editen/collisions lastiger |
| **Baked glTF** | Unreal Lumen-GI → lightmaps bakken → glTF → three.js / Babylon / PlayCanvas | Static hosting | Goed (net onder realtime Lumen) | Statische belichting |
| **360° node-tour (Matterport-stijl)** | Op knooppunten cubemaps/panorama's renderen, aan elkaar knopen | Static hosting, mini bestanden | Zeer scherp | "Teleport" i.p.v. vrij lopen |
| **Pixel Streaming on-demand** | GPU-server alleen spinnen als iemand kijkt | Betaal-per-gebruik i.p.v. altijd-aan | Volledige Unreal-fidelity | Koude start / infra-beheer |

**Voorlopige favorieten voor "lightweight zonder gehuurde servers":** Gaussian
Splatting en Baked glTF (renderwerk op client, alleen static hosting nodig).

## Link met deze repo (ShapeR)

ShapeR reconstrueert 3D-meshes (GLB) uit casual foto-captures
(`infer_shape.py` → `.glb`). Natuurlijke pipelines richting een walkthrough:

- **foto's → ShapeR-reconstructie → GLB → in-browser walkthrough** (three.js met
  vrij-lopen navigatie), of
- **foto's → Gaussian Splat → in-browser viewer.**

## Open vragen (in te vullen)

- Use-case: vastgoed / architectuur / anders?
- Verwacht aantal gelijktijdige kijkers?
- Doelplatform: mobiel, desktop, of beide?
- Gewenste navigatie: vrij lopen (WASD/joystick) of node-tour?

## Volgende stappen (te bepalen)

- [ ] Oorspronkelijk gesprek terugvinden en kernbeslissingen hierheen kopiëren.
- [ ] Aanpak kiezen (splatting vs. baked glTF vs. node-tour).
- [ ] Eventueel kleine proof-of-concept in-browser viewer.

---

### Vindplaats oude gesprek

Branchnaam als zoekterm in de Claude-geschiedenis: `unreal`, `walkthrough`,
`lightweight`, of filter op de **ShapeR**-repo.
