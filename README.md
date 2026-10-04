# KEEMERA

> **Releasing a new version** (commit everything first, the working tree must be clean):
>
> ```bash
> npm run release 0.2.0   # or: patch | minor | major
> ```
>
> Updates `version` in `package.json`, commits, tags `v0.2.0` and pushes. Install it in a project with:
>
> ```bash
> npm i github:dghez/KEEMERA#v0.2.0 three gsap
> ```

A self-contained **Three.js starter library** for WebGL experiences. Each `new Keemera()` is an isolated app with its own renderer, camera, store, event system, viewport (size and scroll), resources and lifecycle manager, so you can run several on the same page.

It runs on the **gsap ticker**, so rendering stays in sync with GSAP animations and Lenis scroll.

## Contents

1. [Getting started](#getting-started): install, quick start, exports, multiple instances
2. [The app](#the-app): options, instance API, frame order, loop, custom render, camera, scroll, gestures
3. [Data and lifecycle](#data-and-lifecycle): store, events, Shepherd, resources
4. [Building blocks](#building-blocks): shards, helpers, shaders
5. [Development](#development)

---

## Getting started

### Install

```bash
npm i github:dghez/KEEMERA#v0.1.0 three gsap
```

`three` (r180 or later) and `gsap` are peer dependencies. `@monogrid/gainmap-js` is only needed if you enable gainmap support.

### Quick start

```js
import Keemera, { EVENTS } from 'keemera'

const app = new Keemera({
    wrapper: document.querySelector('.gl'),
    canvas: document.querySelector('.gl canvas')
})

await app.ready

const mesh = new MyMesh({ store: app.store })
app.scene.add(mesh)

app.events.on(EVENTS.APP_TICK, state => mesh.update(state))
```

### Exports

The package has four entry points:

```js
// keemera
import Keemera, {
    EVENTS,
    PRIORITY,
    GL_STATES,
    Emitter,
    Shepherd
} from 'keemera'

// keemera/shards (see Shards below)
import { Tracker, PlaneBackground /* ... */ } from 'keemera/shards'

// keemera/helpers
import { getPlaneSize, uvCover } from 'keemera/helpers'

// keemera/shaders
import { noise3d, curlNoise, map /* ... */ } from 'keemera/shaders'
```

| Export (`keemera`)    | Description                                                                     |
| --------------------- | ------------------------------------------------------------------------------- |
| `default` / `Keemera` | The app class, as default or named export (`import { Keemera } from 'keemera'`) |
| `EVENTS`              | Default event names (see [Events and priorities](#events-and-priorities))       |
| `PRIORITY`            | Default listener priorities                                                     |
| `GL_STATES`           | App states: `IDLE`, `LOADING`, `LOADED`, `READY`, `DESTROYED`                   |
| `Emitter`             | The event emitter class, usable on its own                                      |
| `Shepherd`            | Lifecycle manager (see [Shepherd](#shepherd-lifecycle))                         |

`EVENTS`, `PRIORITY` and `GL_STATES` are also available as statics: `Keemera.EVENTS`, `Keemera.PRIORITY`, `Keemera.STATES`.

### Multiple instances

Nothing is global, so instances never share state:

```js
const a = new Keemera({ wrapper: elA, canvas: canvasA })
const b = new Keemera({
    wrapper: elB,
    canvas: canvasB,
    autoRun: false,
    gestures: false
})
```

---

## The app

How a `Keemera` instance is configured, what it exposes, and how it renders, resizes and reacts to scroll and input.

### Options

```js
new Keemera({
    wrapper,
    canvas, // required: size is read from wrapper, rendering goes to canvas
    debug: false, // store.isDebug, enables state-change logs (resource load logs are always on)
    showHelpers: false, // store.showHelpers, a flag for your own helpers
    autoRun: true, // add tick to gsap.ticker; false -> call app.tick() yourself
    autoResize: true, // ResizeObserver on wrapper; false -> call app.resize() yourself
    autoRender: true, // renderer.render(scene, camera) each tick; false -> nothing is rendered unless you set a render function
    gestures: true, // internal @use-gesture; false -> emit the mouse events yourself
    gestureTarget: window,
    dpr: [1, 1.6], // pixel ratio clamp [min, max]
    breakpoint: 650, // viewport.isMobile below this width
    renderer: {}, // WebGLRenderer params, e.g. { antialias: true, stencil: true }
    clearColor: 0x000000,
    clearAlpha: 1,
    camera: {
        fov: 60,
        near: 0.1,
        far: 300,
        position: [0, 0, 100],
        lookAt: [0, 0, 0],
        useDomSize: false // true: 1 unit = 1 css pixel; position, near and far follow the wrapper on resize
    },
    resources: {
        support: {
            ktx: false,
            draco: false,
            gainmap: false,
            envmap: false,
            curves: false
        },
        decoders: { draco: '/draco/', ktx: '/basis/' } // defaults to the jsdelivr CDN
    },
    preload: [] // assets loaded before 'ready'
})
```

### Instance API

| Member                        | Description                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| `ready`                       | Promise, resolves with the instance once preload is done and state is `ready`               |
| `renderer`, `camera`, `scene` | Three.js `WebGLRenderer`, `PerspectiveCamera`, `Scene`                                      |
| `store`                       | Per-instance shared state                                                                   |
| `events`                      | Per-instance emitter                                                                        |
| `resources`                   | Per-instance asset loader                                                                   |
| `viewport`, `mouse`, `time`   | Shortcuts to the store entries                                                              |
| `state`                       | `idle`, `loading`, `loaded`, `ready` or `destroyed`                                         |
| `tick()`                      | Render one frame (bound, safe to pass as a callback)                                        |
| `play()` / `pause()`          | Add or remove `tick` from `gsap.ticker`                                                     |
| `resize()`                    | Re-read the wrapper size                                                                    |
| `setScroll(y)`                | Feed the scroll position (e.g. from Lenis)                                                  |
| `setRenderFunction(fn)`       | Replace the default render with `fn(state, store)`; `null` restores it (see [Custom render](#custom-render)) |
| `autoRender`                  | Get or set the `autoRender` option at runtime                                               |
| `destroy()`                   | Stops the loop, emits `APP_DESTROY`, disposes resources and renderer, removes all listeners |

### Frame order

Each `tick()`:

1. `time`, `mouse` and `camera` update
2. `EVENTS.APP_TICK` is emitted with the frame state
3. `EVENTS.WEBGL_BEFORE_RENDER`
4. Render: your render function if set, otherwise `renderer.render(scene, camera)` (when `autoRender` is on)
5. `EVENTS.WEBGL_AFTER_RENDER`

The frame state passed to these events and to `APP_RESIZE`:

```js
{
    ;(delta, elapsed, frame, width, height, dpr, scroll, mouse)
}
```

### Loop

By default the app adds `tick` to `gsap.ticker` once it's ready. Use `pause()` and `play()` to stop and resume. Paused time is discarded, so animations don't jump.

To drive it yourself:

```js
const app = new Keemera({ wrapper, canvas, autoRun: false })
await app.ready

gsap.ticker.add(app.tick) // or your own requestAnimationFrame
```

### Custom render

To take over the render step (postprocessing, render targets, multiple passes), pass a function to `setRenderFunction`. It runs every tick, between `WEBGL_BEFORE_RENDER` and `WEBGL_AFTER_RENDER`, and receives the frame state and the store:

```js
app.setRenderFunction((state, { gl, scene, camera }) => {
    gl.setRenderTarget(target)
    gl.render(scene, camera)
    gl.setRenderTarget(null)
    gl.render(postQuad, postCamera)
})

app.setRenderFunction(null) // back to the default render
```

While a render function is set, the default render is always skipped, so frames are never rendered twice. Use `APP_RESIZE` to resize your render targets and `APP_DESTROY` to dispose them. `examples/basic/Post.js` is a working example.

With `autoRender: false` and no render function, nothing is rendered. This is useful when you render by hand, for example from `WEBGL_AFTER_RENDER`.

### Camera

On every resize the camera updates `aspect` and the projection matrix so the view matches the wrapper.

Set `camera: { useDomSize: true }` to also fit the wrapper so 1 world unit is 1 CSS pixel:

That is what `Tracker` needs. You can still move or orbit the camera afterwards; the next resize will put it back on the pixel-fit position.

### Scroll (Lenis)

Scroll lives in `viewport.scroll` (`{ y, delta }`) and is set by the host. Drive Lenis and Keemera from the same ticker, Lenis first:

```js
import Lenis from 'lenis'

const lenis = new Lenis({
    lerp: 0.15,
    wheelMultiplier: 1.25,
    autoResize: false
})

const app = new Keemera({ wrapper, canvas, autoRun: false })
lenis.on('scroll', ({ scroll }) => app.setScroll(scroll))
app.events.on(EVENTS.APP_RESIZE, () => lenis.resize(), PRIORITY.first)

await app.ready

gsap.ticker.add(time => {
    lenis.raf(time * 1000)
    app.tick()
})
gsap.ticker.lagSmoothing(0)
```

`setScroll` emits `EVENTS.APP_SCROLL` with `viewport.scroll`.

### Gestures

With `gestures: true` the app binds `@use-gesture/vanilla` to `gestureTarget` and emits `APP_MOUSE_MOVE`, `APP_MOUSE_DRAG` and `APP_MOUSE_HOLD`. `app.mouse` listens to those events and keeps `static`, `smooth` and `smoother` positions in normalized device coordinates, plus `viewport` and `viewportSmooth` in pixels.

To use your own input logic, disable the internal binding and emit the same events with the same payload. `xy` is in pixels, and `mouse` normalizes it against the viewport size, so for a canvas that doesn't fill the window, pass coordinates relative to the wrapper:

```js
const app = new Keemera({ wrapper, canvas, gestures: false })

el.addEventListener('pointermove', e => {
    app.events.emit(EVENTS.APP_MOUSE_MOVE, { xy: [e.clientX, e.clientY] })
})
```

---

## Data and lifecycle

How the parts of your scene share data, talk to each other, load assets and clean up.

### Store

`app.store` is a plain object per instance:

```js
store.gl // the WebGLRenderer
store.scene // the main Scene
store.camera // the PerspectiveCamera
store.viewport // width, height, dpr, isMobile, isTouch, scroll { y, delta }
store.mouse // static, smooth, smoother (NDC), viewport, viewportSmooth (px), isDragging, isHolding
store.time // delta, elapsed, frames, scale
store.gestures // internal gesture binding, undefined with gestures: false
store.resources // asset loader and cache
store.events // the instance emitter
store.uniforms // shared uniforms: time, timeScale, resolution, mouse.smooth, mouse.smoother
store.dom // { wrapper, canvas }
store.isDebug // the debug option
store.showHelpers // the showHelpers option
store.state // idle, loading, loaded, ready or destroyed
```

You can add your own keys. Pass the store to components that need app data, rather than importing anything global.

```js
const material = new ShaderMaterial({
    uniforms: { uTime: app.store.uniforms.time }
})
```

### Events and priorities

Every instance has its own emitter. Listeners run from the lowest priority number to the highest.

```js
app.events.on(EVENTS.APP_TICK, fn) // priority 0
app.events.on(EVENTS.APP_TICK, fn, PRIORITY.first) // -10, runs before
app.events.on(EVENTS.APP_TICK, fn, 'low') // by name
const off = app.events.on(EVENTS.APP_RESIZE, fn)
off() // or app.events.off(event, fn)
app.events.once(EVENTS.WEBGL_APP_READY, fn)

app.events.getEvents() // all registered names
app.events.addEvents({ MY_EVENT: 'MY:EVENT' })
app.events.getPriorities()
app.events.addPriorities({ late: 40 })
```

Default events:

| Key                                                          | Payload                                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `APP_TICK`                                                   | frame state                                                               |
| `APP_RESIZE`                                                 | frame state                                                               |
| `APP_SCROLL`                                                 | `{ y, delta }`                                                            |
| `APP_MOUSE_MOVE`                                             | `{ xy: [x, y] }`                                                          |
| `APP_MOUSE_DRAG`                                             | `{ xy: [x, y], active, dragging }`                                        |
| `APP_MOUSE_HOLD`                                             | `active` (boolean)                                                        |
| `WEBGL_BEFORE_RENDER` / `WEBGL_AFTER_RENDER`                 | frame state                                                               |
| `WEBGL_APP_LOADING` / `WEBGL_APP_LOADED` / `WEBGL_APP_READY` | none                                                                      |
| `WEBGL_STATE_CHANGE`                                         | `{ state, prev }`                                                         |
| `RESOURCES_PROGRESS`                                         | `{ loaded, total, key, progress }`                                        |
| `APP_DESTROY`                                                | none, emitted at the start of `destroy()` while everything is still alive |

Default priorities: `first: -10`, `instant: 0`, `high: 10`, `mid: 20`, `low: 30`.

`Emitter` is exported, so you can create a standalone one with the same API:

```js
import { Emitter, EVENTS, PRIORITY } from 'keemera'

const bus = new Emitter({ labels: EVENTS, priorities: PRIORITY })
```

Subscribing to an event name that isn't registered always prints a warning, in development and production. Register custom names with `addEvents()` first.

### Shepherd (lifecycle)

`Shepherd` is a small, self-contained lifecycle manager. The app doesn't own one: create as many as you need and wire them to the events yourself.

```js
import { Shepherd } from 'keemera'

const shepherd = new Shepherd()
shepherd.add(obj) // obj.update(state), obj.resize(state), obj.destroy() if defined
shepherd.remove(obj)

app.events.on(EVENTS.APP_TICK, state => shepherd.update(state))
app.events.on(EVENTS.APP_RESIZE, state => shepherd.resize(state))
app.events.on(EVENTS.APP_DESTROY, () => shepherd.destroy())
```

All hooks are optional. Shepherds nest, so a scene group can manage its own children:

```js
import { Group } from 'three'
import { Shepherd } from 'keemera'

class MyScene extends Group {
    #shepherd = new Shepherd()

    constructor({ store }) {
        super()
        const effect = new MyEffect({ store })
        this.#shepherd.add(effect)
        this.add(effect)
    }

    update(state) {
        this.#shepherd.update(state)
    }
    resize(state) {
        this.#shepherd.resize(state)
    }
    destroy() {
        this.#shepherd.destroy()
    }
}

const scene = new MyScene({ store: app.store })
app.scene.add(scene)
shepherd.add(scene)
```

### Resources

Nothing is loaded by default. Each instance has its own cache.

```js
await app.resources.load(
    [
        {
            key: 'paper',
            type: 'texture',
            path: '/gl/paper.jpg',
            colorSpace: 'SRGBColorSpace'
        },
        { key: 'robot', type: 'gltf', path: '/gl/robot.glb' }
    ],
    { onProgress: ({ progress }) => {} }
)

app.resources.get('paper')
app.resources.has('robot')
app.resources.getAll() // Map
```

Built-in types: `texture`, `gltf`, `fbo` (texture plus pixel data in `texture.userData.fbo`).

Each asset is an object:

| Field | Description |
|---|---|
| `key` | Name used with `get(key)` / `has(key)`; an already loaded key is reused from the cache |
| `type` | `texture`, `gltf`, `fbo`, `envmap` or `gainmap` |
| `path` | URL of the file |
| `colorSpace` | `'SRGBColorSpace'` for color textures (textures and envmaps) |
| `flipY` | Override the texture's `flipY` |
| `compress` | `true` or `{ responsive: true }`: load a KTX2 version instead (textures only, needs `ktx` support) |
| `preventInit` | `true` skips uploading the texture to the GPU right after loading |

The whole object is kept on the result as `asset.config`.

With `compress`, keep the original `.png` / `.jpg` path and put the `.ktx2` files next to it:

```js
{ key: 'paper', type: 'texture', path: '/gl/paper.jpg', compress: true }
// loads /gl/paper.ktx2

{ key: 'paper', type: 'texture', path: '/gl/paper.jpg', compress: { responsive: true } }
// loads /gl/paper-desktop.ktx2 or /gl/paper-mobile.ktx2 automatically, so be aware you need two files
```

Responsive loads the desktop file by default. Call `app.resources.setResponsiveType('mobile')` before loading to get the mobile one, for example `if (app.viewport.isMobile)`.

Optional loaders, enabled on creation (`resources.support`) or later:

```js
await app.resources.addSupport({
    ktx: true,
    draco: true,
    envmap: true,
    gainmap: true,
    curves: true
})
```

| Support   | Enables                                                                                                          |
| --------- | ---------------------------------------------------------------------------------------------------------------- |
| `ktx`     | `texture` assets with `compress: true` or `compress: { responsive: true }` (KTX2, `-desktop` / `-mobile` suffix) |
| `draco`   | Draco-compressed GLTF                                                                                            |
| `envmap`  | `type: 'envmap'` (`.hdr` via `HDRLoader`, equirectangular mapping)                                               |
| `gainmap` | `type: 'gainmap'` (needs `@monogrid/gainmap-js`)                                                                 |
| `curves`  | the `UTSUBO_curve_extension` GLTF extension                                                                      |

Loading an asset that needs a disabled loader throws a clear error. A failed request rejects the `load()` promise. Use `preload` on creation for assets that must be ready before `ready`. `destroy()` disposes everything that was loaded.

---

## Building blocks

Optional pieces you import as needed: ready-made objects, math helpers and GLSL snippets.

### Shards

Reusable building blocks, imported from `keemera/shards`:

```js
import {Tracker, .....} from 'keemera/shards'
```

Shards that need app data take a **required** `store` and throw if it's missing. All of them expose `update()`, `resize()` and/or `destroy()` where it makes sense, so you can hand them to a `Shepherd`.

#### Tracker

A `Group` that follows a DOM element: its position matches the element on screen, scroll included. Positions are in CSS pixels from the canvas center, so create the app with `camera: { useDomSize: true }`.

```js
const box = new Tracker({
    store: app.store, // required
    tracker: '.hero', // selector or element
    preventUpdateScale: false, // default true; false scales the group to the element size
    preventUpdatePosition: false, // true: only compute trackPosition, don't move the group
    sticky: false // or '.container', or { container, start, end }
})
app.scene.add(box)
shepherd.add(box)
```

Useful properties: `el`, `trackPosition`, `trackSize` (`{ w, h }`), `rect`, `isActive` (element is in view, from an `IntersectionObserver`).

`sticky` keeps the group pinned while scrolling through a container, with GSAP-style positions: `start: 'top top'`, `end: 'bottom bottom'` (offsets like `'top top+=100'` or `'top center-=10%'`). While pinned, `isActive` follows the container. `stickyProgress` goes from `0` (before `start`) to `1` (at `end`). The tracked element must not be CSS `position: sticky` itself.

`start` and `end` each take a position string **or** a function that returns one. A function runs again on every resize, so the position can follow the current layout, e.g. a box that scales with the page width:

```js
const box = document.querySelector('.box')

new Tracker({
    store: app.store,
    tracker: box,
    sticky: {
        container: '.section',
        start: 'top top', // string
        start: () => `top center-=${box.getBoundingClientRect().height}`, // or function:
      
        end: 'bottom bottom', // string
        end: () => `bottom center+=${box.getBoundingClientRect().height}`, // or function
    },
})
```

Pick one form per key: in a real object the second `start`/`end` replaces the first. Read sizes inside the function, not outside it, so they're fresh on each resize. Prefer `getBoundingClientRect()` over `offsetHeight`, which rounds to whole pixels.

#### PlaneBackground

A `Tracker` with a `1×1` plane inside, so with `preventUpdateScale: false` it covers the element. Exposes `mesh` and `material` (a `MeshBasicMaterial`, replace it with your own).

```js
const bg = new PlaneBackground({
    store: app.store,
    tracker: '.card',
    preventUpdateScale: false
})
bg.material.color.set('red')
```

#### StencilMesh

A plane that writes into the stencil buffer without drawing color. Use `applyStencilToMaterial(material)` on other materials so they only render where the stencil was written. Options: `stencilRef` (default `1`). Needs `new Keemera({ renderer: { stencil: true } })`.

```js
const mask = new StencilMesh({ stencilRef: 2 })
mask.applyStencilToMaterial(myMesh.material)
```

#### SectionMask

A `StencilMesh` that follows and resizes to a DOM element, so content is clipped to that section. Needs `store`, `tracker` and the stencil buffer.

```js
const mask = new SectionMask({
    store: app.store,
    tracker: '.section',
    stencilRef: 1
})
mask.applyStencilToMaterial(content.material)
```

#### FitModel

A `Group` that wraps a model and scales it uniformly to fit a size, keeping proportions. Pass a `tracker` to fit its element on `resize()`, or call `fit(w, h)` yourself. `scaleFactor` (default `1`) scales the result.

```js
const robot = new FitModel({
    model: gltf.scene,
    tracker: box,
    scaleFactor: 0.8
})
box.add(robot)
```

#### FullscreenQuad

A `Mesh` with a single triangle covering the screen, for post-processing or full-screen shaders. Pass your material. `fullscreenQuadVertexShader` and `fullscreenQuadFragmentShader` are a ready-made starting pair (the fragment shows the UVs).

```js
const quad = new FullscreenQuad(
    new ShaderMaterial({
        vertexShader: fullscreenQuadVertexShader,
        fragmentShader: myFragment
    })
)
```

#### BufferViewer (WIP)

A debug overlay that draws textures (render targets, data textures) on screen. Options: `store` (required), `width` (default `300`), `x` and `y` (pixels from the bottom-left corner). It draws on top of the main render, so call it after rendering:

```js
const viewer = new BufferViewer({ store: app.store })
viewer.createView(texture) // optional: { width, x, y, sourceWidth, sourceHeight }
app.events.on(EVENTS.WEBGL_AFTER_RENDER, () => viewer.render())
app.events.on(EVENTS.APP_RESIZE, () => viewer.resize())
```

### Helpers

```js
import { getPlaneSize, uvCover } from 'keemera/helpers'
```

- `getPlaneSize(camera, distance)`: width and height visible by a perspective camera at a given distance.
- `uvCover(texture, [width, height])`: sets the texture's `repeat` and `offset` to cover a plane of that size, like CSS `object-fit: cover`.

### Shaders

GLSL snippets as JS strings, so no bundler plugin is needed. Each one is wrapped in an include guard, so including it twice is safe. `curlNoise` already contains `noise3d`.

```js
import { map, .... } from 'keemera/shaders'

const vertexShader = /* glsl */ `
    ${map}
`
```

- `noise3d`: 3D simplex noise, `float snoise(vec3 p)`.
- `curlNoise`: 3D curl noise for flow-like motion, `vec3 curlNoise(vec3 p)` (includes `noise3d`).
- `map`: remaps a value from one range to another, `float map(value, min1, max1, min2, max2)`.
- `coverUv`: CSS "cover" in the shader, `vec2 coverUv(uv, size, resolution)`.
- `aastep`: antialiased `step` using screen derivatives, plus `aaAlpha(alpha, uv)` to soften UV edges.
- `remapProgress`: delays a 0–1 progress and stretches the rest back to 0–1, `float remapProgress(progress, delay)`.
- `scaleFromPoint`: scales UVs around a point, `vec2 scaleFromPoint(uv, scale, point)`.
- `saturation`: adjusts color saturation (0 = grayscale, 1 = unchanged), `vec3 saturation(rgb, amount)`.
- `brightnessContrast`: adjusts brightness and contrast, `vec3 brightnessContrast(rgb, brightness, contrast)`.
- `RGBtoHSL`: color space conversion, `RGBToHSL(rgb)` and `HSLToRGB(hsl)`.
- `blendNormal`: normal blend mode, `vec3 blendNormal(base, blend[, opacity])`.
- `blendOverlay`: Photoshop-style overlay, `vec3 blendOverlay(base, blend[, opacity])`.
- `blendScreen`: Photoshop-style screen, `vec3 blendScreen(base, blend[, opacity])`.

---

## Development

```bash
nvm use          # Node 20.19+
npm install
npm run dev      # examples/basic playground (Lenis, Tracker, one instance)
npm run build    # dist/ (ESM, minified, one file per module, no sourcemaps)
npm run lint
```

Add `?debug` to the example URL to turn on debug logs.

## License

MIT
