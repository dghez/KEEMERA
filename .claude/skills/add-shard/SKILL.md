---
name: add-shard
description: Add a new shard (reusable Three.js building block) to @dghez/keemera/shards. Use when creating a new class in src/shards, e.g. a tracked mesh, mask, overlay, fitted model or any object meant to be exported from '@dghez/keemera/shards'.
---

# Add a shard

A shard is a reusable Three.js object (usually a `Group` or `Mesh` subclass) exported from `@dghez/keemera/shards`.

## Checklist

1. Create `src/shards/<Name>/index.ts` with a default-exported class and an exported `<Name>Props` interface (template below).
2. Export it from `src/shards/index.ts`, keeping lines alphabetical, plus its types in the `export type` block:
   ```ts
   export { default as <Name> } from './<Name>'
   export type { <Name>Props } from './<Name>'
   ```
   Extra named exports (like `FullscreenQuad`'s shaders) get a prefixed alias.
3. Document it in `README.md`:
   - add a `#### <Name>` section under **Building blocks → Shards**: one-paragraph description, options with defaults, a short code example, useful properties
   - mention it in the `@dghez/keemera/shards` import line under **Exports** if it's a common one
4. If the public usage is non-obvious, update `skills/keemera/SKILL.md` (consumer skill).
5. Try it in `examples/basic` (it imports from `src/` via aliases), then run `npm run typecheck`, `npm run lint` and `npm run build`.

## Rules

- Props object constructor typed with the exported interface: `constructor(props: <Name>Props)` or destructured `({ store, ... }: <Name>Props)`.
- Needs app data (viewport, mouse, camera, uniforms, events)? Take `store` and validate it:
  ```ts
  this.#store = requireStore(props.store, new.target.name)
  ```
  Never import anything global; everything comes from `store`.
- Private state in typed `#fields`, public fields declared with their types, setup in `#init()`.
- Implement only the hooks that make sense, so it works with `Shepherd`:
  - `update(state)`: per frame, `state` is the frame state (`delta, elapsed, frame, width, height, dpr, scroll, mouse`)
  - `resize(state)`: on `APP_RESIZE`
  - `destroy()`: dispose materials/geometries/render targets, disconnect observers, remove listeners. Call `super.destroy()` when extending a shard.
- Shared geometry can be a module-level constant (see `PlaneBackground`); don't dispose it in `destroy()`.
- Errors and warnings start with `[Keemera]` and explain the fix.
- Extend existing shards rather than duplicating (`PlaneBackground` and `SectionMask` build on `Tracker`/`StencilMesh`).

## Template

```ts
import { Group } from 'three'
import type { MeshBasicMaterial } from 'three'

import requireStore from '../../utils/requireStore'
import type { FrameState, Store } from '../../types'

export interface <Name>Props {
    store: Store
}

export default class <Name> extends Group {
    #store: Store

    material: MeshBasicMaterial | undefined

    constructor(props: <Name>Props) {
        super()
        this.#store = requireStore(props.store, new.target.name)

        this.material = undefined

        this.#init()
    }

    #init() {
        // build meshes, read from this.#store
    }

    update(state: FrameState) {
    }

    resize(state: FrameState) {
    }

    destroy() {
        this.material?.dispose()
    }
}
```

## Reference implementations

- `src/shards/PlaneBackground/index.ts`: small subclass of `Tracker`, shared geometry
- `src/shards/Tracker/index.ts`: store usage, observers, sticky config, cleanup
- `src/shards/FitModel/index.ts`: no store, works standalone with `fit(w, h)`
