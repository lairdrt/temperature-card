# CLAUDE.md

## Project

This repository contains `temperature-card`, a custom Home Assistant Lovelace card for temperature sensors.

The long-term goal is a compact, responsive, theme-aware temperature/humidity dashboard card. The current state is an early baseline: one card showing one sensor's current reading. Do not describe or assume features that have not been built.

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

## Readability and Accessibility (hard requirement)

The card must be comfortably readable for older eyes.

- No tiny typography. The smallest text is 1.25rem; the main reading is much larger.
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

`src/temperature-card.ts` contains the `__TEMPERATURE_CARD_BUILD__` placeholder. `deploy.ps1` replaces it in the deployed copy only, with `TEMPERATURE <git short hash>-<manifest hash>`. The card logs it to the browser console on load (`temperature-card TEMPERATURE ...`) so you can confirm which build Home Assistant actually loaded.

Do not remove the build identifier or the placeholder mechanism unless explicitly requested.

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
