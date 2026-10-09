/**
 * temperature-card: a Home Assistant Lovelace card showing the current
 * readings of one or more temperature sensors, each with optional humidity,
 * as a responsive grid of cells.
 *
 * Deliberately a single file at this size. It is a plain custom element
 * with a shadow root (the same pattern as yardian-card) and has no runtime
 * dependencies.
 */

/**
 * Build identifier. The placeholder is left untouched in source and in
 * dist/; deploy.ps1 replaces it only in the copy written to Home Assistant,
 * with "TEMPERATURE <git short hash>-<manifest hash>". It is shown at the
 * bottom-left of the card and logged to the browser console on load, so it
 * is always clear which build Home Assistant actually loaded.
 */
export const TEMPERATURE_CARD_BUILD = "__TEMPERATURE_CARD_BUILD__";

/** Minimal Home Assistant types: only the shape this card actually reads. */
interface HassEntity {
  entity_id: string;
  state: string;
  attributes: {
    friendly_name?: string;
    unit_of_measurement?: string;
    [key: string]: unknown;
  };
}

/** One piece of a formatted state, as returned by HA's formatter. */
interface ValuePart {
  type: "value" | "literal" | "unit";
  value: string;
}

interface HomeAssistant {
  states: Record<string, HassEntity>;
  /**
   * HA's own state formatter, which applies the entity's display precision
   * and the user's number format. Optional because older HA versions do
   * not provide it; the card then falls back to the raw state.
   */
  formatEntityStateToParts?: (stateObj: HassEntity) => ValuePart[];
  /** The user's language and number-format preference (HA profile settings). */
  locale?: { language?: string; number_format?: string; time_format?: string; time_zone?: string };
  language?: string;
  /** HA's unit system; its temperature unit is used for mixed-unit roll-ups. */
  config?: { unit_system?: { temperature?: string }; time_zone?: string };
  /** HA's WebSocket call, used only to read recorder history for the graphs. */
  callWS?: <T>(message: Record<string, unknown>) => Promise<T>;
}

/**
 * One cell of the grid, in the single internal shape that every accepted
 * config form is normalized to (see normalizeConfig).
 */
interface SensorConfig {
  /** Temperature entity (required). */
  temp_entity: string;
  /** Optional humidity entity shown under the temperature. */
  humidity_entity?: string;
  /** Optional battery-level entity shown as a small indicator, bottom right. */
  battery_entity?: string;
  /** Optional display name; defaults to the temperature entity's friendly name. */
  name?: string;
  /** Optional id, needed only when a group refers to this sensor. */
  id?: string;
}

/** One cell of a group: a sensor, or a roll-up averaging several sensors. */
type GroupItem =
  | { kind: "sensor"; sensor: SensorConfig }
  | { kind: "average"; name: string; members: SensorConfig[]; openGroup?: string };

/** One tab: a named, ordered list of cells. */
interface GroupConfig {
  id: string;
  name: string;
  items: GroupItem[];
}

/**
 * Normalized configuration. The top-level single-sensor shorthand
 * (`entity:`) becomes a one-item `sensors` list, so there is only one
 * rendering path for cells. Without `groups` every sensor is shown, as
 * before; with them the card shows one group (tab) at a time.
 */
interface TemperatureCardConfig {
  sensors: SensorConfig[];
  /** Ordered groups (tabs), or undefined for the plain all-sensors grid. */
  groups?: GroupConfig[];
  /** Decimals shown for temperatures (card-wide). */
  temperaturePrecision: number;
  /** Decimals shown for humidity (card-wide). */
  humidityPrecision: number;
  /** Corner of every sensor cell that holds the battery icon (card-wide). */
  batteryPosition: BatteryPosition;
  /** Battery icon upright (terminal at the top) or sideways (terminal to the right). */
  batteryOrientation: BatteryOrientation;
}

const BATTERY_POSITIONS = ["upper-left", "upper-right", "lower-left", "lower-right"] as const;
type BatteryPosition = (typeof BATTERY_POSITIONS)[number];
const BATTERY_ORIENTATIONS = ["horizontal", "vertical"] as const;
type BatteryOrientation = (typeof BATTERY_ORIENTATIONS)[number];
const DEFAULT_BATTERY_POSITION: BatteryPosition = "upper-right";
const DEFAULT_BATTERY_ORIENTATION: BatteryOrientation = "vertical";

const DEFAULT_TEMPERATURE_PRECISION = 1;
const DEFAULT_HUMIDITY_PRECISION = 0;
const MAX_PRECISION = 3;

/** States that mean "there is no reading", with the text shown for each. */
const NO_READING_LABELS: Record<string, string> = {
  unavailable: "Unavailable",
  unknown: "No reading",
};

const NO_HUMIDITY_READING_LABELS: Record<string, string> = {
  unavailable: "Humidity unavailable",
  unknown: "No humidity reading",
};

/**
 * Automatic accent-rail colouring. Deliberately opinionated internal
 * constants, not configuration: each cell's rail takes the colour of the
 * band its current temperature falls in, using min <= value < max. Bands
 * are defined in °F; readings in other units are compared against the
 * same physical temperatures (see temperatureState).
 */
type TemperatureState = "freezing" | "cold" | "cool" | "normal" | "warm" | "hot";

/** Upper bound (°F, exclusive) of each band, coldest first. */
const TEMPERATURE_THRESHOLDS_F: ReadonlyArray<{ below: number; state: TemperatureState }> = [
  { below: 32, state: "freezing" },
  { below: 50, state: "cold" },
  { below: 65, state: "cool" },
  { below: 78, state: "normal" },
  { below: 90, state: "warm" },
  { below: Infinity, state: "hot" },
];

/**
 * Rail colours. Fixed (not theme variables) because this is data
 * visualisation: themes such as Graphite E-ink map HA's semantic colours to
 * near-identical greys. Mid-tone, not neon, and separated by hue as well as
 * lightness (ice blue, blue, cyan-teal, green, amber, red) so neighbouring
 * bands stay distinct on both dark and light cells. Tuned for the rail
 * being drawn at 70% over the cell surface.
 */
const TEMPERATURE_STATE_COLORS: Record<TemperatureState, string> = {
  freezing: "#7dccf2",
  cold: "#6290f2",
  cool: "#19b0c4",
  normal: "#4fb66a",
  warm: "#eb9a30",
  hot: "#f25a52",
};

/** °F <-> the entity's unit, for the units HA uses for temperature. */
const FROM_FAHRENHEIT: Record<string, (f: number) => number> = {
  "°F": (f) => f,
  "℉": (f) => f,
  "°C": (f) => ((f - 32) * 5) / 9,
  "℃": (f) => ((f - 32) * 5) / 9,
  K: (f) => ((f - 32) * 5) / 9 + 273.15,
};

/** The entity's unit -> °F (inverse of FROM_FAHRENHEIT), for mixed-unit roll-ups. */
const TO_FAHRENHEIT: Record<string, (v: number) => number> = {
  "°F": (v) => v,
  "℉": (v) => v,
  "°C": (v) => (v * 9) / 5 + 32,
  "℃": (v) => (v * 9) / 5 + 32,
  K: (v) => ((v - 273.15) * 9) / 5 + 32,
};

/**
 * The band for a temperature state, or undefined when there is no usable
 * reading (missing, unavailable, non-numeric) or the unit is not a known
 * temperature unit. The raw, unrounded state is compared against the band
 * limits converted into the entity's own unit.
 */
function temperatureState(stateObj: HassEntity | undefined): TemperatureState | undefined {
  if (!stateObj || stateObj.state.trim() === "") return undefined;
  const value = Number(stateObj.state);
  const fromF = FROM_FAHRENHEIT[String(stateObj.attributes.unit_of_measurement ?? "").trim()];
  if (!Number.isFinite(value) || !fromF) return undefined;
  return TEMPERATURE_THRESHOLDS_F.find((band) => value < fromF(band.below))?.state;
}

/**
 * Colors come only from Home Assistant theme variables, with no literal
 * fallbacks. ha-card supplies the themed background and primary text
 * color, which names and values inherit. If --secondary-text-color were
 * ever undefined, the declaration falls back to the inherited (primary)
 * color instead of a hard-coded one. The font family is inherited from
 * Home Assistant.
 *
 * Grid: auto-fit columns with a 220px minimum cell width, capped at four
 * columns, so the column count follows the card's own width (not the
 * viewport) and narrow cards drop to one column. No breakpoints.
 *
 * Cells: each cell is a size container, so its text scales with that
 * cell's width (cqi), not the whole card's. clamp() bounds keep every size
 * readable; each clamp() is preceded by a fixed rem size for browsers
 * without container units. Corners follow the theme's card radius (same
 * chain as ha-card), scaled down.
 *
 * Cell design: each sensor is a panel defined by its surface, not by an
 * outline, plus one accent rail. The surface must stay clearly visible
 * even in themes whose card, page and secondary backgrounds are identical
 * (e.g. Graphite E-ink Dark: all black). A var() fallback only helps when
 * a variable is undefined, not when it is defined but weak, so the surface
 * is a 12% tint of the theme's text color laid over the card (charcoal on
 * black, lighter tiles on dark cards, soft grey on light cards; translucent
 * cards stay translucent). With the surface doing the separating there is
 * no visible outline. Without color-mix() support the surface falls back
 * to --secondary-background-color and the outline to ha-card's own outline
 * chain (--ha-card-border-color, then --divider-color).
 *
 * Text that cannot fit wraps or, as a last resort, breaks, rather than
 * overflowing its cell, except the readings: a temperature and its unit,
 * and a humidity value and its "%", always stay together on one line. Names are limited to two lines.
 */
/**
 * History graphs appear only in cells whose content box is at least this
 * wide (rem, so it follows the browser's font size like the text). The CSS
 * container query and the card's own check (which decides whether to fetch
 * history at all) both use it.
 */
const GRAPH_MIN_CELL_REM = 30;
/** Graph geometry (rem): the text column beside it, where it starts in the cell, and its temperature-label column. */
const GRAPH_TEXT_REM = 15;
const GRAPH_LEFT_REM = 16.5;
const GRAPH_VALUES_REM = 3.25;

