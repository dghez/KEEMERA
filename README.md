# KEEMERA

A self-contained **Three.js starter library** for WebGL experiences. Each `new Keemera()` is an isolated app with its own renderer, camera, store, event system, viewport (size and scroll), resources and lifecycle manager, so you can run several on the same page.

It runs on the **gsap ticker**, so rendering stays in sync with GSAP animations and Lenis scroll.

```bash
npm install keemera three gsap
```

`three` (r180 or later) and `gsap` are peer dependencies. `@monogrid/gainmap-js` is only needed if you enable gainmap support.

## Quick start

```js
import Keemera, { EVENTS } from 'keemera'

const app = new Keemera({
    wrapper: document.querySelector('.gl'),
    canvas: document.querySelector('.gl canvas'),
})

await app.ready

const mesh = new MyMesh({ store: app.store })
app.scene.add(mesh)

app.events.on(EVENTS.APP_TICK, state => mesh.update(state))
```

## Options

```js
new Keemera({
    wrapper, canvas,          // required: size is read from wrapper, rendering goes to canvas
    debug: false,             // store.isDebug, enables console logs
    showHelpers: false,       // store.showHelpers, a flag for your own helpers
    autoRun: true,            // add tick to gsap.ticker; false -> call app.tick() yourself
    autoResize: true,         // ResizeObserver on wrapper; false -> call app.resize() yourself
    gestures: true,           // internal @use-gesture; false -> emit the mouse events yourself
    gestureTarget: window,
    dpr: [1, 1.6],            // pixel ratio clamp [min, max]
    breakpoint: 650,          // viewport.isMobile below this width
    renderer: {},             // WebGLRenderer params, e.g. { antialias: true, stencil: true }
    clearColor: 0x000000,
    clearAlpha: 1,
    camera: {
        fov: 60, near: 0.1, far: 300, position: [0, 0, 100], lookAt: [0, 0, 0],
        useDomSize: false,    // true: 1 unit = 1 css pixel; position, near and far follow the wrapper on resize
    },
    resources: {
        support: { ktx: false, draco: false, gainmap: false, envmap: false, curves: false },
        decoders: { draco: '/draco/', ktx: '/basis/' }, // defaults to the jsdelivr CDN
    },
    preload: [],              // assets loaded before 'ready'
})
```

## Instance API

| Member | Description |
|---|---|
| `ready` | Promise, resolves with the instance once preload is done and state is `ready` |
| `renderer`, `camera`, `scene` | Three.js `WebGLRenderer`, `PerspectiveCamera`, `Scene` |
| `store` | Per-instance shared state |
| `events` | Per-instance emitter |
| `resources` | Per-instance asset loader |
| `viewport`, `mouse`, `time` | Shortcuts to the store entries |
| `state` | `idle`, `loading`, `loaded`, `ready` or `destroyed` |
| `tick()` | Render one frame (bound, safe to pass as a callback) |
| `play()` / `pause()` | Add or remove `tick` from `gsap.ticker` |
| `resize()` | Re-read the wrapper size |
| `setScroll(y)` | Feed the scroll position (e.g. from Lenis) |
| `destroy()` | Stops the loop, emits `APP_DESTROY`, disposes resources and renderer, removes all listeners |

Statics: `Keemera.EVENTS`, `Keemera.PRIORITY`, `Keemera.STATES`.

## Frame order

Each `tick()`:

1. `time`, `mouse` and `camera` update
2. `EVENTS.APP_TICK` is emitted with the frame state
3. `EVENTS.WEBGL_BEFORE_RENDER`
4. `renderer.render(scene, camera)`
5. `EVENTS.WEBGL_AFTER_RENDER`

The frame state passed to these events and to `APP_RESIZE`:

```js
{ delta, elapsed, frame, width, height, dpr, scroll, mouse }
```

## Loop

By default the app adds `tick` to `gsap.ticker` once it's ready. Use `pause()` and `play()` to stop and resume. Paused time is discarded, so animations don't jump.

To drive it yourself:

```js
const app = new Keemera({ wrapper, canvas, autoRun: false })
await app.ready

gsap.ticker.add(app.tick)               // or your own requestAnimationFrame
```

## Camera

On every resize the camera updates `aspect` and the projection matrix so the view matches the wrapper.

Set `camera: { useDomSize: true }` to also fit the wrapper so 1 world unit is 1 CSS pixel:

```js
const z = height / Math.tan(this.fov * Math.PI / 360) * 0.5
this.position.set(0, 0, z)
this.far = z * 20
this.near = this.far / 1000
this.lookAt(0, 0, 0)
```

