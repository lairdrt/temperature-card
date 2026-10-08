# Temperature Card

A custom Home Assistant Lovelace card for temperature sensors.

The goal is a compact, readable, theme-aware temperature dashboard card.
**This project is in early development.** Groups, averages, color ranges,
history, and a visual editor are not built yet.

## What it does today

- Shows one or more sensors as a grid of cells. Each cell shows a name, the
  current temperature (large, with a smaller raised unit), and optionally the
  current humidity.
- The number of columns follows the card's own width (one column when
  narrow, up to four when wide), and text in each cell scales with that
  cell's width.
- Formats values with Home Assistant's own formatter where available, so each
  sensor's display precision and your number format are respected.
- Shows "Unavailable", "No reading", or "Entity not found" (and the humidity
  equivalents) instead of a value when there is nothing to show.
- Takes all colors from the active Home Assistant theme and uses Home
  Assistant's font. Each sensor is a softly tinted panel with a thin accent
  rail in the theme's accent color, so cells stay clearly separated even in
  themes whose card and background colors are identical (for example
  Graphite E-ink Dark).

## Examples

Several sensors:

```yaml
type: custom:temperature-card
sensors:
  - name: Garage Fridge
    temp_entity: sensor.garage_fridge_temperature

  - name: Hallway
    temp_entity: sensor.home_current_temperature
    humidity_entity: sensor.home_current_humidity
```

One sensor (simple shorthand):

```yaml
type: custom:temperature-card
entity: sensor.garage_fridge_temperature
```

## Options

Use either `entity` or `sensors`, not both.

| Option | Description |
| --- | --- |
| `entity` | One temperature entity. Shorthand for a one-item `sensors` list. |
| `sensors` | List of sensors, shown in this order. |

Each item in `sensors`:

| Key | Required | Description |
| --- | --- | --- |
| `temp_entity` | Yes | Temperature entity. |
| `humidity_entity` | No | Humidity entity shown under the temperature. Omit it and no humidity line is shown. |
| `name` | No | Display name. Defaults to the temperature entity's friendly name, then its entity ID. |

### Older sensor-item keys (deprecated)

Earlier versions used `entity` and `humidity` inside each `sensors` item.
They still work, but use `temp_entity` and `humidity_entity` in new
configurations. If an item sets both the new and the old key to different
entities, the card shows a configuration error rather than guessing.
(The top-level `entity` shorthand above is not deprecated.)

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

To check which build is loaded, look at the small build tag at the bottom-left
of the card (`TEMPERATURE <commit>-<hash>`); the same line is logged to the
browser console. If you copy `dist/` by hand instead, the tag shows the
literal placeholder, which is expected.

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
