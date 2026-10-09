---
name: add-shard
description: Add a new shard (reusable Three.js building block) to keemera/shards. Use when creating a new class in src/shards, e.g. a tracked mesh, mask, overlay, fitted model or any object meant to be exported from 'keemera/shards'.
---

# Add a shard

A shard is a reusable Three.js object (usually a `Group` or `Mesh` subclass) exported from `keemera/shards`.

## Checklist

1. Create `src/shards/<Name>/index.js` with a default-exported class (template below).
2. Export it from `src/shards/index.js`, keeping lines alphabetical:
   ```js
   export { default as <Name> } from './<Name>'
   ```
   Extra named exports (like `FullscreenQuad`'s shaders) get a prefixed alias.
3. Document it in `README.md`:
   - add a `#### <Name>` section under **Building blocks → Shards**: one-paragraph description, options with defaults, a short code example, useful properties
   - mention it in the `keemera/shards` import line under **Exports** if it's a common one
4. If the public usage is non-obvious, update `skills/keemera/SKILL.md` (consumer skill).
5. Try it in `examples/basic` (it imports from `src/` via aliases), then run `npm run lint` and `npm run build`.

## Rules

- Props object constructor: `constructor(props = {})` or destructured `({ store, ... } = {})`.
- Needs app data (viewport, mouse, camera, uniforms, events)? Take `store` and validate it:
  ```js
  this.#store = requireStore(props.store, new.target.name)
  ```
  Never import anything global; everything comes from `store`.
- Private state in `#fields`, setup in `#init()`.
- Implement only the hooks that make sense, so it works with `Shepherd`:
  - `update(state)`: per frame, `state` is the frame state (`delta, elapsed, frame, width, height, dpr, scroll, mouse`)
  - `resize(state)`: on `APP_RESIZE`
  - `destroy()`: dispose materials/geometries/render targets, disconnect observers, remove listeners. Call `super.destroy()` when extending a shard.
- Shared geometry can be a module-level constant (see `PlaneBackground`); don't dispose it in `destroy()`.
- Errors and warnings start with `[Keemera]` and explain the fix.
- Extend existing shards rather than duplicating (`PlaneBackground` and `SectionMask` build on `Tracker`/`StencilMesh`).

## Template

```js
import { Group } from 'three'
import requireStore from '../../utils/requireStore'

export default class <Name> extends Group {
    #store

    constructor(props = {}) {
        super()
        this.#store = requireStore(props.store, new.target.name)

        this.material = undefined

        this.#init()
    }

    #init() {
        // build meshes, read from this.#store
    }

    update(state) {
    }

    resize(state) {
    }

    destroy() {
        this.material?.dispose()
    }
}
```

## Reference implementations

- `src/shards/PlaneBackground/index.js`: small subclass of `Tracker`, shared geometry
- `src/shards/Tracker/index.js`: store usage, observers, sticky config, cleanup
- `src/shards/FitModel/index.js`: no store, works standalone with `fit(w, h)`