const STYLES = `
  :host {
    display: block;
  }

  ha-card {
    height: 100%;
    box-sizing: border-box;
    padding: 12px 12px 8px;
  }

  /* Build tag, bottom-left, below the grid. A deliberate exception to the
     1rem minimum: it is a diagnostic label, not content. */
  .build {
    margin-top: 8px;
    font-size: 0.8125rem;
    line-height: 1.25;
    letter-spacing: 0.02em;
    color: var(--secondary-text-color);
    overflow-wrap: anywhere;
  }

  .grid {
    display: grid;
    gap: 8px;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, max(220px, (100% - 3 * 8px) / 4)), 1fr));
  }

  .cell {
    position: relative;
    display: flex;
    flex-direction: column;
    container-type: inline-size;
    min-width: 0;
    box-sizing: border-box;
    padding: 16px 16px 18px 28px;
    border-radius: calc(var(--ha-card-border-radius, var(--ha-border-radius-lg, 12px)) * 0.75);
    border: 1px solid var(--ha-card-border-color, var(--divider-color));
    background: var(--secondary-background-color);
    overflow-wrap: anywhere;
  }

  @supports (background: color-mix(in srgb, currentColor 5%, transparent)) {
    .cell {
      background: color-mix(in srgb, var(--primary-text-color, currentColor) 12%, transparent);
      border-color: transparent;
    }
  }

  /* The accent rail: one per cell, inset in the left padding and running
     the cell's full content height. Its colour comes from one cell-level
     custom property, --temperature-card-accent, which is only ever read
     here (never declared), so a theme or future per-cell code (e.g.
     temperature ranges) can set it; otherwise it is the theme's accent. */
  .accent {
    position: absolute;
    left: 11px;
    top: 16px;
    bottom: 18px;
    width: 3px;
    border-radius: calc(var(--ha-card-border-radius, var(--ha-border-radius-lg, 12px)) / 4);
    background: var(--temperature-card-accent, var(--primary-color, currentColor));
  }

  @supports (background: color-mix(in srgb, currentColor 5%, transparent)) {
    .accent {
      background: color-mix(in srgb, var(--temperature-card-accent, var(--primary-color, currentColor)) 70%, transparent);
    }
  }

  /* Weights follow the theme but are capped at 600: some themes (e.g.
     Graphite E-ink, 900) set very heavy body weights that make large
     numerals look blocky. Lighter theme weights are used unchanged. */
  .name {
    font-size: 1.375rem;
    font-size: clamp(1.25rem, 10cqi, 1.625rem);
    font-weight: min(var(--ha-font-weight-medium, 500), 600);
    line-height: 1.25;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
  }

  .reading {
    display: flex;
    flex-wrap: nowrap;
    align-items: flex-start;
    column-gap: 0.08em;
    min-height: 1em;
    margin-top: 0.375rem;
    font-size: 3.5rem;
    font-size: clamp(min(2.75rem, 33cqi), 33cqi, 6rem);
    line-height: 1;
  }

  .reading > *,
  .humidity > * {
    min-width: 0;
  }

  /* The value and its unit are one unbreakable unit: neither shrinks, wraps
     or breaks inside, so the unit can never drop to a line of its own. */
  .value {
    flex: none;
    white-space: nowrap;
    font-weight: min(var(--ha-font-weight-normal, 400), 600);
    letter-spacing: -0.03em;
  }

  /* Smaller and raised: margin-top lines the top of the unit up with the
     top of the numerals. */
  .unit {
    flex: none;
    white-space: nowrap;
    font-size: max(1.125rem, 0.38em);
    margin-top: 0.2em;
    color: var(--secondary-text-color);
  }

  .status {
    align-self: center;
    font-size: max(1.125rem, 0.32em);
    line-height: 1.2;
    color: var(--secondary-text-color);
  }

  /* Humidity: just the percentage ("54%"), left-aligned with the
     temperature, as a clearly secondary readout in the primary text colour.
     The word "humidity" is only in the tooltip and for screen readers. The
     gap above it separates it from the numerals' descent so it reads as its
     own line. With no reading it shows "--%" in the secondary colour. */
  .humidity {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: 0.4rem;
    margin-top: 0.75rem;
    line-height: 1.1;
  }

  .humidity-value {
    white-space: nowrap;
    font-size: 2rem;
    font-size: clamp(1.75rem, 18cqi, 2.5rem);
    font-weight: min(var(--ha-font-weight-normal, 400), 600);
  }

  .humidity--no-reading .humidity-value {
    color: var(--secondary-text-color);
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    border: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  /* Battery: a small MDI battery icon (HA's own ha-icon) floating in one
     corner of the whole cell (battery_position), outside the content flow.
     The icon alone shows the level; the exact percentage is in its tooltip
     and accessible label. Tertiary: the theme's secondary text colour, the
     warning colour when low, the error colour when critical. */
  .battery {
    position: absolute;
    display: flex;
    width: 1.25rem;
    height: 1.25rem;
    color: var(--secondary-text-color);
    --mdc-icon-size: 1.25rem;
    --icon-primary-color: currentColor;
  }

  .battery--low {
    color: var(--warning-color, var(--secondary-text-color));
  }

  .battery--critical {
    color: var(--error-color, var(--secondary-text-color));
  }

  .battery--unavailable {
    opacity: 0.5;
  }

  /* An upright MDI battery glyph (terminal at the top) fills the middle
     half of its square box across and 20/24 of it down; turned sideways
     (terminal to the right) the reverse. These are the gaps between the box
     and the glyph, and the glyph's width, for each orientation. */
  .cell--battery-vertical {
    --battery-inset-x: calc(1.25rem / 4);
    --battery-inset-y: calc(1.25rem / 12);
    --battery-glyph-width: calc(1.25rem / 2);
  }

  .cell--battery-horizontal {
    --battery-inset-x: calc(1.25rem / 12);
    --battery-inset-y: calc(1.25rem / 4);
    --battery-glyph-width: calc(1.25rem * 5 / 6);
  }

  .cell--battery-horizontal > .battery ha-icon {
    transform: rotate(90deg);
  }

  /* Corners of the whole cell: the glyph's edges line up with the content
     edges (left 28px, clear of the accent rail; right 16px; bottom 18px,
     where the rail ends). Upper corners are centred on the name's first
     line. */
  .cell--battery-upper-left > .battery,
  .cell--battery-upper-right > .battery {
    top: calc(16px + (1.25 * 1.375rem - 1.25rem) / 2);
    top: calc(16px + (1.25 * clamp(1.25rem, 10cqi, 1.625rem) - 1.25rem) / 2);
  }

  .cell--battery-lower-left > .battery,
  .cell--battery-lower-right > .battery {
    bottom: calc(18px - var(--battery-inset-y));
  }

  .cell--battery-upper-left > .battery,
  .cell--battery-lower-left > .battery {
    left: calc(28px - var(--battery-inset-x));
  }

  .cell--battery-upper-right > .battery,
  .cell--battery-lower-right > .battery {
    right: calc(16px - var(--battery-inset-x));
  }

  /* The text on the battery's side keeps clear of it: the name in the upper
     corners; in the lower left, the bottom line of text (the humidity, or
     the temperature in a cell without humidity), whose digits reach down to
     the content edge. Lower-right needs nothing: text is left-aligned. */
  .cell--battery-upper-right > .name {
    padding-right: calc(var(--battery-glyph-width) + 0.5rem);
  }

  .cell--battery-upper-left > .name {
    padding-left: calc(var(--battery-glyph-width) + 0.5rem);
  }

  .cell--battery-lower-left > .humidity,
  .cell--battery-lower-left.cell--battery-only > .reading {
    padding-left: calc(var(--battery-glyph-width) + 0.5rem);
  }

  /* In a cell narrow enough that the temperature scales with it (below its
     2.75rem floor), a temperature inset beside a lower-left battery scales
     with the width left beside the battery, so it still fits on one line. */
  @container (max-width: 8.33rem) {
    .cell--battery-lower-left.cell--battery-only > .reading {
      font-size: calc(0.33 * (100cqi - var(--battery-glyph-width) - 0.5rem));
    }
  }

  /* A battery-only cell keeps the height it had when the battery sat in a
     tier of its own at the bottom (that tier's net height), so moving the
     battery changes no cell's height and no graph's size. */
  .cell--battery-only > .reading {
    margin-bottom: 0.4375rem;
    margin-bottom: calc(clamp(0.875rem, 6.5cqi, 1rem) - 0.5rem);
  }

  /* Groups (only when 'groups' is configured; none of these selectors match
     the plain all-sensors card). A quiet text tab strip above the grid: the
     active tab is in the primary text colour with a short accent underline.
     It scrolls sideways rather than wrapping. */
  .grouped {
    overflow-x: clip;
  }

  .tabs {
    display: flex;
    gap: 2px;
    margin: -4px 0 8px;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
  }

  .tabs::-webkit-scrollbar {
    display: none;
  }

  .tab {
    position: relative;
    flex: none;
    max-width: 85%;
    overflow: hidden;
    text-overflow: ellipsis;
    margin: 0;
    padding: 6px 12px 9px;
    border: 0;
    border-radius: 4px;
    background: none;
    color: var(--secondary-text-color);
    font: inherit;
    font-size: 1.0625rem;
    font-weight: min(var(--ha-font-weight-medium, 500), 600);
    line-height: 1.25;
    white-space: nowrap;
    cursor: pointer;
  }

  .tab::after {
    content: "";
    position: absolute;
    left: 12px;
    right: 12px;
    bottom: 2px;
    height: 2px;
    border-radius: 1px;
  }

  .tab:hover,
  .tab[aria-selected="true"] {
    color: var(--primary-text-color);
  }

  .tab[aria-selected="true"]::after {
    background: var(--primary-color, currentColor);
  }

  .tab:focus-visible,
  .cell--link:focus-visible {
    outline: 2px solid var(--primary-color, currentColor);
    outline-offset: -2px;
  }

  /* Horizontal swipes on the grid switch groups; vertical scrolling stays
     with the browser. */
  .grouped .grid {
    touch-action: pan-y;
  }

  .cell--link {
    cursor: pointer;
  }

  @supports (background: color-mix(in srgb, currentColor 5%, transparent)) {
    .cell--link:hover {
      background: color-mix(in srgb, var(--primary-text-color, currentColor) 16%, transparent);
    }
  }

  /* A short fade-and-slide when switching groups. */
  .grid.switch-next {
    animation: switch-next 150ms ease-out;
  }

  .grid.switch-prev {
    animation: switch-prev 150ms ease-out;
  }

  @keyframes switch-next {
    from { opacity: 0; transform: translateX(10px); }
  }

  @keyframes switch-prev {
    from { opacity: 0; transform: translateX(-10px); }
  }

  @media (prefers-reduced-motion: reduce) {
    .grid.switch-next,
    .grid.switch-prev {
      animation: none;
    }
  }

  /* History graph (only cells with history and room for it; none of these
     rules affect a cell without a graph). The existing content keeps the
     left part of the cell at its normal sizes; the graph fills the rest of
     the cell's height on the right, positioned so it never adds height, and
     ignores the pointer so taps and swipes reach the cell as before. */
  .graph {
    display: none;
  }

  @container (min-width: ${GRAPH_MIN_CELL_REM}rem) {
    .cell--graph > .graph {
      display: block;
      position: absolute;
      top: 16px;
      bottom: 18px;
      left: calc(28px + var(--graph-text-column, ${GRAPH_TEXT_REM}rem) + ${GRAPH_LEFT_REM - GRAPH_TEXT_REM}rem);
      right: 16px;
      pointer-events: none;
    }

    /* A sensor's graph (not a roll-up's) opens HA's history for that sensor
       on double-click / double-tap, or Enter / Space. It takes the pointer
       for that only; swipes still reach the grid (its pan-y touch-action
       applies here too). */
    .cell--graph > .graph--action {
      pointer-events: auto;
      cursor: pointer;
      touch-action: manipulation;
      user-select: none;
      -webkit-user-select: none;
      -webkit-tap-highlight-color: transparent;
    }

    .cell--graph > .graph--action:focus-visible {
      outline: 2px solid var(--primary-color, currentColor);
      outline-offset: 4px;
      border-radius: 4px;
    }

    .cell--graph > .name,
    .cell--graph > .reading,
    .cell--graph > .humidity {
      max-width: var(--graph-text-column, ${GRAPH_TEXT_REM}rem);
    }

    .cell--graph > .name {
      box-sizing: border-box;
    }

    /* A battery in a right corner stays at the cell's own right edge, beyond
       the graph: the graph ends one battery width (plus a gap) earlier, so
       the battery never covers the line or the axis labels. The name, now
       far from it, needs no inset. */
    .cell--graph.cell--battery-upper-right > .graph,
    .cell--graph.cell--battery-lower-right > .graph {
      right: calc(16px + var(--battery-glyph-width) + 0.5rem);
    }

    .cell--graph.cell--battery-upper-right > .name {
      padding-right: 0;
    }
  }

  /* Plot on the left, temperature labels in a column on its right, time
     labels in a row underneath. The plot has no fill or background of its
     own: the cell surface shows through evenly from edge to edge. */
  .graph-plot {
    position: absolute;
    top: 0;
    left: 0;
    width: calc(100% - ${GRAPH_VALUES_REM}rem);
    height: calc(100% - 1.5rem);
    overflow: visible;
  }

  .graph-guide {
    fill: none;
    stroke: var(--divider-color);
    stroke: color-mix(in srgb, var(--primary-text-color, currentColor) 14%, transparent);
    stroke-width: 1px;
    vector-effect: non-scaling-stroke;
  }

  .graph-line {
    fill: none;
    stroke: var(--primary-color, currentColor);
    stroke-width: 1.5px;
    stroke-linejoin: round;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
  }

  .graph-values {
    position: absolute;
    top: 0;
    right: 0;
    width: calc(${GRAPH_VALUES_REM}rem - 0.5rem);
    height: calc(100% - 1.5rem);
  }

  .graph-times {
    position: absolute;
    left: 0;
    bottom: 0;
    width: calc(100% - ${GRAPH_VALUES_REM}rem);
    height: 1rem;
  }

  .graph-tick,
  .graph-time {
    position: absolute;
    font-size: 1rem;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    color: var(--secondary-text-color);
  }

  .graph-tick {
    left: 0;
    transform: translateY(-50%);
  }

  .graph-time {
    top: 0;
  }

  .graph-time--middle {
    transform: translateX(-50%);
  }

  .graph-time--end {
    transform: translateX(-100%);
  }
`;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const USAGE =
  "Set 'entity' to a temperature sensor, e.g. entity: sensor.living_room_temperature, " +
  "or list several under 'sensors', each with a 'temp_entity'.";

