/**
 * temperature-card: a Home Assistant Lovelace card showing the current
 * reading of one temperature sensor.
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

interface TemperatureCardConfig {
  entity: string;
}

/** States that mean "there is no reading", with the text shown for each. */
const NO_READING_LABELS: Record<string, string> = {
  unavailable: "Unavailable",
  unknown: "No reading",
};

/**
 * Colors come only from Home Assistant theme variables, with no literal
 * fallbacks. ha-card supplies the themed background and primary text
 * color, which the name and value inherit. If --secondary-text-color were
 * ever undefined, the declaration falls back to the inherited (primary)
 * color instead of a hard-coded one. The font family is inherited from
 * Home Assistant. Sizes use rem so they scale with the browser's font size.
 */
const STYLES = `
  :host {
    display: block;
  }

  ha-card {
    height: 100%;
    box-sizing: border-box;
    padding: 16px 20px 20px;
  }

  .name {
    font-size: 1.25rem;
    font-weight: var(--ha-font-weight-medium, 500);
    line-height: 1.35;
    overflow-wrap: anywhere;
  }

  .reading {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: 0.25rem;
    margin-top: 0.25rem;
  }

  .value {
    font-size: 3.5rem;
    font-weight: var(--ha-font-weight-normal, 400);
    line-height: 1.1;
    letter-spacing: -0.01em;
  }

  .unit {
    font-size: 1.5rem;
    color: var(--secondary-text-color);
  }

  .status {
    margin-top: 0.5rem;
    font-size: 1.25rem;
    line-height: 1.35;
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

/**
 * Splits a state into its displayed value and unit, preferring HA's own
 * formatter. The unit falls back to the entity's unit_of_measurement.
 */
function formatReading(hass: HomeAssistant, stateObj: HassEntity): { value: string; unit: string } {
  const fallbackUnit = stateObj.attributes.unit_of_measurement ?? "";

  if (typeof hass.formatEntityStateToParts === "function") {
    try {
      const parts = hass.formatEntityStateToParts(stateObj);
      const join = (type: ValuePart["type"]) =>
        parts.filter((part) => part.type === type).map((part) => part.value).join("");
      const value = join("value");
      if (value) {
        return { value, unit: join("unit") || fallbackUnit };
      }
    } catch {
      // Fall through to the raw state below.
    }
  }

  return { value: stateObj.state, unit: fallbackUnit };
}

export class TemperatureCard extends HTMLElement {
  private _config?: TemperatureCardConfig;
  private _hass?: HomeAssistant;
  /** Last markup written, so unrelated HA state changes don't rebuild the DOM. */
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
    const entity = (config as { entity?: unknown } | null | undefined)?.entity;
    if (typeof entity !== "string" || entity.trim() === "") {
      throw new Error("Set 'entity' to a temperature sensor, e.g. entity: sensor.living_room_temperature");
    }
    this._config = { entity: entity.trim() };
    this._render();
  }

  set hass(hass: HomeAssistant) {
    this._hass = hass;
    this._render();
  }

  get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  getCardSize(): number {
    return 2;
  }

  private _render(): void {
    const root = this.shadowRoot;
    if (!root || !this._config || !this._hass) return;

    const html = `
      <style>${STYLES}</style>
      <ha-card>${this._renderContent(this._config, this._hass)}</ha-card>
    `;
    if (html === this._renderedHtml) return;
    this._renderedHtml = html;
    root.innerHTML = html;
  }

  private _renderContent(config: TemperatureCardConfig, hass: HomeAssistant): string {
    const stateObj = hass.states[config.entity];
    if (!stateObj) {
      return `
        <div class="name">${escapeHtml(config.entity)}</div>
        <div class="status">Entity not found</div>
      `;
    }

    const name = escapeHtml(stateObj.attributes.friendly_name || config.entity);
    const noReadingLabel = NO_READING_LABELS[stateObj.state];
    if (noReadingLabel) {
      return `
        <div class="name">${name}</div>
        <div class="status">${noReadingLabel}</div>
      `;
    }

    const { value, unit } = formatReading(hass, stateObj);
    return `
      <div class="name">${name}</div>
      <div class="reading">
        <span class="value">${escapeHtml(value)}</span>
        ${unit ? `<span class="unit">${escapeHtml(unit)}</span>` : ""}
      </div>
    `;
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
  description: "Shows the current reading of a temperature sensor.",
});

customElements.define("temperature-card", TemperatureCard);

console.info(`temperature-card ${TEMPERATURE_CARD_BUILD}`);
