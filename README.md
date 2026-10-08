# Temperature Card

A custom Home Assistant Lovelace card for temperature sensors.

The goal is a compact, readable, theme-aware temperature dashboard card.
**This project is in early development.** Configurable color ranges,
history, and a visual editor are not built yet.

## What it does today

- Shows one or more sensors as a grid of cells. Each cell shows a name, the
  current temperature (large, with a smaller raised unit), and optionally the
  current humidity (as a percentage, e.g. `52%`; `--%` when it has no
  reading) and a small battery indicator.
- The number of columns follows the card's own width (one column when
  narrow, up to four when wide), and text in each cell scales with that
  cell's width.
- Shows numbers with the card's `temperature_precision` and
  `humidity_precision` (not each entity's display precision), in your Home
  Assistant number format and with the entity's unit.
- Shows "Unavailable", "No reading", or "Entity not found" (and the humidity
  equivalents) instead of a value when there is nothing to show.
- Takes its colors from the active Home Assistant theme and uses Home
  Assistant's font. Each sensor is a softly tinted panel with a thin accent
  rail, so cells stay clearly separated even in themes whose card and
  background colors are identical (for example Graphite E-ink Dark).
- Colors each sensor's accent rail by its current temperature (see below).
- Optionally arranges sensors into named groups shown one at a time behind a
  row of tabs, with roll-up cells that show the average of several sensors
  (see [Groups](#groups)).

## Accent rail color

The thin rail on the left of each sensor is colored automatically from the
current temperature. Nothing needs configuring: the bands and colors are
built in.

| Temperature | Rail |
| --- | --- |
| below 32 °F | freezing: ice blue |
| 32 °F to below 50 °F | cold: blue |
| 50 °F to below 65 °F | cool: teal |
| 65 °F to below 78 °F | normal: green |
| 78 °F to below 90 °F | warm: amber |
| 90 °F and above | hot: red |

Celsius (and kelvin) sensors are classified at the same physical
temperatures, e.g. 0 °C is "cold" and 25.6 °C is "warm". If a sensor has no
usable reading or an unrecognized unit, its rail keeps the theme's accent
color. Only the rail changes; the temperature text and everything else stay
in the theme's colors.

## Status

`v0.1.0-baseline` is the known-good baseline before temperature-range
coloring: responsive multi-sensor grid, optional humidity, card-wide
precision options, `temp_entity` / `humidity_entity` configuration,
theme-derived panels with an accent rail, and the visible build tag. Since
then: battery indicators, larger names, percentage-only humidity, and
automatic rail colors.

`v0.2.0-baseline` is the known-good baseline before groups. Groups, tabs,
and roll-up averages were added after it; a card without `groups` renders
exactly as it did at `v0.2.0-baseline`.

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

  - name: Kitchen Freezer
    temp_entity: sensor.kitchen_kitchen_freezer_temperature
    humidity_entity: sensor.kitchen_kitchen_freezer_humidity
    battery_entity: sensor.kitchen_kitchen_freezer_battery
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
| `sensors` | List of sensors, shown in this order (or arranged by `groups`). |
| `groups` | Optional ordered list of groups shown as tabs. See [Groups](#groups). |
| `temperature_precision` | Decimals shown for every temperature on the card: a whole number from 0 to 3. Default `1` (e.g. `77.5 °F`). |
| `humidity_precision` | Decimals shown for every humidity on the card: a whole number from 0 to 3. Default `0` (e.g. `52%`). |

The precision options apply to the whole card and take the place of each
entity's display precision setting in Home Assistant. Numbers still use your
Home Assistant number format (decimal separator and grouping) and the
entity's unit.

Each item in `sensors`:

| Key | Required | Description |
| --- | --- | --- |
| `temp_entity` | Yes | Temperature entity. |
| `humidity_entity` | No | Humidity entity shown under the temperature. Omit it and no humidity line is shown. |
| `battery_entity` | No | Battery-level entity (percent) shown as a small indicator at the bottom right of the cell. Omit it and no battery is shown. |
| `name` | No | Display name. Defaults to the temperature entity's friendly name, then its entity ID. |
| `id` | No | Short identifier (e.g. `kitchen_fridge`) used to refer to this sensor from `groups`. Must be unique. Has no effect without `groups`. |

### Battery indicator

The battery sits at the bottom right of its sensor's cell, beside the
humidity line when there is one. It is a small drawn battery whose bars
show the level, plus the percentage:

| Level | Bars | Shown as |
| --- | --- | --- |
| 90–100% | 4 | normal |
| 65–89% | 3 | normal |
| 40–64% | 2 | normal |
| 15–39% | 1 | low: the battery takes the theme's warning color |
| 0–14% | 0 | critical: battery and percentage take the theme's error color |

In very narrow cells that also show humidity, only the battery icon is
shown; the exact percentage is still available as its tooltip. An unavailable, unknown,
or missing battery entity shows a faint dashed outline instead of a level;
it never affects the temperature or humidity.

## Groups

Add a top-level `groups` list to split the sensors into named views. The
card then shows a row of tabs, one per group in the order listed, and
below it the cells of the selected group. Each sensor you want to use in a
group needs an `id`.

```yaml
type: custom:temperature-card
sensors:
  - id: kitchen_fridge
    name: Kitchen Fridge
    temp_entity: sensor.kitchen_kitchen_fridge_temperature
    humidity_entity: sensor.kitchen_kitchen_fridge_humidity
    battery_entity: sensor.kitchen_kitchen_fridge_battery

  - id: hallway
    name: Hallway
    temp_entity: sensor.hallway_ecobee_thermostat_current_temperature
    humidity_entity: sensor.hallway_ecobee_thermostat_current_humidity

  - id: upstairs
    name: Upstairs
    temp_entity: sensor.upstairs_landing_ecobee_sensor_temperature

groups:
  - id: overview
    name: Overview
    items:
      - name: Inside
        average: [hallway, upstairs]
        open_group: inside

  - id: inside
    name: Inside
    items:
      - hallway
      - upstairs

  - id: kitchen
    name: Kitchen
    items:
      - kitchen_fridge
```

Each group:

| Key | Required | Description |
| --- | --- | --- |
| `id` | Yes | Unique identifier of the group. |
| `name` | Yes | Tab label. |
| `items` | Yes | Cells shown in this group, in order (at least one). |

Each item in `items` is one of:

- **A sensor id** (e.g. `- hallway`): shows that sensor's normal cell, exactly
  as it looks without groups (name, temperature, humidity, battery, rail
  color). A sensor may appear in several groups.
- **A roll-up**, a mapping with:

  | Key | Required | Description |
  | --- | --- | --- |
  | `name` | Yes | Cell name. |
  | `average` | Yes | List of sensor ids to average (at least one). |
  | `open_group` | No | Group id to switch to when the cell is clicked or tapped. |

### Roll-up averages

- The temperature is the average of the members that currently have a
  numeric reading; unavailable, unknown, missing, or non-numeric members are
  left out. If none has a reading, the cell shows "Unavailable".
- Members in the same unit are averaged directly. If members use different
  units (°F, °C, K), each reading is converted to a common scale first, and
  the average is shown in Home Assistant's configured temperature unit
  (or, if that is not available, the unit of the first member with a
  reading).
- Humidity is the average of the members that have a usable humidity
  reading. If no member has one, the roll-up shows no humidity line.
- Roll-ups never show a battery indicator.
- The rail color uses the same temperature bands as a sensor cell, applied
  to the unrounded average.
- With `open_group`, the roll-up cell works as a button: click, tap, Enter,
  or Space switches the card to that group's tab. It does not navigate away
  from the dashboard.

### Switching groups

- Click or tap a tab. With the keyboard, focus the tab row: the Left and
  Right arrow keys select the previous or next tab (wrapping around at the
  ends), Home and End select the first and last tab, and Enter or Space
  selects the focused tab.
- On a touch screen, swipe left or right across the cells to move to the
  next or previous group. Swiping stops at the first and last group (it
  does not wrap around), and vertical scrolling of the page is unaffected.
- Click or tap a roll-up that has `open_group`.

If there are more tabs than fit, the tab row scrolls sideways and the
selected tab is kept in view. Switching groups plays a short slide-and-fade,
which is skipped when the system asks for reduced motion.

The first group is shown when the dashboard loads. The selected group is not
remembered across page reloads, and it is not reset by sensor updates. If
the card's configuration changes, the same group stays selected as long as
its `id` still exists; otherwise the first group is shown.

### Without groups

`groups` is optional. A card without it works and looks exactly as before:
every sensor in one grid, no tabs. Adding `id` to sensors without adding
`groups` changes nothing.

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