function describeType(value: unknown): string {
  if (Array.isArray(value)) return "a list";
  if (typeof value === "object") return "a mapping";
  return `a ${typeof value}`;
}

/**
 * An optional text field, trimmed. Missing or null (an empty YAML value)
 * means "not set"; anything else must be non-empty text.
 */
function textField(raw: Record<string, unknown>, key: string, where: string): string | undefined {
  const value = raw[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`${where}: '${key}' must be text, not ${describeType(value)}.`);
  if (value.trim() === "") throw new Error(`${where}: '${key}' is empty.`);
  return value.trim();
}

/**
 * An entity field that also accepts a deprecated legacy key. Both may be
 * given only if they name the same entity; otherwise it is an error rather
 * than a silent choice.
 */
function entityField(raw: Record<string, unknown>, key: string, legacyKey: string, where: string): string | undefined {
  const value = textField(raw, key, where);
  const legacy = textField(raw, legacyKey, where);
  if (value !== undefined && legacy !== undefined && value !== legacy) {
    throw new Error(
      `${where}: '${key}' (${value}) and the older '${legacyKey}' (${legacy}) name different entities. Remove '${legacyKey}'.`,
    );
  }
  return value ?? legacy;
}

/**
 * One `sensors` item. Canonical keys are temp_entity / humidity_entity /
 * battery_entity / name; the older entity / humidity keys are still
 * accepted.
 */
function normalizeSensor(item: unknown, where: string): SensorConfig {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new Error(`${where}: each sensor must be a mapping with a 'temp_entity', e.g. "- temp_entity: sensor.hallway_temperature".`);
  }
  const raw = item as Record<string, unknown>;
  const tempEntity = entityField(raw, "temp_entity", "entity", where);
  if (!tempEntity) throw new Error(`${where}: 'temp_entity' is required (the temperature sensor's entity ID).`);

  const sensor: SensorConfig = { temp_entity: tempEntity };
  const humidityEntity = entityField(raw, "humidity_entity", "humidity", where);
  const batteryEntity = textField(raw, "battery_entity", where);
  const name = textField(raw, "name", where);
  const id = textField(raw, "id", where);
  if (humidityEntity) sensor.humidity_entity = humidityEntity;
  if (batteryEntity) sensor.battery_entity = batteryEntity;
  if (name) sensor.name = name;
  if (id) sensor.id = id;
  return sensor;
}

/** Sensors by id; ids must be unique. */
function sensorsById(sensors: SensorConfig[]): Map<string, SensorConfig> {
  const byId = new Map<string, SensorConfig>();
  sensors.forEach((sensor, index) => {
    if (!sensor.id) return;
    if (byId.has(sensor.id)) throw new Error(`sensors item ${index + 1}: duplicate id '${sensor.id}'.`);
    byId.set(sensor.id, sensor);
  });
  return byId;
}

const ROLL_UP_KEYS = new Set(["name", "average", "open_group"]);

function sensorRef(value: unknown, byId: Map<string, SensorConfig>, where: string): SensorConfig {
  if (typeof value !== "string") throw new Error(`${where}: expected a sensor id, not ${describeType(value)}.`);
  const id = value.trim();
  if (id === "") throw new Error(`${where}: sensor id is empty.`);
  const sensor = byId.get(id);
  if (!sensor) throw new Error(`${where}: no sensor has id '${id}'.`);
  return sensor;
}

/**
 * One group item: a sensor id (that sensor's normal cell) or a roll-up
 * mapping { name, average: [sensor ids], open_group? }.
 */
function normalizeGroupItem(item: unknown, byId: Map<string, SensorConfig>, where: string): GroupItem {
  if (typeof item === "string") return { kind: "sensor", sensor: sensorRef(item, byId, where) };
  if (!item || typeof item !== "object" || Array.isArray(item) || !("average" in item)) {
    throw new Error(`${where}: expected a sensor id or a roll-up with 'name' and 'average'.`);
  }
  const raw = item as Record<string, unknown>;
  const unknown = Object.keys(raw).find((key) => !ROLL_UP_KEYS.has(key));
  if (unknown) throw new Error(`${where}: unknown key '${unknown}' (a roll-up has 'name', 'average' and optional 'open_group').`);
  const name = textField(raw, "name", where);
  if (!name) throw new Error(`${where}: a roll-up needs a 'name'.`);
  if (!Array.isArray(raw.average) || raw.average.length === 0) {
    throw new Error(`${where}: 'average' must be a non-empty list of sensor ids.`);
  }
  const members = raw.average.map((ref, index) => sensorRef(ref, byId, `${where} average item ${index + 1}`));
  const openGroup = textField(raw, "open_group", where);
  return openGroup ? { kind: "average", name, members, openGroup } : { kind: "average", name, members };
}

/** The `groups` list: ordered tabs, each with ordered items. */
function normalizeGroups(value: unknown, sensors: SensorConfig[]): GroupConfig[] {
  if (!Array.isArray(value)) throw new Error("'groups' must be a list of groups.");
  if (value.length === 0) throw new Error("'groups' must contain at least one group.");
  const byId = sensorsById(sensors);
  const groupWhere = new Map<string, string>();
  const groups = value.map((item, index): GroupConfig => {
    let where = `groups item ${index + 1}`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`${where}: each group must be a mapping with 'id', 'name' and 'items'.`);
    }
    const raw = item as Record<string, unknown>;
    const id = textField(raw, "id", where);
    if (!id) throw new Error(`${where}: 'id' is required.`);
    if (groupWhere.has(id)) throw new Error(`${where}: duplicate group id '${id}' (also ${groupWhere.get(id)}).`);
    groupWhere.set(id, where);
    where = `group '${id}'`;
    const name = textField(raw, "name", where);
    if (!name) throw new Error(`${where}: 'name' is required.`);
    if (!Array.isArray(raw.items) || raw.items.length === 0) throw new Error(`${where}: 'items' must be a non-empty list.`);
    const items = raw.items.map((entry, itemIndex) => normalizeGroupItem(entry, byId, `${where} item ${itemIndex + 1}`));
    return { id, name, items };
  });
  for (const group of groups) {
    group.items.forEach((item, index) => {
      if (item.kind === "average" && item.openGroup && !groupWhere.has(item.openGroup)) {
        throw new Error(`group '${group.id}' item ${index + 1}: open_group '${item.openGroup}' is not a group id.`);
      }
    });
  }
  return groups;
}

/**
 * Accepts either the top-level shorthand `entity: <id>` (one sensor) or
 * `sensors: [...]`, and returns the single normalized form that rendering
 * uses. Throws on anything else.
 */
function normalizeConfig(config: unknown): TemperatureCardConfig {
  if (!config || typeof config !== "object") throw new Error(USAGE);
  const raw = config as Record<string, unknown>;

  const precision = {
    temperaturePrecision: precisionField(raw, "temperature_precision", DEFAULT_TEMPERATURE_PRECISION),
    humidityPrecision: precisionField(raw, "humidity_precision", DEFAULT_HUMIDITY_PRECISION),
    batteryPosition: choiceField(raw, "battery_position", BATTERY_POSITIONS, DEFAULT_BATTERY_POSITION),
    batteryOrientation: choiceField(raw, "battery_orientation", BATTERY_ORIENTATIONS, DEFAULT_BATTERY_ORIENTATION),
  };

  if (raw.sensors !== undefined) {
    if (raw.entity !== undefined) {
      throw new Error("Use either 'entity' (one sensor) or 'sensors' (a list), not both.");
    }
    if (!Array.isArray(raw.sensors) || raw.sensors.length === 0) {
      throw new Error("'sensors' must be a list with at least one sensor, each with a 'temp_entity'.");
    }
    const sensors = raw.sensors.map((item, index) => normalizeSensor(item, `sensors item ${index + 1}`));
    sensorsById(sensors);
    if (raw.groups === undefined || raw.groups === null) return { sensors, ...precision };
    return { sensors, groups: normalizeGroups(raw.groups, sensors), ...precision };
  }

  if (raw.groups !== undefined && raw.groups !== null) {
    throw new Error("'groups' needs a 'sensors' list whose sensors have ids.");
  }
  if (typeof raw.entity !== "string" || raw.entity.trim() === "") throw new Error(USAGE);
  return { sensors: [{ temp_entity: raw.entity.trim() }], ...precision };
}

/** A card-wide choice from a fixed list (trimmed), or the default when omitted. */
function choiceField<T extends string>(raw: Record<string, unknown>, key: string, choices: readonly T[], fallback: T): T {
  const value = raw[key];
  if (value === undefined || value === null) return fallback;
  const text = typeof value === "string" ? value.trim() : undefined;
  const choice = choices.find((c) => c === text);
  if (choice === undefined) {
    throw new Error(`'${key}' must be one of ${choices.join(", ")} (got ${JSON.stringify(value)}).`);
  }
  return choice;
}

