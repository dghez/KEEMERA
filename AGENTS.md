# AGENTS.md

Guidance for coding agents working on the **keemera** library. `README.md` is the full public API reference; this file covers how the code is organized and how to change it.

## What it is

A self-contained, multi-instance Three.js starter library. Each `new Keemera({ wrapper, canvas })` owns its renderer, camera, scene, store, emitter, resources, viewport, mouse and time. **Nothing is global**: pass `store` around, never import shared state.

- TypeScript (`strict`), ESM. No tests. Declarations ship in `dist/` next to the JS.
- Examples in `examples/basic` stay plain JavaScript.
- Peer deps: `three >=0.180`, `gsap >=3.12`, optional `@monogrid/gainmap-js`. Runtime dep: `@use-gesture/vanilla`.
- The loop runs on `gsap.ticker`. Each `tick()`: time/mouse/camera update → `APP_TICK` → `WEBGL_BEFORE_RENDER` → render → `WEBGL_AFTER_RENDER`.
- Pre-1.0: breaking changes are allowed but must be reflected in the README.

## Layout

```
src/
  index.ts          root barrel (@dghez/keemera), also re-exports public types
  Keemera.ts        app class: options, tick, resize, render function, destroy
  types.ts          shared public types: Store, FrameState, KeemeraOptions, …
  Core/             renderer setup, uniforms, Camera/ Gestures/ Mouse/ Time/ Viewport/
  events/           EVENTS, PRIORITY, createEmitter, Emitter.ts, types.ts (KeemeraEventMap)
  store/            createStore(), GL_STATES
  resources/        asset loader; GLTFCurveExtension.js is vendored JS (typed by its .d.ts), don't edit it
  shards/           one <Name>/index.ts per shard + index.ts barrel (@dghez/keemera/shards)
  helpers/          one <name>.ts per helper + index.ts barrel (@dghez/keemera/helpers)
  shaders/          one <name>.ts per GLSL snippet + index.ts barrel (@dghez/keemera/shaders)
  utils/            Shepherd, dom (rect, qs, clamp), requireStore
examples/basic/     dev playground (Lenis, Tracker, sticky, post-processing)
examples/assets/    static files for the examples
skills/keemera/     consumer skill, shipped in the npm package
scripts/            build helpers (fix-dts-imports.js adds .js to relative imports in dist .d.ts)
dist/               build output, gitignored
```

## Public API surface

Four entry points, kept in sync across:

| Entry | Barrel | `vite.config.js` entry | README section |
|---|---|---|---|
| `@dghez/keemera` | `src/index.ts` | `index` | Getting started → Exports |
| `@dghez/keemera/shards` | `src/shards/index.ts` | `shards/index` | Building blocks → Shards |
| `@dghez/keemera/helpers` | `src/helpers/index.ts` | `helpers/index` | Building blocks → Helpers |
| `@dghez/keemera/shaders` | `src/shaders/index.ts` | `shaders/index` | Building blocks → Shaders |

Any public change updates the barrel **and** the README. Public types (props interfaces, payloads) are exported with `export type` from the same barrel. A new entry point also needs `vite.config.js` and a `package.json` `exports` entry with `types` and `import`. Keep barrel exports alphabetical.

## Commands

```bash
nvm use           # Node 20.19+ (.nvmrc)
npm run dev       # examples/basic, aliases `@dghez/keemera/*` to src/ (no build needed)
npm run typecheck # tsc --noEmit, strict
npm run lint      # eslint src examples scripts
npm run build     # vite build + tsc declarations to dist/
```

There is no test runner. Verify changes with `npm run typecheck`, `npm run lint`, `npm run build`, and by running `npm run dev` (add `?debug` to the URL for state logs). Exercise new public API in `examples/basic` when it makes sense.

## Conventions

- **Style**: ESLint (`eslint.config.js`) is the source of truth: no semicolons, 4-space indent, single quotes, trailing commas in multiline literals. `.prettierrc` says `trailingComma: none`; ignore it.
- **Imports**: no extension; folders resolve to `index.ts` (`'../Tracker'`). Use `import type` for type-only imports (`verbatimModuleSyntax` is on).
- **Types**: annotate class fields (`#store: Store`) and constructor props with an exported `<Name>Props` interface. Shared types live in `src/types.ts`. Avoid `any`; when unavoidable, add an eslint-disable comment.
- **Files**: classes are PascalCase (`Name/index.ts` or `Name.ts`); functions and snippets are camelCase files with a default export.
- **Classes**: props-object constructors (`constructor(props: NameProps)`), `#private` fields, setup in a private `#init()` called from the constructor.
- **Store**: components that need app data take `{ store }` and validate it with `requireStore(props.store, new.target.name)` from `src/utils/requireStore.ts`.
- **Lifecycle**: expose `update(state)`, `resize(state)` and `destroy()` where they make sense so objects can be handed to a `Shepherd`. `destroy()` disposes materials, geometries, observers and listeners.
- **Constants**: UPPER_SNAKE, frozen with `Object.freeze({ … } as const)`. Event values are `'SCOPE:NAME'` strings.
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
