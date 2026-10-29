# Hackathon decks

| File | What it is | Built by |
|---|---|---|
| `TransferHub-Full.pptx` | Full-detail deck for the panel (25 slides) | `build-full.js` |
| `TransferHub-Demo.pptx` | Short deck that walks the live demo, steps a to g (13 slides) | `build-demo.js` |
| `TransferHub-Hackathon.pptx` | Earlier 16-slide deck, kept for reference | `build-deck.js` (legacy, not maintained) |

Shared look and helpers (theme, slide layouts, cards, icons, screenshot cropping, team slide, title and closing slides) live in
`lib/kit.js`; team members and how each photo is cropped to the face live in `lib/team.js`.

## Inputs

- `screens/*.png` - screenshots taken against a mocked API, so all numbers in them are synthetic (every slide footer says so).
  A missing file renders as a labelled placeholder instead of failing the build.
- `../team/` - team photos (`<id>-<name>.jpg`), `Clopay CodeCrafters.png` (team logo), `TransferHub.png` (product logo).
  Photos are cropped and downscaled at build time; the originals are not modified.

## Rebuild

Dependencies: Node 18+, `pptxgenjs`, `react`, `react-dom`, `react-icons`, `sharp`. They are not part of the app, so install them
in a scratch folder and point `NODE_PATH` at it:

```bash
mkdir -p /tmp/deck-deps && cd /tmp/deck-deps
npm init -y >/dev/null
npm install pptxgenjs@3.12.0 react@18.3.1 react-dom@18.3.1 react-icons@5.3.0 sharp@0.33.5

cd <repo>/_designs/deck
NODE_PATH=/tmp/deck-deps/node_modules node build-full.js
NODE_PATH=/tmp/deck-deps/node_modules node build-demo.js
```

Theme colours are written into the file by `apply_theme.js` from the Claude `pptx` skill. The scripts find it under
`/root/.claude/skills/synced/*/pptx/scripts/`; elsewhere set `APPLY_THEME=/path/to/apply_theme.js`. Without it the decks still
build (every colour is set explicitly), only the theme palette inside PowerPoint stays at Office defaults.

## Editing

- Change a fact: edit the slide's block in `build-full.js` / `build-demo.js` (one `{ ... }` block per slide, in order).
- Change the look for both decks: `lib/kit.js` (`C` colours, `createDeck` layouts, `teamSlide`, `titleSlide`, `closeSlide`).
- New screenshot: drop it in `screens/` and reference it with `k.shot(slide, 'file.png', x, y, w, h, 'alt text', { top: 0.1 })`
  (`top` = fraction of the image height to start the crop from).
- Numbers on the slides come from `../GAP_ANALYSIS.md`, `../DISCOVERY.md` and `../../docs/DEMO_SCRIPT.md`. The only accuracy
  figures are the built-in rules matcher backtest (63 decisions, top-1 88.9%, top-3 96.8%); no AI accuracy is claimed.