/** A card-wide decimal count: a whole number 0..MAX_PRECISION, or the default when omitted. */
function precisionField(raw: Record<string, unknown>, key: string, fallback: number): number {
  const value = raw[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_PRECISION) {
    throw new Error(`'${key}' must be a whole number from 0 to ${MAX_PRECISION} (got ${JSON.stringify(value)}).`);
  }
  return value;
}

/**
 * The Intl locale(s) and grouping HA uses for numbers, mirroring upstream
 * numberFormatToLocale / formatNumberToParts
 * (home-assistant/frontend src/common/number/format_number.ts), so values
 * re-formatted here match the rest of the HA UI.
 */
function numberFormat(hass: HomeAssistant): { locales: string | string[] | undefined; useGrouping: boolean } {
  switch (hass.locale?.number_format) {
    case "comma_decimal":
      return { locales: ["en-US", "en"], useGrouping: true };
    case "decimal_comma":
      return { locales: ["de", "es", "it"], useGrouping: true };
    case "space_comma":
      return { locales: ["fr", "sv", "cs"], useGrouping: true };
    case "quote_decimal":
      return { locales: ["de-CH"], useGrouping: true };
    case "none":
      return { locales: "en-US", useGrouping: false };
    case "system":
      return { locales: undefined, useGrouping: true };
    default:
      return { locales: hass.locale?.language ?? hass.language, useGrouping: true };
  }
}

/**
 * A numeric state with exactly `digits` decimals in the user's number
 * format, or undefined if the state is not a number. HA's formatter takes
 * its precision from the entity registry and has no precision argument,
 * so only the number is formatted here; units and spacing still come from
 * HA (see formatParts).
 */
function formatNumberState(hass: HomeAssistant, state: string, digits: number): string | undefined {
  if (state.trim() === "") return undefined;
  const num = Number(state);
  if (!Number.isFinite(num)) return undefined;
  const { locales, useGrouping } = numberFormat(hass);
  const options = { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping };
  try {
    return new Intl.NumberFormat(locales, options).format(num);
  } catch {
    // An unusable locale tag: fall back to the browser's own number format.
    return new Intl.NumberFormat(undefined, options).format(num);
  }
}

/**
 * A state as display parts, preferring HA's own formatter (units, unit
 * spacing, locale). The fallback is the raw state followed by the entity's
 * unit_of_measurement. For numeric states the value part is replaced by the
 * number at the card's precision; other states are left as HA formats them.
 */
function formatParts(hass: HomeAssistant, stateObj: HassEntity, digits: number): ValuePart[] {
  let parts: ValuePart[] | undefined;
  if (typeof hass.formatEntityStateToParts === "function") {
    try {
      const haParts = hass.formatEntityStateToParts(stateObj);
      if (haParts.some((part) => part.type === "value" && part.value)) parts = haParts;
    } catch {
      // Fall through to the raw state below.
    }
  }
  if (!parts) {
    parts = [{ type: "value", value: stateObj.state }];
    const unit = stateObj.attributes.unit_of_measurement;
    if (unit) parts.push({ type: "unit", value: unit });
  }

  const value = formatNumberState(hass, stateObj.state, digits);
  if (value === undefined) return parts;
  let replaced = false;
  return parts.flatMap((part) => {
    if (part.type !== "value") return [part];
    if (replaced) return [];
    replaced = true;
    return [{ type: "value", value }];
  });
}

function joinParts(parts: ValuePart[], type: ValuePart["type"]): string {
  return parts.filter((part) => part.type === type).map((part) => part.value).join("");
}

function renderTemperature(hass: HomeAssistant, stateObj: HassEntity | undefined, digits: number): string {
  if (!stateObj) return `<div class="reading"><span class="status">Entity not found</span></div>`;

  const noReadingLabel = NO_READING_LABELS[stateObj.state];
  if (noReadingLabel) return `<div class="reading"><span class="status">${noReadingLabel}</span></div>`;

  const parts = formatParts(hass, stateObj, digits);
  const value = joinParts(parts, "value");
  const unit = joinParts(parts, "unit") || stateObj.attributes.unit_of_measurement || "";
  return `
    <div class="reading">
      <span class="value">${escapeHtml(value)}</span>
      ${unit ? `<span class="unit">${escapeHtml(unit)}</span>` : ""}
    </div>
  `;
}

function renderHumidity(hass: HomeAssistant, entity: string | undefined, digits: number): string {
  if (!entity) return "";
  return renderHumidityState(hass, hass.states[entity], digits);
}

/** The humidity line for a state object (an entity's, or a roll-up's average). */
function renderHumidityState(hass: HomeAssistant, stateObj: HassEntity | undefined, digits: number): string {
  const label = stateObj ? NO_HUMIDITY_READING_LABELS[stateObj.state] : "Humidity sensor not found";
  if (!stateObj || label) {
    // No reading: a placeholder in the value's place, with the reason in
    // the tooltip and for screen readers.
    const placeholder = escapeHtml(`--${stateObj?.attributes.unit_of_measurement || "%"}`);
    return `
      <div class="humidity humidity--no-reading" title="${label}">
        <span class="visually-hidden">${label}</span>
        <span class="humidity-value" aria-hidden="true">${placeholder}</span>
      </div>
    `;
  }

  const text = escapeHtml(formattedText(hass, stateObj, digits));
  return `
    <div class="humidity" title="Humidity ${text}">
      <span class="visually-hidden">Humidity </span>
      <span class="humidity-value">${text}</span>
    </div>
  `;
}

/**
 * A state as one formatted string ("54%"), keeping HA's own spacing between
 * value and unit for the user's locale.
 */
function formattedText(hass: HomeAssistant, stateObj: HassEntity, digits: number): string {
  const parts = formatParts(hass, stateObj, digits);
  let text = parts.map((part) => part.value).join("");
  if (!parts.some((part) => part.type === "unit") && stateObj.attributes.unit_of_measurement) {
    text += stateObj.attributes.unit_of_measurement;
  }
  return text;
}

/**
 * The MDI battery icon for a whole, clamped percentage, in steps of ten:
 * 90-100% "battery", 80-89% "battery-90", ... 1-9% "battery-10", 0%
 * "battery-outline".
 */
function batteryIcon(percent: number): string {
  if (percent >= 90) return "mdi:battery";
  if (percent <= 0) return "mdi:battery-outline";
  return `mdi:battery-${Math.floor(percent / 10) * 10 + 10}`;
}

/** Low and critical are the only levels that draw attention (by colour). */
function batterySeverity(percent: number): "normal" | "low" | "critical" {
  if (percent < 15) return "critical";
  if (percent < 40) return "low";
  return "normal";
}

/**
 * A compact battery indicator: an MDI battery icon whose fill shows the
 * level, with the exact percentage in its tooltip and accessible label (no
 * visible number). Battery problems never affect the rest of the cell: a
 * missing, unavailable or non-numeric battery shows a faint unknown-battery
 * icon instead.
 */
function renderBattery(hass: HomeAssistant, entity: string | undefined): string {
  if (!entity) return "";

  const stateObj = hass.states[entity];
  const value = stateObj && stateObj.state.trim() !== "" ? Number(stateObj.state) : NaN;
  if (!stateObj || !Number.isFinite(value)) {
    const label = stateObj ? "Battery unavailable" : "Battery sensor not found";
    return `<span class="battery battery--unavailable" role="img" aria-label="${label}" title="${label}"><ha-icon icon="mdi:battery-unknown" aria-hidden="true"></ha-icon></span>`;
  }

  const percent = Math.min(100, Math.max(0, Math.round(value)));
  const text = escapeHtml(formattedText(hass, { ...stateObj, state: String(percent) }, 0));
  return `<span class="battery battery--${batterySeverity(percent)}" role="img" aria-label="Battery ${text}" title="Battery ${text}"><ha-icon icon="${batteryIcon(percent)}" aria-hidden="true"></ha-icon></span>`;
}

/** What one cell shows; sensor cells and roll-up cells both render from this. */
interface CellContent {
  name: string;
  /** Temperature state: an entity's, or a roll-up's computed average. */
  temperature: HassEntity | undefined;
  /** Humidity line markup ("" for none). */
  humidityHtml: string;
  hasHumidity: boolean;
  batteryEntity?: string;
  /** Extra classes / attributes on the cell (roll-up navigation). */
  classes?: string;
  attrs?: string;
  /** History graph markup ("" or undefined for none). */
  graphHtml?: string;
  /** Text column width in px beside the graph, when wider than the default. */
  textColumn?: number;
}

function renderCellContent(hass: HomeAssistant, cell: CellContent, config: TemperatureCardConfig): string {
  // Without a battery the cell is unchanged. With one, the battery sits at
  // the top right (see the battery styles).
  const batteryClasses = cell.batteryEntity
    ? ` cell--battery${cell.hasHumidity ? "" : " cell--battery-only"} cell--battery-${config.batteryPosition} cell--battery-${config.batteryOrientation}`
    : "";
  // The rail reads --temperature-card-accent; setting it on the cell gives
  // that cell's rail its temperature colour. No band: the theme's accent.
  const band = temperatureState(cell.temperature);
  // A graph cell whose reading needs a wider text column carries that width.
  const styles = [
    ...(band ? [`--temperature-card-accent: ${TEMPERATURE_STATE_COLORS[band]}`] : []),
    ...(cell.graphHtml && cell.textColumn ? [`--graph-text-column: ${cell.textColumn}px`] : []),
  ];
  const bandAttrs = (band ? ` data-temperature-state="${band}"` : "") + (styles.length ? ` style="${styles.join("; ")}"` : "");
  // A graph, when there is one, comes last and is laid out on the right
  // (wide cells only; see the graph styles). Without one the cell is unchanged.
  const graph = cell.graphHtml ? { classes: " cell--graph", html: cell.graphHtml } : { classes: "", html: "" };
  return `
    <div class="cell${cell.classes ?? ""}${batteryClasses}${graph.classes}"${cell.attrs ?? ""}${bandAttrs}>
      <span class="accent" aria-hidden="true"></span>
      <div class="name">${escapeHtml(cell.name)}</div>
      ${renderTemperature(hass, cell.temperature, config.temperaturePrecision)}
      ${cell.humidityHtml}${renderBattery(hass, cell.batteryEntity)}${graph.html}
    </div>
  `;
}

/**
 * The plot size for a sensor cell: a battery in a right corner keeps a
 * column at the cell's right edge (its glyph width plus a 0.5rem gap, as in
 * the CSS), so that cell's plot is that much narrower.
 */
function batteryColumn(sensor: SensorConfig, config: TemperatureCardConfig, size: GraphSize): GraphSize {
  if (!sensor.battery_entity || !config.batteryPosition.endsWith("-right")) return size;
  const glyphRem = config.batteryOrientation === "vertical" ? 1.25 / 2 : (1.25 * 5) / 6;
  return { ...size, plotWidth: size.plotWidth - (glyphRem + 0.5) * size.rem };
}