That is what `Tracker` needs. You can still move or orbit the camera afterwards; the next resize will put it back on the pixel-fit position.

## Scroll (Lenis)

Scroll lives in `viewport.scroll` (`{ y, delta }`) and is set by the host:

```js
import Lenis from 'lenis'

const lenis = new Lenis({
    lerp: 0.15,
    wheelMultiplier: 1.25,
    autoResize: false,
})
gsap.ticker.add(time => lenis.raf(time * 1000))
gsap.ticker.lagSmoothing(0)

lenis.on('scroll', ({ scroll }) => app.setScroll(scroll))

// with autoResize: false, resize Lenis together with the app
app.events.on(EVENTS.APP_RESIZE, () => lenis.resize(), PRIORITY.first)
```

`setScroll` emits `EVENTS.APP_SCROLL` with `viewport.scroll`.

## Events and priorities

Every instance has its own emitter. Listeners run from the lowest priority number to the highest.

```js
app.events.on(EVENTS.APP_TICK, fn)                       // priority 0
app.events.on(EVENTS.APP_TICK, fn, PRIORITY.first)       // -10, runs before
app.events.on(EVENTS.APP_TICK, fn, 'low')                // by name
const off = app.events.on(EVENTS.APP_RESIZE, fn)
off()                                                    // or app.events.off(event, fn)
app.events.once(EVENTS.WEBGL_APP_READY, fn)

app.events.getEvents()                                   // all registered names
app.events.addEvents({ MY_EVENT: 'MY:EVENT' })
app.events.getPriorities()
app.events.addPriorities({ late: 40 })
```

Default events:

| Key | Payload |
|---|---|
| `APP_TICK` | frame state |
| `APP_RESIZE` | frame state |
| `APP_SCROLL` | `{ y, delta }` |
| `APP_MOUSE_MOVE` | `{ xy: [x, y] }` |
| `APP_MOUSE_DRAG` | `{ xy: [x, y], active, dragging }` |
| `APP_MOUSE_HOLD` | `active` (boolean) |
| `WEBGL_BEFORE_RENDER` / `WEBGL_AFTER_RENDER` | frame state |
| `WEBGL_APP_LOADING` / `WEBGL_APP_LOADED` / `WEBGL_APP_READY` | none |
| `WEBGL_STATE_CHANGE` | `{ state, prev }` |
| `RESOURCES_PROGRESS` | `{ loaded, total, key, progress }` |
| `APP_DESTROY` | none, emitted at the start of `destroy()` while everything is still alive |

Default priorities: `first: -10`, `instant: 0`, `high: 10`, `mid: 20`, `low: 30`.

Subscribing to an event name that isn't registered always prints a warning, in development and production. Register custom names with `addEvents()` first.

## Gestures

With `gestures: true` the app binds `@use-gesture/vanilla` to `gestureTarget` and emits `APP_MOUSE_MOVE`, `APP_MOUSE_DRAG` and `APP_MOUSE_HOLD`. `app.mouse` listens to those events and keeps `static`, `smooth` and `smoother` positions in normalized device coordinates, plus `viewport` and `viewportSmooth` in pixels.

To use your own input logic, disable the internal binding and emit the same events with the same payload. `xy` is in pixels, and `mouse` normalizes it against the viewport size, so for a canvas that doesn't fill the window, pass coordinates relative to the wrapper:

```js
const app = new Keemera({ wrapper, canvas, gestures: false })

el.addEventListener('pointermove', (e) => {
    app.events.emit(EVENTS.APP_MOUSE_MOVE, { xy: [e.clientX, e.clientY] })
})
```

## Shepherd (lifecycle)

`Shepherd` is a small, self-contained lifecycle manager. The app doesn't own one: create as many as you need and wire them to the events yourself.

```js
import { Shepherd } from 'keemera'

const shepherd = new Shepherd()
shepherd.add(obj)           // obj.update(state), obj.resize(state), obj.destroy() if defined
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

    update(state) { this.#shepherd.update(state) }
    resize(state) { this.#shepherd.resize(state) }
    destroy() { this.#shepherd.destroy() }
}

const scene = new MyScene({ store: app.store })
app.scene.add(scene)
shepherd.add(scene)
```

## Store

`app.store` is a plain object per instance:

```js
store.renderer, store.scene, store.camera
store.viewport    // width, height, dpr, isMobile, isTouch, scroll { y, delta }
store.mouse, store.time, store.gestures
store.resources, store.events
store.uniforms    // shared uniforms: time, timeScale, resolution, mouse.smooth, mouse.smoother
store.dom         // { wrapper, canvas }
store.isDebug, store.showHelpers, store.state
```

