# CLAUDE.md — projectcontext voor deze repo

<!-- Dit bestand wordt aan het begin van ELKE Claude Code-sessie automatisch in
     context geladen (web én terminal), zolang het in git staat. Dit is de enige
     geheugenlaag die betrouwbaar over sessies én cloud-omgevingen heen meekomt.
     Houd het kort (< 200 regels) en concreet. -->

## Wat is deze repo

Fork van **ShapeR** (facebookresearch): robuuste conditionele 3D-shape-generatie uit
casual foto-captures. Pipeline: foto's → per-object metrische SLAM-punten, poses,
captions → rectified-flow transformer op VecSet-latents → shape-code → mesh (GLB).
Inference via `infer_shape.py` (`--config quality|balance|speed`).

Werktaal met de eigenaar: **Nederlands**.

## Vaste werkwijze bij sessiestart

1. Lees dit bestand en de bestanden in **`notes/`** vóór je aan de slag gaat — daar
   staat de lopende context en besluitvorming per onderwerp.
2. Leg beslissingen en context vast in `notes/*.md` en **commit ze**. Een gesprek is
   vluchtig; alleen wat in git staat komt terug in een volgende sessie.

## Lopende sporen (naast de ShapeR-research zelf)

- **Lightweight Unreal 3D-walkthroughs** — hoe realtime 3D-walkthroughs naar
  bezoekers brengen zonder dure, altijd-aan GPU-cloudservers (het Pixel
  Streaming-kostenprobleem). Volledige context, aanpakken en open vragen:
  @notes/unreal-walkthroughs-lightweight.md
  Branch: `claude/unreal-3d-walkthroughs-lightweight-v1b7i4`.

## Belangrijk over geheugen (waarom dingen soms "verdwenen")

- **Auto-load = alleen wat in de repo gecommit staat** (dit `CLAUDE.md` + `notes/`).
- **Auto-memory** (`~/.claude/projects/.../memory/`) is **machine-lokaal** en wordt
  NIET gedeeld tussen cloud-omgevingen — in web-sessies verdwijnt die met de
  tijdelijke container. Vertrouw er niet op voor continuïteit.
- Een **Obsidian-vault wordt niet automatisch gelezen** tenzij die in de repo staat
  of via een MCP-connector beschikbaar is. Losse vault op je eigen machine ≠
  auto-geladen context. Wil je vault-inhoud standaard mee? Zet de relevante notities
  in `notes/` (of importeer ze hier met `@pad`), zodat ze in git zitten.