/** `graph`: set when the cells are wide enough for a history graph (see TemperatureCard._measure). */
function renderCell(hass: HomeAssistant, sensor: SensorConfig, config: TemperatureCardConfig, graph?: GraphSize): string {
  const stateObj = hass.states[sensor.temp_entity];
  return renderCellContent(
    hass,
    {
      name: sensor.name || stateObj?.attributes.friendly_name || sensor.temp_entity,
      temperature: stateObj,
      humidityHtml: renderHumidity(hass, sensor.humidity_entity, config.humidityPrecision),
      hasHumidity: Boolean(sensor.humidity_entity),
      batteryEntity: sensor.battery_entity,
      graphHtml: graph ? sensorGraph(hass, sensor, config, batteryColumn(sensor, config, graph)) : "",
      textColumn: graph?.textColumn,
    },
    config,
  );
}

/** Usable members' readings: numeric states, and (for temperature) a known unit. */
function numericReadings(hass: HomeAssistant, entities: string[]): Array<{ value: number; unit: string }> {
  const readings: Array<{ value: number; unit: string }> = [];
  for (const entity of entities) {
    const stateObj = hass.states[entity];
    if (!stateObj || stateObj.state.trim() === "") continue;
    const value = Number(stateObj.state);
    if (Number.isFinite(value)) readings.push({ value, unit: String(stateObj.attributes.unit_of_measurement ?? "").trim() });
  }
  return readings;
}

/**
 * A roll-up's average temperature as a synthetic state object, so it is
 * formatted and classified exactly like a sensor's. Members without a usable
 * reading (missing, unavailable, non-numeric, unknown unit) are left out.
 * If all members share a unit, that unit is averaged directly; otherwise
 * each is converted and the average is shown in HA's temperature unit (or,
 * failing that, the first usable member's unit).
 */
function averageTemperature(hass: HomeAssistant, members: SensorConfig[]): HassEntity {
  const readings = numericReadings(hass, members.map((m) => m.temp_entity)).filter((r) => TO_FAHRENHEIT[r.unit]);
  const base = { entity_id: "sensor.temperature_card_average" };
  if (readings.length === 0) return { ...base, state: "unavailable", attributes: {} };

  const units = new Set(readings.map((r) => r.unit));
  let unit = readings[0].unit;
  let mean: number;
  if (units.size === 1) {
    mean = readings.reduce((sum, r) => sum + r.value, 0) / readings.length;
  } else {
    const haUnit = String(hass.config?.unit_system?.temperature ?? "").trim();
    if (FROM_FAHRENHEIT[haUnit]) unit = haUnit;
    const meanF = readings.reduce((sum, r) => sum + TO_FAHRENHEIT[r.unit](r.value), 0) / readings.length;
    mean = FROM_FAHRENHEIT[unit](meanF);
  }
  return { ...base, state: String(mean), attributes: { unit_of_measurement: unit, device_class: "temperature" } };
}

/**
 * A roll-up's average humidity over members that have a humidity entity
 * with a numeric reading, or undefined if there is none (no humidity line).
 */
function averageHumidity(hass: HomeAssistant, members: SensorConfig[]): HassEntity | undefined {
  const entities = members.flatMap((m) => (m.humidity_entity ? [m.humidity_entity] : []));
  const readings = numericReadings(hass, entities);
  if (readings.length === 0) return undefined;
  const mean = readings.reduce((sum, r) => sum + r.value, 0) / readings.length;
  return {
    entity_id: "sensor.temperature_card_average_humidity",
    state: String(mean),
    attributes: { unit_of_measurement: readings[0].unit || "%", device_class: "humidity" },
  };
}

/**
 * A roll-up cell: a normal-looking cell with the members' average
 * temperature and humidity, never a battery. With open_group it is a
 * button that opens that group.
 */
function renderRollUp(
  hass: HomeAssistant,
  item: Extract<GroupItem, { kind: "average" }>,
  groups: GroupConfig[],
  config: TemperatureCardConfig,
  graph?: GraphSize,
): string {
  const temperature = averageTemperature(hass, item.members);
  const humidity = averageHumidity(hass, item.members);
  const target = item.openGroup ? groups.find((g) => g.id === item.openGroup) : undefined;
  // A button's label replaces its content for screen readers, so it carries
  // the readings as well as what activating it does.
  const reading = temperature.state === "unavailable" ? "Unavailable" : formattedText(hass, temperature, config.temperaturePrecision);
  const humidityText = humidity ? `, humidity ${formattedText(hass, humidity, config.humidityPrecision)}` : "";
  const label = target ? `${item.name}, ${reading}${humidityText}. Opens ${target.name}.` : "";
  return renderCellContent(
    hass,
    {
      name: item.name,
      temperature,
      humidityHtml: humidity ? renderHumidityState(hass, humidity, config.humidityPrecision) : "",
      hasHumidity: Boolean(humidity),
      classes: target ? " cell--rollup cell--link" : " cell--rollup",
      attrs: target
        ? ` role="button" tabindex="0" data-open-group="${escapeHtml(target.id)}" title="${escapeHtml(`Open ${target.name}`)}" aria-label="${escapeHtml(label)}"`
        : "",
      graphHtml: graph ? rollUpGraph(hass, item, temperature, config, graph) : "",
      textColumn: graph?.textColumn,
    },
    config,
  );
}

/*
 * Temperature history: a 24-hour graph on the right of cells that are wide
 * enough (see GRAPH_MIN_CELL_REM). The data path mirrors HA's own more-info
 * dialog: entities with a state_class have 5-minute statistics
 * (recorder/statistics_during_period, which HA returns in the entity's
 * current unit); for other entities, or if statistics come back empty, the
 * recorded states (history/history_during_period) are resampled here onto
 * the same 5-minute boundaries. History is cached per entity for every card
 * on the page and refreshed every few minutes, independently of live state
 * updates. Any failure simply means no graph; the reading is unaffected.
 */
const HISTORY_SPAN_MS = 24 * 60 * 60 * 1000;
const BUCKET_MS = 5 * 60 * 1000;
const HISTORY_REFRESH_MS = 5 * 60 * 1000;
/** Lets a refresh timer that fires slightly early still count as due. */
const HISTORY_REFRESH_SLACK_MS = 30 * 1000;
/** Gaps longer than this (an unavailable sensor) break the line. */
const GRAPH_MAX_GAP_MS = 3 * BUCKET_MS;

/** 5-minute bucket start (ms) -> value in the entity's unit, in time order. */
type Series = Map<number, number>;

interface HistoryEntry {
  /** When the last request for this entity was made. */
  requestedAt: number;
  /** When `series` was fetched; the right-hand edge of its graph. */
  fetchedAt?: number;
  /** Undefined when there is no usable history. */
  series?: Series;
  pending?: Promise<void>;
}

const historyCache = new Map<string, HistoryEntry>();

type CallWS = <T>(message: Record<string, unknown>) => Promise<T>;
interface StatisticsRow {
  start: number | string;
  mean?: number | null;
}
/** HA's compressed history state: state, and last changed/updated in seconds. */
interface CompressedState {
  s?: string;
  lc?: number;
  lu?: number;
}

function seriesFromStatistics(rows: unknown): Series {
  const series: Series = new Map();
  for (const row of Array.isArray(rows) ? (rows as StatisticsRow[]) : []) {
    const start = typeof row.start === "number" ? row.start : Date.parse(String(row.start));
    if (Number.isFinite(start) && typeof row.mean === "number" && Number.isFinite(row.mean)) series.set(start, row.mean);
  }
  return series;
}

/**
 * Recorded states -> 5-minute buckets. Each bucket takes the state in
 * effect at its midpoint, so a reading carries forward until the sensor
 * reports again, and a non-numeric state (unavailable, unknown) is a gap.
 */
function seriesFromStates(states: unknown, start: number, end: number): Series {
  const changes = (Array.isArray(states) ? (states as CompressedState[]) : [])
    .map((state) => ({
      time: (state.lc ?? state.lu ?? NaN) * 1000,
      value: typeof state.s === "string" && state.s.trim() !== "" ? Number(state.s) : NaN,
    }))
    .filter((change) => Number.isFinite(change.time))
    .sort((a, b) => a.time - b.time);
  const series: Series = new Map();
  let index = -1;
  for (let bucket = Math.ceil(start / BUCKET_MS) * BUCKET_MS; bucket + BUCKET_MS <= end; bucket += BUCKET_MS) {
    const midpoint = bucket + BUCKET_MS / 2;
    while (index + 1 < changes.length && changes[index + 1].time <= midpoint) index++;
    const value = index >= 0 ? changes[index].value : NaN;
    if (Number.isFinite(value)) series.set(bucket, value);
  }
  return series;
}

/** One request per data source for all `entities`; results go into historyCache. */
async function fetchHistory(callWS: CallWS, hass: HomeAssistant, entities: string[], now: number): Promise<void> {
  const start = now - HISTORY_SPAN_MS;
  const startTime = new Date(start).toISOString();
  const found = new Map<string, Series>();
  const failed = new Set<string>();

  const withStatistics = entities.filter((id) => hass.states[id]?.attributes.state_class);
  if (withStatistics.length > 0) {
    try {
      const result = await callWS<Record<string, unknown>>({
        type: "recorder/statistics_during_period",
        start_time: startTime,
        statistic_ids: withStatistics,
        period: "5minute",
        types: ["mean"],
      });
      for (const id of withStatistics) {
        const series = seriesFromStatistics(result?.[id]);
        if (series.size > 0) found.set(id, series);
      }
    } catch {
      // Fall back to recorded states below.
    }
  }

  const withStates = entities.filter((id) => !found.has(id));
  if (withStates.length > 0) {
    try {
      const result = await callWS<Record<string, unknown>>({
        type: "history/history_during_period",
        start_time: startTime,
        end_time: new Date(now).toISOString(),
        entity_ids: withStates,
        minimal_response: true,
        no_attributes: true,
      });
      for (const id of withStates) {
        const series = seriesFromStates(result?.[id], start, now);
        if (series.size > 0) found.set(id, series);
      }
    } catch {
      withStates.forEach((id) => failed.add(id));
    }
  }

  for (const id of entities) {
    // A failed request keeps what was shown before; it is retried at the next refresh.
    const previous = historyCache.get(id);
    historyCache.set(
      id,
      failed.has(id)
        ? { requestedAt: now, fetchedAt: previous?.fetchedAt, series: previous?.series }
        : { requestedAt: now, fetchedAt: now, series: found.get(id) },
    );
  }
}

/**
 * Makes sure the entities' history is loaded and no older than the refresh
 * interval. An entity already being fetched is waited for, not requested
 * again. Resolves true if anything was waited for, so the card re-renders.
 */
function loadHistory(hass: HomeAssistant, entities: string[]): Promise<boolean> {
  const callWS = hass.callWS;
  if (typeof callWS !== "function") return Promise.resolve(false);
  const now = Date.now();
  const waits: Array<Promise<void>> = [];
  const due: string[] = [];
  for (const id of new Set(entities)) {
    const entry = historyCache.get(id);
    if (entry?.pending) waits.push(entry.pending);
    else if (!entry || now - entry.requestedAt >= HISTORY_REFRESH_MS - HISTORY_REFRESH_SLACK_MS) due.push(id);
  }
  if (due.length > 0) {
    // Started on the next microtask, so the entries are marked pending first.
    const pending = Promise.resolve()
      .then(() => fetchHistory(callWS.bind(hass) as CallWS, hass, due, now))
      .catch(() => undefined);
    for (const id of due) historyCache.set(id, { ...historyCache.get(id), requestedAt: now, pending });
    waits.push(pending);
  }
  return waits.length > 0 ? Promise.all(waits).then(() => true) : Promise.resolve(false);
}

