# Temperature Card

A custom Home Assistant Lovelace card for temperature sensors.

The goal is a compact, readable, theme-aware temperature dashboard card.
**This project is in early development.** The card currently shows the
current reading of one sensor, and nothing else.

## What it does today

- Shows one sensor's friendly name and its current temperature, with the unit
  Home Assistant reports.
- Formats the value with Home Assistant's own formatter where available, so
  the sensor's display precision and your number format are respected.
- Shows "Unavailable", "No reading", or "Entity not found" instead of a value
  when there is nothing to show.
- Takes all colors from the active Home Assistant theme and uses Home
  Assistant's font.

## Example

```yaml
type: custom:temperature-card
entity: sensor.living_room_temperature
```

`entity` is required and is the only option.

## Build

```powershell
npm install
npm run build
```

This produces `dist/temperature-card.js`. `loader.js` lives at the repository
root.

## Install into Home Assistant

There is no HACS package. The card is built from source.

1. Create `/config/www/temperature-card/` in Home Assistant. Home Assistant
   serves `/config/www/` as `/local/`.
2. Put `temperature-card.js` (from `dist/`) and `loader.js` in that directory.
   On Windows with the HA config share mapped as `Z:`, `.\deploy.ps1` does
   this for you (see below).
3. In **Settings → Dashboards → ⋮ → Resources**, add exactly one resource:

   | URL | Resource type |
   | --- | --- |
   | `/local/temperature-card/loader.js` | JavaScript module |

   Do **not** also register `temperature-card.js`. The loader imports it
   with a fresh `?ts=` query on each page load, so new deployments are picked
   up without editing the resource or fighting the browser cache.
4. Add a card using the YAML above, then reload the page.

## Deploy

```powershell
.\deploy.ps1
```

`deploy.ps1` expects the HA config share at `Z:` (edit `$HaConfigShare`
otherwise), an existing `Z:\www\temperature-card\` directory, Git in `PATH`,
and at least one commit in this repository. It:

1. runs `npm run build`;
2. hashes `dist/temperature-card.js` and `loader.js` into a manifest;
3. replaces the `__TEMPERATURE_CARD_BUILD__` placeholder in memory with
   `TEMPERATURE <short-commit>-<manifest-hash>`;
4. writes that copy and `loader.js` to `Z:\www\temperature-card\`;
5. verifies the deployed files and build line.

It only writes into `www\temperature-card` and refuses any other destination.
It never touches Home Assistant's `.storage`.

To check which build is loaded, open the browser console and look for the
`temperature-card TEMPERATURE ...` line. If you copy `dist/` by hand instead,
that line shows the literal placeholder, which is expected.

## Development

```powershell
npm run typecheck   # tsc --noEmit
npm run build       # vite build -> dist/
npm run dev         # rebuild on change
```

Source: `src/temperature-card.ts`. `dist/` is generated and ignored by Git.
Project rules for contributors and AI assistants are in `CLAUDE.md`.

## License

GPL-3.0-only. See `LICENSE`.
