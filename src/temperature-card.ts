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
 * with "TEMPERATURE <git short hash>-<manifest hash>". It is logged to the
 * browser console on load rather than rendered, so the card itself stays
 * clean.
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
}

/** One cell of the grid. */
interface SensorConfig {
  /** Temperature entity (required). */
  entity: string;
  /** Optional humidity entity shown under the temperature. */
  humidity?: string;
  /** Optional display name; defaults to the temperature entity's friendly name. */
  name?: string;
}

/**
 * Normalized configuration. The single-sensor form (`entity:`) becomes a
 * one-item `sensors` list, so there is only one rendering path.
 */
interface TemperatureCardConfig {
  sensors: SensorConfig[];
}

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
 * without container units. The cell surface is a faint tint of the theme's
 * text color (lighter on dark themes, darker on light ones), and its
 * corners follow the theme's card radius.
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
    padding: 12px;
  }

  .grid {
    display: grid;
    gap: 8px;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, max(220px, (100% - 3 * 8px) / 4)), 1fr));
  }

  .cell {
    container-type: inline-size;
    min-width: 0;
    box-sizing: border-box;
    padding: 14px 16px 16px;
    border-radius: calc(var(--ha-card-border-radius, 12px) * 0.75);
    border: 1px solid var(--divider-color);
    overflow-wrap: anywhere;
  }

  @supports (background: color-mix(in srgb, currentColor 5%, transparent)) {
    .cell {
      background: color-mix(in srgb, var(--primary-text-color) 4%, transparent);
    }
  }

  .name {
    font-size: 1.25rem;
    font-size: clamp(1.125rem, 8.5cqi, 1.5rem);
    font-weight: var(--ha-font-weight-medium, 500);
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
    font-size: clamp(2.75rem, 31cqi, 6rem);
    line-height: 1;
  }

  .reading > *,
  .humidity > * {
    min-width: 0;
  }

  .value {
    font-weight: var(--ha-font-weight-normal, 400);
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

  .humidity {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: 0.4rem;
    margin-top: 0.625rem;
    line-height: 1.15;
  }

  .humidity-value {
    font-size: 1.75rem;
    font-size: clamp(1.5rem, 14cqi, 2.25rem);
  }

  .humidity-label,
  .humidity-status {
    font-size: 1rem;
    color: var(--secondary-text-color);
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
  "Set 'entity' to a temperature sensor, e.g. entity: sensor.living_room_temperature, or list several under 'sensors'.";

function entityId(value: unknown, where: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${where}: 'entity' must be a temperature sensor entity ID.`);
  }
  return value.trim();
}

function optionalText(value: unknown, key: string, where: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${where}: '${key}' must be non-empty text if set.`);
  }
  return value.trim();
}

function normalizeSensor(item: unknown, where: string): SensorConfig {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new Error(`${where}: each sensor needs an 'entity'.`);
  }
  const raw = item as Record<string, unknown>;
  const sensor: SensorConfig = { entity: entityId(raw.entity, where) };
  const humidity = optionalText(raw.humidity, "humidity", where);
  const name = optionalText(raw.name, "name", where);
  if (humidity) sensor.humidity = humidity;
  if (name) sensor.name = name;
  return sensor;
}

/**
 * Accepts either `entity: <id>` (one sensor) or `sensors: [...]`, and
 * returns the single normalized form. Throws on anything else.
 */
function normalizeConfig(config: unknown): TemperatureCardConfig {
  if (!config || typeof config !== "object") throw new Error(USAGE);
  const raw = config as Record<string, unknown>;

  if (raw.sensors !== undefined) {
    if (raw.entity !== undefined) {
      throw new Error("Use either 'entity' (one sensor) or 'sensors' (a list), not both.");
    }
    if (!Array.isArray(raw.sensors) || raw.sensors.length === 0) {
      throw new Error("'sensors' must be a list with at least one sensor, each with an 'entity'.");
    }
    return { sensors: raw.sensors.map((item, index) => normalizeSensor(item, `sensors item ${index + 1}`)) };
  }

  if (typeof raw.entity !== "string" || raw.entity.trim() === "") throw new Error(USAGE);
  return { sensors: [{ entity: raw.entity.trim() }] };
}

/**
 * A state as display parts, preferring HA's own formatter. The fallback is
 * the raw state followed by the entity's unit_of_measurement.
 */
function formatParts(hass: HomeAssistant, stateObj: HassEntity): ValuePart[] {
  if (typeof hass.formatEntityStateToParts === "function") {
    try {
      const parts = hass.formatEntityStateToParts(stateObj);
      if (parts.some((part) => part.type === "value" && part.value)) return parts;
    } catch {
      // Fall through to the raw state below.
    }
  }
  const parts: ValuePart[] = [{ type: "value", value: stateObj.state }];
  const unit = stateObj.attributes.unit_of_measurement;
  if (unit) parts.push({ type: "unit", value: unit });
  return parts;
}

function joinParts(parts: ValuePart[], type: ValuePart["type"]): string {
  return parts.filter((part) => part.type === type).map((part) => part.value).join("");
}

function renderTemperature(hass: HomeAssistant, stateObj: HassEntity | undefined): string {
  if (!stateObj) return `<div class="reading"><span class="status">Entity not found</span></div>`;

  const noReadingLabel = NO_READING_LABELS[stateObj.state];
  if (noReadingLabel) return `<div class="reading"><span class="status">${noReadingLabel}</span></div>`;

  const parts = formatParts(hass, stateObj);
  const value = joinParts(parts, "value");
  const unit = joinParts(parts, "unit") || stateObj.attributes.unit_of_measurement || "";
  return `
    <div class="reading">
      <span class="value">${escapeHtml(value)}</span>
      ${unit ? `<span class="unit">${escapeHtml(unit)}</span>` : ""}
    </div>
  `;
}

function renderHumidity(hass: HomeAssistant, entity: string | undefined): string {
  if (!entity) return "";

  const stateObj = hass.states[entity];
  const label = stateObj ? NO_HUMIDITY_READING_LABELS[stateObj.state] : "Humidity sensor not found";
  if (!stateObj || label) return `<div class="humidity"><span class="humidity-status">${label}</span></div>`;

  // Humidity is shown as one formatted string ("54%"), keeping HA's own
  // spacing between value and unit for the user's locale.
  const parts = formatParts(hass, stateObj);
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

function renderCell(hass: HomeAssistant, sensor: SensorConfig): string {
  const stateObj = hass.states[sensor.entity];
  const name = sensor.name || stateObj?.attributes.friendly_name || sensor.entity;
  return `
    <div class="cell">
      <div class="name">${escapeHtml(name)}</div>
      ${renderTemperature(hass, stateObj)}
      ${renderHumidity(hass, sensor.humidity)}
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
    const html = `
      <style>${STYLES}</style>
      <ha-card>
        <div class="grid">${this._config.sensors.map((sensor) => renderCell(hass, sensor)).join("")}</div>
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