function entityUnit(hass: HomeAssistant, entity: string): string {
  return String(hass.states[entity]?.attributes.unit_of_measurement ?? "").trim();
}

/** The plot's measured width, so the axis labels can be chosen to fit. */
interface GraphSize {
  /** Plot width in px (the graph less its temperature-label column). */
  plotWidth: number;
  /** Root font size in px; the labels are 1rem. */
  rem: number;
  /** Text column width in px when the reading needs more than the default (see TemperatureCard._measure). */
  textColumn?: number;
}

/** A sensor cell's graph: its own temperature history. */
function sensorGraph(hass: HomeAssistant, sensor: SensorConfig, config: TemperatureCardConfig, size: GraphSize): string {
  const entry = historyCache.get(sensor.temp_entity);
  if (!entry?.series || entry.fetchedAt === undefined) return "";
  const name = sensor.name || hass.states[sensor.temp_entity]?.attributes.friendly_name || sensor.temp_entity;
  return renderGraph(hass, [...entry.series], entry.fetchedAt, entityUnit(hass, sensor.temp_entity), config, size, {
    entity: sensor.temp_entity,
    name,
  });
}

/**
 * A roll-up's graph: the historical average of the same members, in the
 * same unit as its current average. Members are aligned on the shared
 * 5-minute bucket boundaries (never by position in their arrays); each
 * bucket averages the members that have a value for it, so an unavailable
 * member is left out exactly as it is from the current average.
 */
function rollUpGraph(
  hass: HomeAssistant,
  item: Extract<GroupItem, { kind: "average" }>,
  current: HassEntity,
  config: TemperatureCardConfig,
  size: GraphSize,
): string {
  const unit =
    String(current.attributes.unit_of_measurement ?? "") ||
    item.members.map((member) => entityUnit(hass, member.temp_entity)).find((u) => TO_FAHRENHEIT[u]) ||
    "";
  const fromF = FROM_FAHRENHEIT[unit];
  if (!fromF) return "";

  const totals = new Map<number, { sum: number; count: number }>();
  let end = Infinity;
  for (const member of item.members) {
    const entry = historyCache.get(member.temp_entity);
    const memberUnit = entityUnit(hass, member.temp_entity);
    const toF = TO_FAHRENHEIT[memberUnit];
    if (!entry?.series || entry.fetchedAt === undefined || !toF) continue;
    end = Math.min(end, entry.fetchedAt);
    for (const [bucket, value] of entry.series) {
      const total = totals.get(bucket) ?? { sum: 0, count: 0 };
      total.sum += memberUnit === unit ? value : fromF(toF(value));
      total.count += 1;
      totals.set(bucket, total);
    }
  }
  if (!Number.isFinite(end)) return "";
  // Only buckets every member could already have (members may have been fetched at different times).
  const points = [...totals]
    .filter(([bucket]) => bucket + BUCKET_MS <= end)
    .sort((a, b) => a[0] - b[0])
    .map(([bucket, total]): [number, number] => [bucket, total.sum / total.count]);
  return renderGraph(hass, points, end, unit, config, size);
}

/**
 * Vertical range: the observed low and high, widened to a minimum span (4 °F
 * or its equivalent, so a steady sensor's small wobble stays small) and
 * padded so the line stays clear of the edges.
 */
function graphRange(low: number, high: number, unit: string): { min: number; max: number } {
  const fromF = FROM_FAHRENHEIT[unit];
  const minSpan = fromF ? fromF(4) - fromF(0) : 4;
  if (high - low < minSpan) {
    const middle = (low + high) / 2;
    low = middle - minSpan / 2;
    high = middle + minSpan / 2;
  }
  const pad = (high - low) * 0.15;
  return { min: low - pad, max: high + pad };
}

/**
 * Guide-line values: the finest round step (1, 2 or 5 x 10^n) that gives at
 * most four lines within the plot's range. (A label on the very top or
 * bottom line extends into the space around the plot, never over it.)
 */
function graphTicks(low: number, high: number): { ticks: number[]; digits: number } {
  const [min, max] = [low, high];
  let step = 1;
  for (let exponent = Math.floor(Math.log10(max - min)) - 2; ; exponent++) {
    const candidate = [1, 2, 5].map((m) => m * 10 ** exponent).find((s) => Math.floor(high / s) - Math.ceil(low / s) + 1 <= 4);
    if (candidate !== undefined) {
      step = candidate;
      break;
    }
  }
  const ticks: number[] = [];
  for (let n = Math.ceil(low / step); n * step <= high; n++) ticks.push(Number((n * step).toFixed(6)));
  return { ticks, digits: step < 1 ? Math.min(MAX_PRECISION, Math.ceil(-Math.log10(step) - 1e-9)) : 0 };
}

/**
 * Hour labels in the user's time settings: HA's language, 12/24-hour
 * preference and (if chosen in the profile) the server's time zone,
 * otherwise the browser's. 12-hour clocks show "4 PM", 24-hour "16:00".
 */
function timeFormat(hass: HomeAssistant): { format: (time: number) => string; clock: (time: number) => { hour: number; minute: number } } {
  const setting = hass.locale?.time_format;
  const language = setting === "system" ? undefined : hass.locale?.language || hass.language || undefined;
  const timeZone = hass.locale?.time_zone === "server" ? hass.config?.time_zone : undefined;
  const make = (options: Intl.DateTimeFormatOptions, locale = language): Intl.DateTimeFormat => {
    try {
      return new Intl.DateTimeFormat(locale, { ...options, timeZone });
    } catch {
      return new Intl.DateTimeFormat(undefined, options);
    }
  };
  const hour12 = setting === "12" ? true : setting === "24" ? false : undefined;
  const twelveHour = make({ hour: "numeric", hour12 }).resolvedOptions().hour12 === true;
  const formatter = twelveHour ? make({ hour: "numeric", hour12: true }) : make({ hour: "2-digit", minute: "2-digit", hour12: false });
  const parts = make({ hour: "numeric", minute: "numeric", hourCycle: "h23" }, "en-US");
  return {
    format: (time) => formatter.format(time),
    clock: timeZone
      ? (time) => {
          const p = parts.formatToParts(time);
          return { hour: Number(p.find((x) => x.type === "hour")?.value) % 24, minute: Number(p.find((x) => x.type === "minute")?.value) };
        }
      : (time) => {
          const date = new Date(time);
          return { hour: date.getHours(), minute: date.getMinutes() };
        },
  };
}

interface TimeLabel {
  /** Position along the plot, in % of its width. */
  at: number;
  text: string;
  align: "middle" | "end";
}

/**
 * Time labels: "Now" at the right end, plus whole local clock hours every 8
 * hours (every 12 if the plot is too narrow for 8), each centred under its
 * time. Of the possible sets (e.g. 12 AM / 8 AM / 4 PM, or 8 PM / 4 AM /
 * 12 PM) the one with the most labels, then the most even spacing, is
 * used, so the whole 24 hours is labelled. Labels never overlap each other,
 * "Now" or the plot's left edge; their width is estimated generously from
 * the 1rem font size.
 */
function timeLabels(hass: HomeAssistant, start: number, end: number, size: GraphSize): TimeLabel[] {
  const { format, clock } = timeFormat(hass);
  const width = (text: string): number => text.length * 0.62 * size.rem;
  const gap = 0.75 * size.rem;
  const now: TimeLabel = { at: 100, text: "Now", align: "end" };
  const nowLeft = size.plotWidth - width(now.text);

  // Every whole local hour in the window that can carry a label, with its extent in px.
  const hours: Array<{ hour: number; label: TimeLabel; left: number; right: number }> = [];
  const quarter = 15 * 60 * 1000;
  for (let time = Math.ceil(start / quarter) * quarter; time < end; time += quarter) {
    const { hour, minute } = clock(time);
    if (minute !== 0) continue;
    const text = format(time);
    const center = ((time - start) / HISTORY_SPAN_MS) * size.plotWidth;
    const left = center - width(text) / 2;
    if (left < 0 || left + width(text) + gap > nowLeft) continue;
    hours.push({ hour, label: { at: (center / size.plotWidth) * 100, text, align: "middle" }, left, right: left + width(text) });
  }

  let best: { labels: TimeLabel[]; clearance: number } | undefined;
  for (const stepHours of [8, 12]) {
    for (let phase = 0; phase < stepHours; phase += 2) {
      const chosen = hours.filter((h) => h.hour % stepHours === phase);
      let clearance = nowLeft - (chosen[chosen.length - 1]?.right ?? 0);
      for (let i = 1; i < chosen.length; i++) clearance = Math.min(clearance, chosen[i].left - chosen[i - 1].right);
      if (clearance < gap) continue;
      if (!best || chosen.length > best.labels.length || (chosen.length === best.labels.length && clearance > best.clearance)) {
        best = { labels: chosen.map((h) => h.label), clearance };
      }
    }
  }
  return [...(best?.labels ?? []), now];
}

/**
 * The graph: one line over the last 24 hours ending at `end`, a few guide
 * lines with their temperatures on the right, local times underneath, and
 * nothing else. The SVG stretches to the space available (non-scaling strokes keep
 * lines crisp); the labels are HTML so their text is never distorted.
 * Points are 5-minute buckets, drawn at their midpoints.
 */
function renderGraph(
  hass: HomeAssistant,
  buckets: Array<[number, number]>,
  end: number,
  unit: string,
  config: TemperatureCardConfig,
  size: GraphSize,
  action?: { entity: string; name: string },
): string {
  const start = end - HISTORY_SPAN_MS;
  const points = buckets
    .map(([bucket, value]): [number, number] => [bucket + BUCKET_MS / 2, value])
    .filter(([time]) => time >= start && time <= end);
  if (points.length < 2) return "";

  const readings = points.map(([, value]) => value);
  const low = Math.min(...readings);
  const high = Math.max(...readings);
  const { min, max } = graphRange(low, high, unit);
  const x = (time: number): string => (((time - start) / HISTORY_SPAN_MS) * 100).toFixed(2);
  const y = (value: number): string => (((max - value) / (max - min)) * 100).toFixed(2);

  // One path per run of points without a long gap (an unavailable sensor).
  const runs: Array<Array<[number, number]>> = [];
  points.forEach((point, index) => {
    if (index === 0 || point[0] - points[index - 1][0] > GRAPH_MAX_GAP_MS) runs.push([]);
    runs[runs.length - 1].push(point);
  });
  const line = runs
    .map((run) => run.map(([time, value], index) => `${index === 0 ? "M" : "L"}${x(time)} ${y(value)}`).join(""))
    .join("");

  const { ticks, digits } = graphTicks(min, max);
  const degree = unit.startsWith("°") || unit === "℉" || unit === "℃" ? "°" : "";
  const guides = ticks.map((tick) => `M0 ${y(tick)}H100`).join("");
  const values = ticks
    .map((tick) => `<span class="graph-tick" style="top: ${y(tick)}%">${escapeHtml(`${formatNumberState(hass, String(tick), digits) ?? tick}${degree}`)}</span>`)
    .join("");
  const times = timeLabels(hass, start, end, size)
    .map((t) => `<span class="graph-time graph-time--${t.align}" style="left: ${t.at.toFixed(2)}%">${escapeHtml(t.text)}</span>`)
    .join("");

  const reading = (value: number): string =>
    formattedText(hass, { entity_id: "sensor.temperature_card_history", state: String(value), attributes: { unit_of_measurement: unit, device_class: "temperature" } }, config.temperaturePrecision);
  const label = `Last 24 hours: low ${reading(low)}, high ${reading(high)}`;

  // A sensor's graph opens HA's More Info for its temperature entity (see
  // TemperatureCard._openHistory); a roll-up's has no single entity.
  const opening = action
    ? ` graph--action" role="button" tabindex="0" data-entity="${escapeHtml(action.entity)}" title="Double-click for temperature history" aria-label="${escapeHtml(`Open ${action.name} temperature history. ${label}.`)}"`
    : `" role="img" aria-label="${escapeHtml(label)}"`;
  return `<div class="graph${opening}><svg class="graph-plot" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path class="graph-guide" d="${guides}"/><path class="graph-line" d="${line}"/></svg><div class="graph-values">${values}</div><div class="graph-times">${times}</div></div>`;
}

