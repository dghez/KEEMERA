# KEEMERA

> **Disclaimer:** This repo is a port from an existing Nuxt project. It is not fully self-contained yet — some dependencies from the original setup are missing. In particular, you'll need to wire up path aliases used throughout the codebase (`@gl/` for this module, `@js/` for shared app utilities) and provide the events emitter (`@js/events`) that drives the render loop and GL lifecycle. Imports referencing those aliases will not resolve until you add them to your bundler config or replace them with relative paths.

A **Three.js starter** for building WebGL experiences. It ships with renderer setup, a shared state store, asset loading, reusable shader snippets, and a scene lifecycle pattern — so you can focus on your own 3D content instead of boilerplate.

The `Scene/` folder is intentionally empty. Add your meshes, effects, and logic there.

## What's included

| Module | Role |
|---|---|
| `Core/` | WebGL renderer, camera, time, mouse, size, gestures |
| `Scene/` | Your scene graph — add components here |
| `store/` | Shared reactive state (renderer, camera, DOM refs, debug flags) |
| `resources/` | YAML-driven asset loader (textures, GLTF, KTX2) |
| `shaders/` | Reusable GLSL snippets (noise, blending, color, UV helpers) |
| `shards/` | Optional reusable Three.js building blocks |
| `helpers/` | Small geometry / UV utilities |
| `data/` | Runtime settings (layers, render order) |

## Tech stack

- **Three.js** — rendering
- **@vue/reactivity** — reactive store

Node **20.19.0** (see `.nvmrc`).

## Project structure

```
.
├── index.js              # Gl class — boot, load, render loop hooks
├── store/index.js        # Shared state + GL lifecycle events
├── Core/
│   ├── index.js          # Renderer, resize, render
│   ├── Camera/           # Perspective camera
│   ├── Time/             # Delta / elapsed time
│   ├── Mouse/            # Smoothed pointer
│   ├── Size/             # Viewport dimensions
│   ├── Gestures/         # Pointer / touch input
│   ├── Sheperd/          # Scene component lifecycle manager
│   └── uniforms/shared.js
├── Scene/
│   └── index.js          # ← start here
├── resources/
│   ├── index.js          # Asset loader
│   └── data.yml          # Asset manifest
├── shaders/              # Shared GLSL imports
├── shards/               # Reusable components
├── helpers/
└── data/settings.yml
```

## How it works

### Boot sequence

1. Instantiate `Gl` with a DOM `wrapper` and `canvas`.
2. `Core` creates the WebGL renderer, camera, and registers subsystems on the store.
3. Assets load from `resources/data.yml` (and any extra data you fetch in `#load()`).
4. `Scene` is added to the Three.js scene graph.
5. The store emits lifecycle states: `loading` → `loaded` → `ready`.

### Render loop

The host app drives the loop through an event bus (`@js/events`):

| Event | When |
|---|---|
| `APP_TICK` | Every frame — updates scene, then renders |
| `APP_RESIZE` | Viewport size changes |

### Scene components

`Scene` extends a Three.js `Group` and uses **Shepherd** to manage child components. Each component can implement `update()`, `resize()`, and `destroy()`.

### Shepherd

`Core/Sheperd` is a small lifecycle manager — a registry that holds scene components and forwards calls to them. When `Scene` receives `update`, `resize`, or `destroy`, Shepherd iterates its list and calls the matching method on each registered component (if it exists). This keeps `Scene/index.js` thin: you add components with `shepherd.add()`, add them to the Three.js graph with `this.add()`, and Shepherd handles the rest.

Components only need to implement the hooks they care about — all three are optional.

```js
// Scene/index.js
import { Group } from 'three'
import Shepherd from '@gl/Core/Sheperd'
import MyEffect from './MyEffect'

export default class Scene extends Group {
    #shepherd

    constructor() {
        super()
        this.#shepherd = new Shepherd()
        this.#init()
    }

    #init() {
        const effect = new MyEffect()
        this.#shepherd.add(effect)
        this.add(effect)
    }

    update(v) { this.#shepherd.update(v) }
    resize() { this.#shepherd.resize() }
    destroy() { this.#shepherd.destroy() }
}
```

Access shared state anywhere via the store:

```js
import store from '@gl/store'

store.camera.position.z = 50
store.helpers.uniforms.time.value = store.time.elapsed
```

## Assets

Declare assets in `resources/data.yml`:

```yaml
- key: 'my-texture'
  type: 'texture'
  path: 'gl/images/my-texture.jpg'

- key: 'my-model'
  type: 'gltf'
  path: 'gl/models/my-model.glb'
```

Load and retrieve them:

```js
import resources from '@gl/resources'

await resources.load()
const texture = resources.get('my-texture')
```

Supported types: `texture` (with optional KTX2 compression), `gltf`, `envmap`, `gainmap`, `fbo`.

## Shaders

Import shared GLSL from `shaders/` in your materials:

```js
import snoise from '@gl/shaders/noise3d.glsl'
import map from '@gl/shaders/map.glsl'

const fragmentShader = /* glsl */`
    ${snoise}
    ${map}
    // ...
`
```

Available snippets include `noise3d`, `curlNoise`, `map`, `coverUv`, `aastep`, `remapProgress`, and blend modes.

## Shards

Optional reusable components in `shards/`:

| Shard | Purpose |
|---|---|
| `BufferViewer` | Debug texture overlay |
| `FullscreenQuad` | Full-screen pass geometry |
| `FitModel` | Scale a model to a bounding volume |
| `PlaneBackground` | Flat background plane |
| `SectionMask` | Stencil-based section masking |
| `StencilMesh` | Stencil write mesh |
| `Tracker` | DOM element → 3D position sync |

Copy or import shards as needed — none are wired into the default scene.

## Debug mode

| URL param | Effect |
|---|---|
| `?debug` | Enables debug tooling |
| `?showHelpers` | Shows scene helpers |

## Configuration

- **`resources/data.yml`** — Asset manifest
- **`data/settings.yml`** — Render layers and draw order

## Getting started checklist

1. Provide a wrapper element and canvas in your HTML.
2. Wire up `APP_TICK` and `APP_RESIZE` events from your app loop.
3. Create scene components under `Scene/` and register them in `Scene/index.js`.
4. Add assets to `resources/data.yml` and place files in your static assets folder.
5. Trim any leftover project-specific logic in `index.js` `#load()` (e.g. custom data fetches you no longer need).
6. Remove unused entries from the store if you don't need them.

## Development

```bash
nvm use    # Node 20.19.0
```

ESLint and Prettier config is included. Code style: 4-space indent, no semicolons.

## License

See the repository owner for licensing details.
