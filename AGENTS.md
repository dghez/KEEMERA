# AGENTS.md

Guidance for coding agents working on the **keemera** library. `README.md` is the full public API reference; this file covers how the code is organized and how to change it.

## What it is

A self-contained, multi-instance Three.js starter library. Each `new Keemera({ wrapper, canvas })` owns its renderer, camera, scene, store, emitter, resources, viewport, mouse and time. **Nothing is global**: pass `store` around, never import shared state.

- Plain JavaScript ESM. No TypeScript, no tests.
- Peer deps: `three >=0.180`, `gsap >=3.12`, optional `@monogrid/gainmap-js`. Runtime dep: `@use-gesture/vanilla`.
- The loop runs on `gsap.ticker`. Each `tick()`: time/mouse/camera update → `APP_TICK` → `WEBGL_BEFORE_RENDER` → render → `WEBGL_AFTER_RENDER`.
- Pre-1.0: breaking changes are allowed but must be reflected in the README.

## Layout

```
src/
  index.js          root barrel (@dghez/keemera)
  Keemera.js        app class: options, tick, resize, render function, destroy
  Core/             renderer setup, uniforms, Camera/ Gestures/ Mouse/ Time/ Viewport/
  events/           EVENTS, PRIORITY, createEmitter, Emitter.js
  store/            createStore(), GL_STATES
  resources/        asset loader; GLTFCurveExtension.js is vendored, don't edit it
  shards/           one <Name>/index.js per shard + index.js barrel (@dghez/keemera/shards)
  helpers/          one <name>.js per helper + index.js barrel (@dghez/keemera/helpers)
  shaders/          one <name>.js per GLSL snippet + index.js barrel (@dghez/keemera/shaders)
  utils/            Shepherd, dom (rect, qs, clamp), requireStore
examples/basic/     dev playground (Lenis, Tracker, sticky, post-processing)
examples/assets/    static files for the examples
skills/keemera/     consumer skill, shipped in the npm package
dist/               build output, gitignored
```

## Public API surface

Four entry points, kept in sync across:

| Entry | Barrel | `vite.config.js` entry | README section |
|---|---|---|---|
| `@dghez/keemera` | `src/index.js` | `index` | Getting started → Exports |
| `@dghez/keemera/shards` | `src/shards/index.js` | `shards/index` | Building blocks → Shards |
| `@dghez/keemera/helpers` | `src/helpers/index.js` | `helpers/index` | Building blocks → Helpers |
| `@dghez/keemera/shaders` | `src/shaders/index.js` | `shaders/index` | Building blocks → Shaders |

Any public change updates the barrel **and** the README. A new entry point also needs `vite.config.js` and `package.json` `exports`. Keep barrel exports alphabetical.

## Commands

```bash
nvm use           # Node 20.19+ (.nvmrc)
npm run dev       # examples/basic, aliases `@dghez/keemera/*` to src/ (no build needed)
npm run lint      # eslint src examples
npm run build     # vite library build to dist/
```

There is no test runner. Verify changes with `npm run lint`, `npm run build`, and by running `npm run dev` (add `?debug` to the URL for state logs). Exercise new public API in `examples/basic` when it makes sense.

## Conventions

- **Style**: ESLint (`eslint.config.js`) is the source of truth: no semicolons, 4-space indent, single quotes, trailing commas in multiline literals. `.prettierrc` says `trailingComma: none`; ignore it.
- **Imports**: no `.js` extension; folders resolve to `index.js` (`'../Tracker'`).
- **Files**: classes are PascalCase (`Name/index.js` or `Name.js`); functions and snippets are camelCase files with a default export.
- **Classes**: props-object constructors (`constructor(props = {})`), `#private` fields, setup in a private `#init()` called from the constructor.
- **Store**: components that need app data take `{ store }` and validate it with `requireStore(props.store, new.target.name)` from `src/utils/requireStore.js`.
- **Lifecycle**: expose `update(state)`, `resize(state)` and `destroy()` where they make sense so objects can be handed to a `Shepherd`. `destroy()` disposes materials, geometries, observers and listeners.
- **Constants**: UPPER_SNAKE, frozen with `Object.freeze`. Event values are `'SCOPE:NAME'` strings.
- **Errors**: prefix messages with `[Keemera]` and say how to fix the call.
- **GLSL**: `/* glsl */` template string, `#ifndef KEEMERA_<NAME>` include guard, 2-space indent inside.
- **Comments**: sparse, short `//` lines explaining why, not what.

## Git and releases

- Commit messages use a bracketed scope: `[LIBRARY]: …`, `[EXAMPLES]: …`, `[EXAMPLES // Basic]: …`, `[DOCS]: …`.
- Release: `npm run release -- <patch|minor|major>` bumps the version, commits `X.Y.Z`, tags `vX.Y.Z` and pushes with tags. Then `npm publish` by hand (`prepare` rebuilds `dist`).

## Skills

Recipes for common changes live in `.claude/skills/`:

- `add-shard`: new building block in `@dghez/keemera/shards`
- `add-shader`: new GLSL snippet in `@dghez/keemera/shaders`
- `add-event-or-helper`: new default event or priority, or a helper in `@dghez/keemera/helpers`

`skills/keemera/SKILL.md` is for apps that **use** keemera and ships in the npm package. Update it when the public API changes.