/** Every temperature entity whose history the given cells graph. */
function graphEntities(cells: GroupItem[]): string[] {
  return cells.flatMap((item) => (item.kind === "sensor" ? [item.sensor.temp_entity] : item.members.map((m) => m.temp_entity)));
}

/** Every entity the card reads, so unrelated HA updates can be skipped. */
function dependencies(config: TemperatureCardConfig): string[] {
  const ids = new Set<string>();
  for (const sensor of config.sensors) {
    ids.add(sensor.temp_entity);
    if (sensor.humidity_entity) ids.add(sensor.humidity_entity);
    if (sensor.battery_entity) ids.add(sensor.battery_entity);
  }
  return [...ids];
}

/** A swipe must move at least this far sideways, and mostly sideways. */
const SWIPE_MIN_PX = 50;
const SWIPE_HORIZONTAL_RATIO = 1.5;
/** After a swipe, ignore the click some browsers still deliver. */
const SWIPE_CLICK_GUARD_MS = 400;
/**
 * Double-tap on a sensor's graph (touch): each tap stays within TAP_SLOP_PX
 * of where it started and lasts at most TAP_MAX_MS, and the second starts
 * within DOUBLE_TAP_MS of the first ending, on the same graph.
 */
const TAP_SLOP_PX = 10;
const TAP_MAX_MS = 500;
const DOUBLE_TAP_MS = 350;