You can add your own keys. Pass the store to components that need app data, rather than importing anything global.

```js
const material = new ShaderMaterial({
    uniforms: { uTime: app.store.uniforms.time },
})
```

## Resources

Nothing is loaded by default. Each instance has its own cache.

```js
await app.resources.load([
    { key: 'paper', type: 'texture', path: '/gl/paper.jpg', colorSpace: 'SRGBColorSpace' },
    { key: 'robot', type: 'gltf', path: '/gl/robot.glb' },
], { onProgress: ({ progress }) => {} })

app.resources.get('paper')
app.resources.has('robot')
app.resources.getAll()      // Map
```

Built-in types: `texture`, `gltf`, `fbo` (texture plus pixel data in `texture.userData.fbo`).

Optional loaders, enabled on creation (`resources.support`) or later:

```js
await app.resources.addSupport({ ktx: true, draco: true, envmap: true, gainmap: true, curves: true })
```

| Support | Enables |
|---|---|
| `ktx` | `texture` assets with `compress: true` or `compress: { responsive: true }` (KTX2, `-desktop` / `-mobile` suffix) |
| `draco` | Draco-compressed GLTF |
| `envmap` | `type: 'envmap'` (`.hdr` via `HDRLoader`, equirectangular mapping) |
| `gainmap` | `type: 'gainmap'` (needs `@monogrid/gainmap-js`) |
| `curves` | the `UTSUBO_curve_extension` GLTF extension |

Loading an asset that needs a disabled loader throws a clear error. A failed request rejects the `load()` promise. Use `preload` on creation for assets that must be ready before `ready`. `destroy()` disposes everything that was loaded.

## Shards

Reusable building blocks:

```js
import { Tracker, PlaneBackground, SectionMask, StencilMesh, FitModel, FullscreenQuad, BufferViewer } from 'keemera/shards'
```

| Shard | Purpose | Needs `store` |
|---|---|---|
| `Tracker` | Group that follows a DOM element (position, optional scale, sticky) | yes |
| `PlaneBackground` | `Tracker` with a plane mesh | yes |
| `SectionMask` | Stencil mask following a DOM element | yes |
| `BufferViewer` | Debug texture overlay | yes |
| `StencilMesh` | Stencil write mesh | no |
| `FitModel` | Scale a model to a size or a tracker | no |
| `FullscreenQuad` | Full-screen triangle | no |

Shards that need app data take a **required** `store` and throw if it's missing:

```js
const box = new Tracker({ store: app.store, tracker: '.hero', preventUpdateScale: false })
app.scene.add(box)
shepherd.add(box)
```

Notes:

- `Tracker` positions are in CSS pixels from the canvas center, so create the app with `camera: { useDomSize: true }` (1 unit = 1 pixel).
- `StencilMesh` and `SectionMask` need a stencil buffer: `new Keemera({ renderer: { stencil: true } })`.
- `BufferViewer` draws on top of the main render, so call it after rendering:

```js
const viewer = new BufferViewer({ store: app.store })
viewer.createView(texture)
app.events.on(EVENTS.WEBGL_AFTER_RENDER, () => viewer.render())
app.events.on(EVENTS.APP_RESIZE, () => viewer.resize())
```

## Helpers

```js
import { getPlaneSize, uvCover } from 'keemera/helpers'

getPlaneSize(camera, distance)     // visible { width, height } at a distance
uvCover(texture, [width, height])  // CSS "cover" on a texture
```

## Shaders

GLSL snippets as JS strings, so no bundler plugin is needed. Each one is wrapped in an include guard, so including it twice is safe. `curlNoise` already contains `noise3d`.

```js
import { noise3d, curlNoise, map } from 'keemera/shaders'

const vertexShader = /* glsl */ `
    ${noise3d}
    ${map}
    // ...
`
```

Available: `noise3d`, `curlNoise`, `map`, `coverUv`, `aastep`, `remapProgress`, `scaleFromPoint`, `saturation`, `brightnessContrast`, `RGBtoHSL`, `blendNormal`, `blendOverlay`, `blendScreen`.

## Multiple instances

Nothing is global, so instances never share state:

```js
const a = new Keemera({ wrapper: elA, canvas: canvasA })
const b = new Keemera({ wrapper: elB, canvas: canvasB, autoRun: false, gestures: false })
```

## Development

```bash
nvm use          # Node 20.19+
npm install
npm run dev      # examples/basic playground (two instances, Lenis, Tracker)
npm run build    # dist/ (ESM, preserved modules)
npm run lint
```

Add `?debug` to the example URL to turn on debug logs.

## License

MIT
