# CLAUDE.md

## Project

This repository contains `temperature-card`, a custom Home Assistant Lovelace card for temperature sensors.

The long-term goal is a compact, responsive, theme-aware temperature/humidity dashboard card. The current state is the known-good baseline tagged `v0.1.0-baseline`: a responsive grid of sensor cells (name, temperature, optional humidity), card-wide temperature/humidity precision, `temp_entity` / `humidity_entity` configuration with legacy compatibility, theme-derived panels with an accent rail, and a permanent build tag. Groups, averages, color ranges, history, and a visual editor are not built. Do not describe or assume features that have not been built.

## Next Feature (planned, not built)

Configurable temperature ranges using the existing accent rail: each cell's rail color is set through `--temperature-card-accent`. Agreed range rule: a reading belongs to a range when `min <= value < max`. The range configuration schema is not defined yet; design it in that pass.

## Reference Project: yardian-card

`../yardian-card` is a sibling project whose build, deploy, and repository structure are proven in this Home Assistant environment.

- It is a tooling and reference project only.
- Never modify anything in `yardian-card`.
- Do not copy Yardian application logic, entity handling, or controller-specific code.
- When tooling questions come up (build, loader, deploy, cache-busting), check how `yardian-card` does it before inventing something new.
- `deploy.ps1` must only ever write to `www\temperature-card` on the Home Assistant share. Never point it at another card's directory.

## Working Model

Work incrementally and conservatively.

Before making significant changes:
1. inspect the relevant files;
2. understand the current known-good behavior;
3. identify the smallest change that satisfies the requested milestone;
4. avoid broad refactors unless they are explicitly requested or clearly necessary.

Keep changes small and testable. Preserve known-good behavior. Do not rewrite working architecture merely because an alternative design is possible.

## Home Assistant First

Prefer native Home Assistant functionality over recreating it:
- use the `hass` object and entity state as the authoritative data;
- use HA's own formatters (e.g. `hass.formatEntityStateToParts`) for values, units, precision, and locale;
- use HA's native More Info, history, and statistics components when those features are added, rather than custom reimplementations;
- follow HA conventions for card registration, `setConfig` errors, and sizing.

Do not hard-code assumptions about YoLink, ecobee, or any other integration. The card works on normal HA entities and their state, attributes, and registry/device metadata. Never rely on entity ID naming patterns unless configuration supplies them.

Before major architectural changes, inspect existing Home Assistant frontend and upstream patterns first.

Do not introduce `card-mod` or another external frontend dependency as a requirement.

## Theming (hard requirement)

Full theme awareness is required.

- Use Home Assistant theme CSS variables for all colors. Do not hard-code white, black, or other surface/text colors.
- Let `ha-card` provide the card surface, border, radius, and shadow.
- Inherit Home Assistant's font stack; never import external fonts.
- The card must look right under both dark and light HA themes, and remain readable under arbitrary user themes.
- Don't rely on a single theme variable for visible separation: themes often define variables that are present but weak (identical card/page backgrounds, faint dividers), and `var()` fallbacks only cover undefined variables. Derive surfaces and outlines from theme variables with `color-mix()` (anchored to the text color, which every usable theme contrasts with its surfaces), with a plain-variable fallback for browsers without it.
- Check visual changes against real installed themes (`Z:\themes`, read-only), including Graphite E-ink Dark, not just HA's defaults. Judge them from real rendered screenshots (including HA's panel-view layout), not contrast numbers alone.
- Cell design: a sensor cell is a panel defined by its surface (a tint of the text color), not by a full outline, plus one accent rail. Don't reintroduce visible outlines or tune border contrast to fix separation.
- The accent rail's color is controlled only by the cell-level custom property `--temperature-card-accent`, which the card reads but never declares (default: the theme's `--primary-color`). Future temperature-range coloring sets that property per cell; don't color the rail any other way.
- Text weights follow the theme's `--ha-font-weight-*` variables but are capped at 600, because some themes (Graphite E-ink: 900) make large numerals blocky.

## Readability and Accessibility (hard requirement)

The card must be comfortably readable for older eyes.

- No tiny typography. Nothing is smaller than 1rem (16px), and that size is only for short secondary labels; names are at least 1.25rem; the temperature is by far the largest element. Exceptions: the build tag (0.8125rem) and the tertiary battery percentage (0.875–1rem, with the level also shown by the icon's bars and in its label).
- Battery status is tertiary: bottom right of the cell, never near the name, never competing with temperature or humidity. Low/critical are the only states that draw attention, and they must differ by icon bars as well as color.
- Humidity is shown as the percentage alone (no visible "humidity"/"RH" label; the word is in the tooltip and screen-reader text). No reading shows "--%".
- Never shrink text to fit more grid columns. Fewer, readable columns beat more, smaller ones.
- Use rem-based sizes so the browser's font-size setting is respected.
- Keep contrast high: primary text color for names and values, secondary text color only for large supporting text.
- Elegant, calm typography. No monospace/terminal styling, gauges, gradients, or decorative icons.

## Development Style

Prefer:
- TypeScript with explicit types;
- one source file until there is a real reason to split;
- readable code over clever code;
- no runtime dependencies;
- defensive handling of unavailable, unknown, and missing entities.

Avoid:
- frameworks unless clearly justified;
- speculative abstractions (managers, registries, services, state machines);
- features that are not part of the current milestone.

## Build and Version Identification

`src/temperature-card.ts` contains the `__TEMPERATURE_CARD_BUILD__` placeholder. `deploy.ps1` replaces it in the deployed copy only, with `TEMPERATURE <git short hash>-<manifest hash>`.

The identifier is shown as a small build tag at the bottom-left of the card, below the grid, in every configuration (permanent requirement), and is also logged to the browser console on load (`temperature-card TEMPERATURE ...`). It is the only text allowed below the 1rem minimum (0.8125rem, theme secondary color), because it is a diagnostic label rather than content.

Never judge a visual change in Home Assistant without first confirming the build tag shows the expected identifier.

Do not remove the build tag, the console line, or the placeholder mechanism unless explicitly requested.

## Generated Files

`dist/` and `node_modules/` are generated and ignored by Git. Do not edit files in `dist/`. Change the source and rebuild.

## Testing

For every implementation milestone:

1. run `npm run typecheck` and `npm run build`;
2. fix TypeScript/build errors;
3. verify that `dist/temperature-card.js` is produced;
4. describe exactly what changed;
5. state what should be tested manually in Home Assistant, including under a light theme and a dark theme;
6. stop at the requested milestone.

## Change Discipline

When debugging:
- identify the failing layer first;
- form a specific hypothesis;
- prefer a discriminating test over speculative patches;
- investigate upstream Home Assistant behavior when appropriate;
- avoid stacking workaround upon workaround.

If two or more attempted fixes fail, stop and reassess the underlying assumption before continuing.

## Scope Control

When given a prompt for one milestone, complete that milestone and stop. Do not redesign unrelated parts, add speculative features, change architecture silently, or perform unrelated cleanup. If a larger change appears necessary, explain why before implementing it.

## Communication

At the end of each task, report exactly:

- files changed;
- a concise summary of the implementation;
- how it was tested, and the build/test result;
- any assumptions made;
- exact manual verification steps;
- anything that remains uncertain.

Keep reports concise and technical.