export class TemperatureCard extends HTMLElement {
  private _config?: TemperatureCardConfig;
  private _hass?: HomeAssistant;
  /** Every entity the configuration reads (see dependencies()). */
  private _dependencies: string[] = [];
  /**
   * Last markup written (plain mode). The markup depends only on the
   * configured entities, so an unrelated HA state change produces identical
   * markup and the DOM is left alone.
   */
  private _renderedHtml?: string;
  /**
   * Grouped mode: the group on show. Only tabs, swipes and roll-ups change
   * it; HA state updates never do. A new config keeps it if it still exists.
   */
  private _activeGroupId?: string;
  /** Grouped mode: the config the tab strip was built for, and the grid's last markup. */
  private _builtFor?: TemperatureCardConfig;
  private _gridHtml?: string;
  /**
   * The touch or pen gesture in progress: a possible swipe (grouped mode)
   * and, if it began on a sensor's graph with touch, a possible tap.
   */
  private _swipe?: { pointerId: number; x: number; y: number; at: number; moved: number; graph?: string };
  /** A first tap on a sensor's graph waiting for its second: which graph (cell position + entity), and when it ended. */
  private _pendingTap?: { graph: string; at: number };
  /** Pointer type of the last pointerdown: double-clicks from touch are left to the tap recognizer. */
  private _lastPointerType = "";
  /**
   * The sensor graph (if any) under each of the last two mouse / pen presses.
   * A double-click counts only if both presses were on the same graph: the
   * first click can change what is under the pointer (a roll-up's
   * open_group switches tabs).
   */
  private _pressedGraphs: Array<string | undefined> = [];
  private _ignoreClicksUntil = 0;
  private _switchTimer?: number;
  /** Set when the cells are wide enough for history graphs: the plot's size (see _measure). */
  private _graphSize?: GraphSize;
  /**
   * Cells on show (by position) whose temperature and unit would leave too
   * little room for a graph even with a wider text column: they are shown
   * without their graph, so the reading never has to break (see _textColumns).
   */
  private _crowded = new Set<number>();
  /** Cells on show (by position) whose reading needs a wider text column than the default: its width in px. */
  private _columns = new Map<number, number>();
  private _resizeObserver?: ResizeObserver;
  private _historyTimer?: number;

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    // Delegated once: these keep working across every re-render.
    root.addEventListener("click", (event) => this._onClick(event as MouseEvent));
    root.addEventListener("keydown", (event) => this._onKeyDown(event as KeyboardEvent));
    root.addEventListener("pointerdown", (event) => this._onPointerDown(event as PointerEvent));
    root.addEventListener("pointermove", (event) => this._onPointerMove(event as PointerEvent));
    root.addEventListener("pointerup", (event) => this._onPointerUp(event as PointerEvent));
    root.addEventListener("pointercancel", () => {
      this._swipe = undefined;
      this._pendingTap = undefined;
    });
    root.addEventListener("dblclick", (event) => this._onDoubleClick(event as MouseEvent));
    root.addEventListener("animationend", (event) =>
      (event.target as Element).classList?.remove("switch-next", "switch-prev"),
    );
  }

  /**
   * Invalid configuration throws, which is Home Assistant's convention: HA
   * catches it and shows its own error card with this message.
   */
  setConfig(config: unknown): void {
    const next = normalizeConfig(config);
    this._config = next;
    this._pendingTap = undefined;
    this._pressedGraphs = [];
    this._dependencies = dependencies(next);
    if (!next.groups) this._activeGroupId = undefined;
    else if (!next.groups.some((group) => group.id === this._activeGroupId)) this._activeGroupId = next.groups[0].id;
    this._render();
  }

  set hass(hass: HomeAssistant) {
    const previous = this._hass;
    this._hass = hass;
    if (previous && this._nothingChanged(previous, hass)) return;
    this._render();
  }

  get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  connectedCallback(): void {
    if (typeof ResizeObserver !== "undefined" && !this._resizeObserver) {
      this._resizeObserver = new ResizeObserver(() => this._measure());
      this._resizeObserver.observe(this);
    }
    // History is refreshed on a timer, never by live state updates.
    window.clearInterval(this._historyTimer);
    this._historyTimer = window.setInterval(() => {
      if (this._graphSize) this._requestHistory();
    }, HISTORY_REFRESH_MS);
    this._measure();
  }

  disconnectedCallback(): void {
    this._pendingTap = undefined;
    this._swipe = undefined;
    this._resizeObserver?.disconnect();
    this._resizeObserver = undefined;
    window.clearInterval(this._historyTimer);
    this._historyTimer = undefined;
  }

  /**
   * Masonry-view height estimate (1 = 50px). Assumes one cell per row,
   * since masonry columns are usually narrower than two cells need.
   */
  getCardSize(): number {
    const groups = this._config?.groups;
    if (groups) return 1 + 3 * Math.max(...groups.map((group) => group.items.length));
    return 3 * (this._config?.sensors.length ?? 1);
  }

  /** True when no configured entity (or formatting input) differs between two hass objects. */
  private _nothingChanged(previous: HomeAssistant, next: HomeAssistant): boolean {
    if (
      previous.formatEntityStateToParts !== next.formatEntityStateToParts ||
      previous.locale !== next.locale ||
      previous.language !== next.language ||
      previous.config !== next.config
    ) {
      return false;
    }
    return this._dependencies.every((id) => previous.states[id] === next.states[id]);
  }

  private _render(): void {
    const root = this.shadowRoot;
    if (!root || !this._config || !this._hass) return;
    if (this._config.groups) {
      this._renderGrouped(root, this._config, this._config.groups, this._hass);
      return;
    }

    this._builtFor = undefined;
    const hass = this._hass;
    const config = this._config;
    const html = `
      <style>${STYLES}</style>
      <ha-card>
        <div class="grid">${config.sensors.map((sensor, index) => renderCell(hass, sensor, config, this._graphFor(index))).join("")}</div>
        <div class="build">${escapeHtml(TEMPERATURE_CARD_BUILD)}</div>
      </ha-card>
    `;
    if (html === this._renderedHtml) return;
    this._renderedHtml = html;
    root.innerHTML = html;
    this._measure();
  }

  /**
   * Grouped mode: the tab strip is built once per config; afterwards only
   * the grid's contents are replaced, so tab focus and scroll position
   * survive HA updates.
   */
  private _renderGrouped(root: ShadowRoot, config: TemperatureCardConfig, groups: GroupConfig[], hass: HomeAssistant): void {
    if (this._builtFor !== config) {
      this._builtFor = config;
      this._renderedHtml = undefined;
      this._gridHtml = undefined;
      const tabs = groups
        .map(
          (group, index) =>
            `<button class="tab" type="button" role="tab" id="tab-${index}" aria-controls="panel" aria-selected="false" tabindex="-1" title="${escapeHtml(group.name)}">${escapeHtml(group.name)}</button>`,
        )
        .join("");
      root.innerHTML = `
        <style>${STYLES}</style>
        <ha-card class="grouped">
          <div class="tabs" role="tablist" aria-label="Sensor groups">${tabs}</div>
          <div class="grid" id="panel" role="tabpanel"></div>
          <div class="build">${escapeHtml(TEMPERATURE_CARD_BUILD)}</div>
        </ha-card>
      `;
      this._syncTabs();
    }

    const group = groups.find((g) => g.id === this._activeGroupId) ?? groups[0];
    const html = group.items
      .map((item, index) =>
        item.kind === "sensor"
          ? renderCell(hass, item.sensor, config, this._graphFor(index))
          : renderRollUp(hass, item, groups, config, this._graphFor(index)),
      )
      .join("");
    if (html === this._gridHtml) return;
    this._gridHtml = html;
    const grid = root.querySelector(".grid");
    if (grid) grid.innerHTML = html;
    this._measure();
  }

  /** The cells on show: the active group's, or every sensor's. */
  private _shownCells(): GroupItem[] {
    const config = this._config;
    if (!config) return [];
    if (!config.groups) return config.sensors.map((sensor) => ({ kind: "sensor", sensor }));
    return (config.groups.find((g) => g.id === this._activeGroupId) ?? config.groups[0]).items;
  }

  /**
   * Whether the cells are wide enough for graphs: the same test as the CSS
   * container query (content box >= GRAPH_MIN_CELL_REM). Grid cells all
   * have the same width. A hidden or not yet laid out card measures 0, so
   * it shows no graphs and fetches nothing.
   */
  private _measure(): void {
    const cell = this.shadowRoot?.querySelector<HTMLElement>(".grid > .cell");
    let size: GraphSize | undefined;
    let layout = { crowded: new Set<number>(), columns: new Map<number, number>() };
    if (cell && this.isConnected) {
      const style = getComputedStyle(cell);
      const content = cell.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      if (content >= GRAPH_MIN_CELL_REM * rem) {
        // Whole 4px steps, so small resizes do not re-render.
        size = { plotWidth: Math.floor((content - (GRAPH_LEFT_REM + GRAPH_VALUES_REM) * rem) / 4) * 4, rem };
        layout = this._textColumns(size, rem);
      }
    }
    const { crowded, columns } = layout;
    const sameLayout =
      crowded.size === this._crowded.size &&
      [...crowded].every((index) => this._crowded.has(index)) &&
      columns.size === this._columns.size &&
      [...columns].every(([index, width]) => this._columns.get(index) === width);
    if (size?.plotWidth !== this._graphSize?.plotWidth || size?.rem !== this._graphSize?.rem || !sameLayout) {
      this._graphSize = size;
      this._crowded = crowded;
      this._columns = columns;
      this._render();
    }
    if (size) this._requestHistory();
  }

  /**
   * Readable current temperature before the optional graph. A cell whose
   * temperature and unit (with any inset beside them) are wider than the
   * default text column gets a wider column, and its graph gives up that
   * width; if that would leave the plot narrower than it is at the graph
   * threshold, the cell shows no graph instead. Wide cells use the same
   * temperature size with or without a graph, so this measures the same
   * either way, and a cell gets its graph back once its reading fits again.
   */
  private _textColumns(size: GraphSize, rem: number): { crowded: Set<number>; columns: Map<number, number> } {
    const crowded = new Set<number>();
    const columns = new Map<number, number>();
    const minimumPlot = (GRAPH_MIN_CELL_REM - GRAPH_LEFT_REM - GRAPH_VALUES_REM) * rem;
    this.shadowRoot?.querySelectorAll<HTMLElement>(".grid > .cell").forEach((cell, index) => {
      const reading = cell.querySelector<HTMLElement>(".reading");
      if (!reading?.querySelector(".value")) return;
      const style = getComputedStyle(reading);
      const items = [...reading.children].map((child) => child.getBoundingClientRect().width);
      const needed =
        (parseFloat(style.paddingLeft) || 0) +
        items.reduce((sum, w) => sum + w, 0) +
        (parseFloat(style.columnGap) || 0) * Math.max(0, items.length - 1);
      if (needed <= GRAPH_TEXT_REM * rem + 0.5) return;
      const column = Math.ceil(needed / 4) * 4;
      if (size.plotWidth - (column - GRAPH_TEXT_REM * rem) < minimumPlot - 4) crowded.add(index);
      else columns.set(index, column);
    });
    return { crowded, columns };
  }

  /** The graph size for the cell at `index`, or undefined if it shows no graph. */
  private _graphFor(index: number): GraphSize | undefined {
    const size = this._graphSize;
    if (!size || this._crowded.has(index)) return undefined;
    const column = this._columns.get(index);
    return column ? { ...size, plotWidth: size.plotWidth - (column - GRAPH_TEXT_REM * size.rem), textColumn: column } : size;
  }

  /** Loads (or refreshes, when due) the history of the cells on show, then re-renders. */
  private _requestHistory(): void {
    const hass = this._hass;
    if (!hass) return;
    void loadHistory(hass, graphEntities(this._shownCells())).then((loaded) => {
      if (loaded && this.isConnected) this._render();
    });
  }

  private _activeIndex(): number {
    return Math.max(0, this._config?.groups?.findIndex((group) => group.id === this._activeGroupId) ?? 0);
  }

  /** Marks the active tab (and roving tabindex) and scrolls it into view within the strip. */
  private _syncTabs(): void {
    const root = this.shadowRoot;
    const strip = root?.querySelector<HTMLElement>(".tabs");
    if (!root || !strip) return;
    const active = this._activeIndex();
    const tabs = [...strip.querySelectorAll<HTMLElement>(".tab")];
    tabs.forEach((tab, index) => {
      tab.setAttribute("aria-selected", String(index === active));
      tab.tabIndex = index === active ? 0 : -1;
    });
    root.querySelector(".grid")?.setAttribute("aria-labelledby", `tab-${active}`);
    const tab = tabs[active];
    if (!tab) return;
    // Scroll the strip only (scrollIntoView could also scroll the page).
    // Prefer showing the start of the label if it cannot all fit.
    const s = strip.getBoundingClientRect();
    const t = tab.getBoundingClientRect();
    if (t.left < s.left || t.width > s.width) strip.scrollLeft -= s.left - t.left;
    else if (t.right > s.right) strip.scrollLeft += t.right - s.right;
  }

  /** Shows group `index`; `focusTab` moves keyboard focus to its tab. */
  private _selectGroup(index: number, focusTab = false): void {
    const groups = this._config?.groups;
    const group = groups?.[index];
    if (!groups || !group) return;
    const previous = this._activeIndex();
    if (group.id !== this._activeGroupId) {
      this._activeGroupId = group.id;
      this._crowded = new Set();
      this._pendingTap = undefined;
      this._pressedGraphs = [];
      this._columns = new Map();
      this._syncTabs();
      this._render();
      const grid = this.shadowRoot?.querySelector<HTMLElement>(".grid");
      if (grid) {
        grid.classList.remove("switch-next", "switch-prev");
        void grid.offsetWidth; // restart the animation
        grid.classList.add(index > previous ? "switch-next" : "switch-prev");
        // Also cleared on animationend; this covers reduced motion, where
        // there is no animation and so no animationend.
        window.clearTimeout(this._switchTimer);
        this._switchTimer = window.setTimeout(() => grid.classList.remove("switch-next", "switch-prev"), 200);
      }
    }
    if (focusTab) this.shadowRoot?.querySelector<HTMLElement>(`#tab-${index}`)?.focus();
  }

  private _openGroup(id: string | undefined, focusTab = false): void {
    const index = this._config?.groups?.findIndex((group) => group.id === id) ?? -1;
    if (index >= 0) this._selectGroup(index, focusTab);
  }

  private _onClick(event: MouseEvent): void {
    if (!this._config?.groups) return;
    const target = event.target as Element | null;
    const tab = target?.closest<HTMLElement>(".tab");
    if (tab) {
      this._selectGroup(Number(tab.id.slice(4)));
      return;
    }
    // A swipe that ends on a roll-up must not also open its group.
    if (performance.now() < this._ignoreClicksUntil) return;
    const link = target?.closest<HTMLElement>(".cell--link");
    if (link) this._openGroup(link.dataset.openGroup);
  }

  private _onKeyDown(event: KeyboardEvent): void {
    const groups = this._config?.groups;
    const target = event.target as Element | null;
    const graph = target?.closest?.<HTMLElement>(".graph--action");
    if (graph && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      this._openHistory(graph.dataset.entity);
      return;
    }
    if (!groups || !target) return;
    const tab = target.closest<HTMLElement>(".tab");
    if (tab) {
      const current = Number(tab.id.slice(4));
      const last = groups.length - 1;
      const next =
        event.key === "ArrowRight" ? (current === last ? 0 : current + 1)
        : event.key === "ArrowLeft" ? (current === 0 ? last : current - 1)
        : event.key === "Home" ? 0
        : event.key === "End" ? last
        : event.key === "Enter" || event.key === " " ? current
        : undefined;
      if (next === undefined) return;
      event.preventDefault();
      this._selectGroup(next, true);
      return;
    }
    const link = target.closest<HTMLElement>(".cell--link");
    if (link && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      this._openGroup(link.dataset.openGroup, true);
    }
  }

  /**
   * Touch and pen gestures that start on the grid: swipes between groups
   * (grouped mode), and taps on a sensor's graph (touch), two of which open
   * its history. A swipe or any larger movement is never a tap.
   */
  private _onPointerDown(event: PointerEvent): void {
    this._lastPointerType = event.pointerType;
    const target = event.target as Element | null;
    if (event.pointerType !== "touch") {
      this._pressedGraphs = [this._pressedGraphs[1], this._graphKey(target?.closest?.<HTMLElement>(".graph--action") ?? null)];
    }
    if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
    if (!target?.closest?.(".grid")) return;
    const graph = event.pointerType === "touch" ? this._graphKey(target.closest<HTMLElement>(".graph--action")) : undefined;
    if (!this._config?.groups && !graph) return;
    this._swipe = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, at: performance.now(), moved: 0, graph };
  }

  private _onPointerMove(event: PointerEvent): void {
    const gesture = this._swipe;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gesture.moved = Math.max(gesture.moved, Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y));
    if (gesture.graph && gesture.moved > TAP_SLOP_PX) {
      gesture.graph = undefined;
      this._pendingTap = undefined;
    }
  }

  private _onPointerUp(event: PointerEvent): void {
    const start = this._swipe;
    this._swipe = undefined;
    if (!start || start.pointerId !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const moved = Math.max(start.moved, Math.hypot(dx, dy));
    const now = performance.now();
    if (start.graph && moved <= TAP_SLOP_PX && now - start.at <= TAP_MAX_MS) {
      this._onGraphTap(start.graph, start.at, now);
      return;
    }
    // Anything else (a swipe, a drag, a scroll, a long press) ends any tap sequence.
    this._pendingTap = undefined;
    const groups = this._config?.groups;
    if (!groups) return;
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < SWIPE_HORIZONTAL_RATIO * Math.abs(dy)) return;
    const next = this._activeIndex() + (dx < 0 ? 1 : -1);
    if (next < 0 || next >= groups.length) return;
    this._ignoreClicksUntil = performance.now() + SWIPE_CLICK_GUARD_MS;
    this._selectGroup(next);
  }

  /** A tap on a sensor's graph: the second of two on the same graph opens its history. */
  private _onGraphTap(graph: string, downAt: number, upAt: number): void {
    const pending = this._pendingTap;
    if (pending && pending.graph === graph && downAt - pending.at <= DOUBLE_TAP_MS) {
      this._pendingTap = undefined;
      this._openHistory(graph.slice(graph.indexOf(":") + 1));
      return;
    }
    this._pendingTap = { graph, at: upAt };
  }

  /** Desktop (mouse / pen) double-click on a sensor's graph; touch uses the tap recognizer. */
  private _onDoubleClick(event: MouseEvent): void {
    if (this._lastPointerType === "touch") return;
    const graph = this._graphKey((event.target as Element | null)?.closest?.<HTMLElement>(".graph--action") ?? null);
    const [first, second] = this._pressedGraphs;
    if (graph && first === graph && second === graph) this._openHistory(graph.slice(graph.indexOf(":") + 1));
  }

  /** Identifies a sensor's graph across re-renders: its cell's position and its entity. */
  private _graphKey(graph: HTMLElement | null): string | undefined {
    const cell = graph?.closest(".cell");
    if (!graph?.dataset.entity || !cell?.parentElement) return undefined;
    return `${[...cell.parentElement.children].indexOf(cell)}:${graph.dataset.entity}`;
  }

  /** Opens Home Assistant's own More Info dialog (with its history) for an entity. */
  private _openHistory(entityId: string | undefined): void {
    if (!entityId) return;
    this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
  }
}

declare global {
  interface Window {
    customCards?: Array<Record<string, unknown>>;
  }
}

window.customCards = window.customCards ?? [];
window.customCards.push({
  type: "temperature-card",
  name: "Temperature",
  description: "Shows the current readings of one or more temperature sensors, with optional humidity.",
});

customElements.define("temperature-card", TemperatureCard);

console.info(`temperature-card ${TEMPERATURE_CARD_BUILD}`);
