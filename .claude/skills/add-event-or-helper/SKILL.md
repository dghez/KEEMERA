---
name: add-event-or-helper
description: Add a default event, a listener priority, or a math/texture helper to keemera. Use when changing EVENTS or PRIORITY in src/events, emitting a new app event, or adding a function to src/helpers (keemera/helpers).
---

# Add an event, priority or helper

## Default event

1. Add the key to the frozen `EVENTS` object in `src/events/index.js`, under the matching comment group (`// APP`, `// GESTURES`, `// WEBGL`, `// RESOURCES`, `// LIFECYCLE`):
   ```js
   'APP_SOMETHING': 'APP:SOMETHING',
   ```
   Key is UPPER_SNAKE; value is the same words joined with `:`.
2. Emit it from the owning module through the instance emitter, never a global one:
   ```js
   this.store.events.emit(EVENTS.APP_SOMETHING, payload)
   ```
   Existing emit sites: `src/Keemera.js` (tick, resize, destroy), `src/Core/Viewport` (scroll), `src/Core/Gestures` (mouse), `src/store` (state changes), `src/resources` (progress).
3. Add a row to the **Default events** table in `README.md` (Data and lifecycle → Events and priorities) with the exact payload. If it fires during `tick()`, update **Frame order** too.
4. If apps will listen to it, mention it in `skills/keemera/SKILL.md`.

Apps can already register their own names with `app.events.addEvents()`; only add a default event when the library itself emits it.

## Priority

Add to the frozen `PRIORITY` object in `src/events/index.js` (lower runs first; current: `first: -10`, `instant: 0`, `high: 10`, `mid: 20`, `low: 30`), then update the "Default priorities" line in the README.

## Helper

1. Create `src/helpers/<name>.js` with a single default-exported function. Import only from `three` (no store, no DOM unless unavoidable).
   ```js
   export default function <name>(arg, options = [1, 1]) {
   }
   ```
2. Export it from `src/helpers/index.js`, alphabetical:
   ```js
   export { default as <name> } from './<name>'
   ```
3. Add a bullet to `README.md` under **Building blocks → Helpers** with the signature and what it returns or mutates, and add it to the `keemera/helpers` import line in **Exports** and in the Helpers code block.

Reference: `src/helpers/uvCover.js`, `src/helpers/getPlaneSize.js`.

## Verify

`npm run lint`, `npm run build`, and run `npm run dev` with `?debug` to check the event fires or the helper behaves.
