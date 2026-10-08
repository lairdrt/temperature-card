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
  locale?: { language?: string; number_format?: string };
  language?: string;
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
  /** Optional display name; defaults to the temperature entity's friendly name. */
  name?: string;
}

/**
 * Normalized configuration. The top-level single-sensor shorthand
 * (`entity:`) becomes a one-item `sensors` list, so there is only one
 * rendering path.
 */
interface TemperatureCardConfig {
  sensors: SensorConfig[];
  /** Decimals shown for temperatures (card-wide). */
  temperaturePrecision: number;
  /** Decimals shown for humidity (card-wide). */
  humidityPrecision: number;
}

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
 * overflowing its cell. Names are limited to two lines.
 */
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
    font-size: 1.25rem;
    font-size: clamp(1.125rem, 9cqi, 1.5rem);
    font-weight: min(var(--ha-font-weight-medium, 500), 600);
    line-height: 1.3;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
  }

  .reading {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    column-gap: 0.08em;
    min-height: 1em;
    margin-top: 0.5rem;
    font-size: 3.5rem;
    font-size: clamp(2.75rem, 33cqi, 6rem);
    line-height: 1;
  }

  .reading > *,
  .humidity > * {
    min-width: 0;
  }

  .value {
    font-weight: min(var(--ha-font-weight-normal, 400), 600);
    letter-spacing: -0.03em;
  }

  /* Smaller and raised: margin-top lines the top of the unit up with the
     top of the numerals. */
  .unit {
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

  /* Humidity: "54% humidity" on one line, left-aligned with the
     temperature, as a clearly secondary readout. The value is large and in
     the primary text colour; the word is a small label. The gap above it
     separates it from the numerals' descent so it reads as its own line. */
  .humidity {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: 0.4rem;
    margin-top: 0.75rem;
    line-height: 1.1;
  }

  .humidity-value {
    font-size: 2rem;
    font-size: clamp(1.75rem, 18cqi, 2.5rem);
    font-weight: min(var(--ha-font-weight-normal, 400), 600);
  }

  .humidity-label,
  .humidity-status {
    font-size: 1.0625rem;
    color: var(--secondary-text-color);
  }

  /* Small (1rem) secondary text sits on the tinted cell surface: nudge the
     theme's secondary color toward its primary color so it stays
     comfortably readable. Large secondary text (the unit) keeps the plain
     secondary color. */
  @supports (color: color-mix(in srgb, currentColor 5%, transparent)) {
    .humidity-label,
    .humidity-status {
      color: color-mix(in srgb, var(--secondary-text-color, currentColor), var(--primary-text-color, currentColor) 25%);
    }
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
 * name; the older entity / humidity keys are still accepted.
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
  const name = textField(raw, "name", where);
  if (humidityEntity) sensor.humidity_entity = humidityEntity;
  if (name) sensor.name = name;
  return sensor;
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
  };

  if (raw.sensors !== undefined) {
    if (raw.entity !== undefined) {
      throw new Error("Use either 'entity' (one sensor) or 'sensors' (a list), not both.");
    }
    if (!Array.isArray(raw.sensors) || raw.sensors.length === 0) {
      throw new Error("'sensors' must be a list with at least one sensor, each with a 'temp_entity'.");
    }
    return { sensors: raw.sensors.map((item, index) => normalizeSensor(item, `sensors item ${index + 1}`)), ...precision };
  }

  if (typeof raw.entity !== "string" || raw.entity.trim() === "") throw new Error(USAGE);
  return { sensors: [{ temp_entity: raw.entity.trim() }], ...precision };
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

  const stateObj = hass.states[entity];
  const label = stateObj ? NO_HUMIDITY_READING_LABELS[stateObj.state] : "Humidity sensor not found";
  if (!stateObj || label) return `<div class="humidity"><span class="humidity-status">${label}</span></div>`;

  // Humidity is shown as one formatted string ("54%"), keeping HA's own
  // spacing between value and unit for the user's locale.
  const parts = formatParts(hass, stateObj, digits);
  let text = parts.map((part) => part.value).join("");
  if (!parts.some((part) => part.type === "unit") && stateObj.attributes.unit_of_measurement) {
    text += stateObj.attributes.unit_of_measurement;
  }
  return `
    <div class="humidity">
      <span class="humidity-value">${escapeHtml(text)}</span>
      <span class="humidity-label">humidity</span>
    </div>
  `;
}

function renderCell(hass: HomeAssistant, sensor: SensorConfig, config: TemperatureCardConfig): string {
  const stateObj = hass.states[sensor.temp_entity];
  const name = sensor.name || stateObj?.attributes.friendly_name || sensor.temp_entity;
  return `
    <div class="cell">
      <span class="accent" aria-hidden="true"></span>
      <div class="name">${escapeHtml(name)}</div>
      ${renderTemperature(hass, stateObj, config.temperaturePrecision)}
      ${renderHumidity(hass, sensor.humidity_entity, config.humidityPrecision)}
    </div>
  `;
}

export class TemperatureCard extends HTMLElement {
  private _config?: TemperatureCardConfig;
  private _hass?: HomeAssistant;
  /**
   * Last markup written. The markup depends only on the configured
   * entities, so an unrelated HA state change produces identical markup
   * and the DOM is left alone.
   */
  private _renderedHtml?: string;

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  /**
   * Invalid configuration throws, which is Home Assistant's convention: HA
   * catches it and shows its own error card with this message.
   */
  setConfig(config: unknown): void {
    this._config = normalizeConfig(config);
    this._render();
  }

  set hass(hass: HomeAssistant) {
    this._hass = hass;
    this._render();
  }

  get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  /**
   * Masonry-view height estimate (1 = 50px). Assumes one cell per row,
   * since masonry columns are usually narrower than two cells need.
   */
  getCardSize(): number {
    return 3 * (this._config?.sensors.length ?? 1);
  }

  private _render(): void {
    const root = this.shadowRoot;
    if (!root || !this._config || !this._hass) return;

    const hass = this._hass;
    const config = this._config;
    const html = `
      <style>${STYLES}</style>
      <ha-card>
        <div class="grid">${config.sensors.map((sensor) => renderCell(hass, sensor, config)).join("")}</div>
        <div class="build">${escapeHtml(TEMPERATURE_CARD_BUILD)}</div>
      </ha-card>
    `;
    if (html === this._renderedHtml) return;
    this._renderedHtml = html;
    root.innerHTML = html;
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
