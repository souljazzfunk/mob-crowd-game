# Emberline

A browser game. Drag a hearth cannon along the bottom of a lane. It fires a steady column of embers upward. Steer that column through gates: **x2** and **x3** multiply it, **+10** (and other additions) grow it, and minus gates cut it back. Embers trade one for one with the raiders drifting down. Whatever is left strikes the crown. Drain the crown to clear the stage. If raiders reach the hearth and its health hits zero, the line breaks.

Three stages, each meaner than the last: **Kindling Yard**, **Cinder Span**, and **Crown Kiln**. Kindling Yard is meant to fall in about a minute or two if you hold a multiply gate. After the third crown, Next opens an all-clear screen, and Next there starts again at stage 1.

## Run locally

The game is static files. `index.html` is the entry point. From this folder:

```bash
python3 -m http.server 8000
```

Open http://localhost:8000/

Any other static file server works. Scripts and styles use relative paths (`./game.js`, `./style.css`), so the page also loads when it is hosted under a subpath.

## Controls

- Mouse or touch: press and drag sideways to move the cannon. It keeps firing while you aim.
- Keyboard: Left / Right or A / D nudge the cannon. Enter starts from the title screen.
- Start begins stage 1. After a clear, Next advances and Retry replays the stage. On a loss, Retry tries the same stage again.

## Smoke test

The playable game does not need npm. The headless check does:

```bash
npm install
npx playwright install chromium
npm test
```

`npm test` serves this folder and runs a desktop Chrome pass (1280×800) plus an iPhone-sized touch pass. It drags the cannon, checks that a gate changes the ember count, and opens the win and lose screens. A `?debug=1` query turns on test hooks (speed, bot aim, forced outcomes). Without that query the hooks stay off.
