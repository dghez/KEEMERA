---
name: keemera
description: Build WebGL scenes with the keemera Three.js starter library. Use when code imports '@dghez/keemera', '@dghez/keemera/shards', '@dghez/keemera/helpers' or '@dghez/keemera/shaders', or when setting up a Keemera app, DOM-tracked meshes (Tracker, PlaneBackground, SectionMask), Lenis scroll sync, custom render/post-processing, resources loading or Shepherd lifecycle.
---

# Using keemera

keemera is a multi-instance Three.js starter: each `new Keemera()` is an isolated app with its own renderer, camera, scene, store, events, resources, viewport, mouse and time, driven by `gsap.ticker`. The full reference is `node_modules/keemera/README.md`; read it for any option or API not covered here.

## Setup

```bash
npm i -E keemera three gsap   # pin exact: API may break before 1.0
```

```js
import Keemera, { EVENTS, PRIORITY, Shepherd } from '@dghez/keemera'

const app = new Keemera({
    wrapper: document.querySelector('.gl'),       // size source (required)
    canvas: document.querySelector('.gl canvas'), // render target (required)
    camera: { useDomSize: true },                 // 1 unit = 1 CSS px, needed for Tracker-based shards
    renderer: { antialias: true, stencil: true }, // stencil only for StencilMesh / SectionMask
    preload: [{ key: 'paper', type: 'texture', path: '/gl/paper.jpg', colorSpace: 'SRGBColorSpace' }],
})

await app.ready // preload done, state is 'ready'
```

Other useful options: `debug`, `autoRun` (false = call `app.tick()` yourself), `autoResize`, `autoRender`, `gestures`, `dpr: [min, max]`, `breakpoint`, `clearColor`, `clearAlpha`, `resources.support` (`ktx`, `draco`, `envmap`, `gainmap`, `curves`).

## Core rules

- **Pass `app.store`, don't import globals.** Shards and your own components receive `{ store }`; read `store.viewport`, `store.mouse`, `store.time`, `store.uniforms`, `store.camera`, `store.events` from it. You can add your own keys to the store.
- **Frame order** per `tick()`: time/mouse/camera update → `APP_TICK` → `WEBGL_BEFORE_RENDER` → render → `WEBGL_AFTER_RENDER`. Frame state: `{ delta, elapsed, frame, width, height, dpr, scroll, mouse }`.
- **Lifecycle with `Shepherd`**: objects with optional `update(state)`, `resize(state)`, `destroy()` hooks. The app doesn't own one; wire it:
  ```js
  const shepherd = new Shepherd()
  app.events.on(EVENTS.APP_TICK, state => shepherd.update(state))
  app.events.on(EVENTS.APP_RESIZE, state => shepherd.resize(state))
  app.events.on(EVENTS.APP_DESTROY, () => shepherd.destroy())
  ```
  Shepherds nest: a `Group` subclass can hold its own `#shepherd` and forward the three hooks.
- **Teardown**: call `app.destroy()` (e.g. on route change / component unmount). It emits `APP_DESTROY` first, then disposes resources and renderer and removes listeners. Dispose your own render targets in an `APP_DESTROY` listener.
- **Shared uniforms**: reuse `store.uniforms.time`, `timeScale`, `resolution`, `mouse.smooth`, `mouse.smoother` instead of updating your own each frame.

## Events

```js
const off = app.events.on(EVENTS.APP_RESIZE, fn, PRIORITY.first) // lower priority runs first
app.events.once(EVENTS.WEBGL_APP_READY, fn)
app.events.addEvents({ MY_EVENT: 'MY:EVENT' }) // register before subscribing, or you get a warning
```

Defaults: `APP_TICK`, `APP_RESIZE`, `APP_SCROLL`, `APP_MOUSE_MOVE`, `APP_MOUSE_DRAG`, `APP_MOUSE_HOLD`, `WEBGL_BEFORE_RENDER`, `WEBGL_AFTER_RENDER`, `WEBGL_APP_LOADING`, `WEBGL_APP_LOADED`, `WEBGL_APP_READY`, `WEBGL_STATE_CHANGE`, `RESOURCES_PROGRESS`, `APP_DESTROY`. Priorities: `first -10`, `instant 0`, `high 10`, `mid 20`, `low 30`.

## Scroll with Lenis

Drive both from one ticker, Lenis first, and feed the scroll into the app:

```js
const lenis = new Lenis({ autoResize: false })
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

## Custom render (post-processing)

```js
app.setRenderFunction((state, { gl, scene, camera }) => {
    gl.setRenderTarget(target)
    gl.render(scene, camera)
    gl.setRenderTarget(null)
    gl.render(postQuad, postCamera)
})
app.setRenderFunction(null) // restore default
```

The default render is skipped while a function is set. Resize targets on `APP_RESIZE`, dispose on `APP_DESTROY`.

## Resources

```js
await app.resources.load([
    { key: 'robot', type: 'gltf', path: '/gl/robot.glb' },
    { key: 'paper', type: 'texture', path: '/gl/paper.jpg', colorSpace: 'SRGBColorSpace', compress: true },
], { onProgress: ({ progress }) => {} })
app.resources.get('robot')
```

Types: `texture`, `gltf`, `fbo`, `envmap`, `gainmap`. `compress`, Draco, envmap, gainmap and curves need the matching `resources.support` flag (or `await app.resources.addSupport({ ... })`); otherwise loading throws.

## Building blocks

```js
import { Tracker, PlaneBackground, StencilMesh, SectionMask, FitModel, FullscreenQuad, BufferViewer } from '@dghez/keemera/shards'
import { getPlaneSize, uvCover } from '@dghez/keemera/helpers'
import { noise3d, curlNoise, map, coverUv, aastep /* ... */ } from '@dghez/keemera/shaders'
```

- `Tracker({ store, tracker, preventUpdateScale, sticky })`: `Group` that follows a DOM element (needs `camera.useDomSize`). `sticky: { container, start: 'top top', end: 'bottom bottom' }` pins it; read `stickyProgress`, `isActive`, `trackSize`.
- `PlaneBackground`: `Tracker` with a 1×1 plane; set `preventUpdateScale: false` to cover the element; replace `bg.material` freely.
- `StencilMesh` / `SectionMask`: clip content with `mask.applyStencilToMaterial(material)`; need `renderer: { stencil: true }`.
- `FitModel({ model, tracker, scaleFactor })`: scales a model to fit a tracker or `fit(w, h)`.
- `FullscreenQuad(material)` with `fullscreenQuadVertexShader` / `fullscreenQuadFragmentShader`.
- Shaders are plain strings with include guards: inline with `${noise3d}` in your GLSL, duplicates are safe.

Add shards to a `Shepherd` and to the scene (`app.scene.add(obj)`).

## Pitfalls

- Missing `{ store }` on a shard throws `[Keemera] <Name> requires { store }`.
- Tracker positions look wrong → app created without `camera: { useDomSize: true }`, or the tracked element itself is CSS `position: sticky`.
- Nothing renders → `autoRender: false` with no render function, or `autoRun: false` with no one calling `app.tick()`.
- Double scroll lag/jitter → Lenis and keemera on separate loops; use the single-ticker pattern above.
- Custom gesture input (`gestures: false`): emit `APP_MOUSE_MOVE` with `{ xy: [x, y] }` in pixels relative to the wrapper.
