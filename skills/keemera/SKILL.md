---
name: keemera
description: Build WebGL scenes with the keemera Three.js starter library. Use when code imports '@dghez/keemera', '@dghez/keemera/shards', '@dghez/keemera/helpers' or '@dghez/keemera/shaders', or when setting up a Keemera app, DOM-tracked meshes (Tracker, PlaneBackground, SectionMask), DOM text drawn in WebGL (TextLayer, keemera-font, .kfont), Lenis scroll sync, custom render/post-processing, resources loading or Shepherd lifecycle.
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
- **Use `app.store` before writing your own.** Before adding pointer, resize, scroll or clock code, check what the store already has:
  - `store.mouse`: `static`, `smooth`, `smoother` (NDC, y up), `viewport`, `viewportSmooth` (px), `isDragging`, `isHolding`
  - `store.viewport`: `width`, `height`, `dpr`, `scroll`
  - `store.time`
  - `store.uniforms`: `time`, `timeScale`, `resolution` (css width, height, dpr), `mouse.smooth`, `mouse.smoother` (NDC)

  Pass the store's uniform objects straight into materials, so nothing has to update them per frame:
  ```js
  uniforms: { uMouse: store.uniforms.mouse.smooth, uResolution: store.uniforms.resolution }
  // GLSL, world px from the canvas center (camera.useDomSize): vec2 mouse = uMouse * uResolution.xy * 0.5;
  ```
  If something you need isn't in the store, add it to the store (your own keys) and share it from there, rather than keeping a local copy in one component.
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

TypeScript: types ship with the package (install `@types/three`). Default event payloads are inferred; type custom ones by augmenting the map:

```ts
declare module '@dghez/keemera' {
    interface KeemeraEventMap { 'MY:EVENT': [count: number] }
}
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

Types: `texture`, `gltf`, `fbo`, `envmap`, `gainmap`, `font` (`.kfont` pack for `TextLayer`). `compress`, Draco, envmap, gainmap and curves need the matching `resources.support` flag (or `await app.resources.addSupport({ ... })`); otherwise loading throws.

## Building blocks

```js
import { Tracker, PlaneBackground, StencilMesh, SectionMask, FitModel, FullscreenQuad, BufferViewer, MouseFluid, TextLayer } from '@dghez/keemera/shards'
import { getPlaneSize, uvCover } from '@dghez/keemera/helpers'
import { noise3d, curlNoise, map, coverUv, aastep /* ... */ } from '@dghez/keemera/shaders'
```

- `Tracker({ store, tracker, preventUpdateScale, sticky })`: `Group` that follows a DOM element (needs `camera.useDomSize`). `sticky: { container, start: 'top top', end: 'bottom bottom' }` pins it; read `stickyProgress`, `isActive`, `trackSize`.
- `PlaneBackground`: `Tracker` with a 1×1 plane; set `preventUpdateScale: false` to cover the element; replace `bg.material` freely.
- `StencilMesh` / `SectionMask`: clip content with `mask.applyStencilToMaterial(material)`; need `renderer: { stencil: true }`.
- `FitModel({ model, tracker, scaleFactor })`: scales a model to fit a tracker or `fit(w, h)`.
- `FullscreenQuad(material)` with `fullscreenQuadVertexShader` / `fullscreenQuadFragmentShader`.
- `MouseFluid({ store, resolution, blur, turbulence: { texture, strength }, debug })`: offscreen mouse fluid (turbulence is optional: a tileable noise texture, `fluid.turbulenceStrength` to tweak); share `fluid.uniform` (rg velocity, 0.5 = still; b strength; screen uv y-up) with your materials. Add it to a `Shepherd` so it updates on `APP_TICK`, before the render. `@dghez/keemera/shards` needs `postprocessing` installed. For the ready-made distortion, put `MouseFluid.distortionShader` (GLSL) in any shader and bind `fluid.distortionUniforms`: `mouseFluidDistort(map, screenUv)` returns the distorted, color-shifted sample. Use the `distortion` prop or `fluid.distortion.<name>.value` to tune it (defaults: `MouseFluid.distortionPreset`).
- `TextLayer({ store, fonts, hideDom, compare, wireframe, budget, cullMargin, material })`: draws DOM text with WebGL (Slug), matched 1:1 to the layout the browser made. `text.track(el | selector, { live, material })` returns a `TextBlock` (`isDrawn`, `glyphCount`, `chars`, `words`, `lines`, `missing`); `text.untrack(el)`; `text.invalidate()`. One draw call per font pack and material for all elements, skipped when none of its elements is on screen (`cullMargin`, default 200 px, keeps room for effects that move glyphs); needs `camera.useDomSize` and scroll through `app.setScroll`. Fonts: bake the same files the CSS `@font-face` serves with `npx keemera-font <files…> -o public/fonts/x.kfont` (needs `fontkit`; `-t <em>` refits the outlines with fewer curves, default 0.0005, which makes heavy or hand-cut faces faster to draw), then load `{ key, type: 'font', path }`. `live: true` for CSS-sticky or transformed elements. `compare: true` tints the DOM copy red under the GPU copy to check alignment; `wireframe: true` / `text.wireframe = true` outlines each glyph's ink box instead of drawing it. Materials: any three.js material (troika-style wrap), per element via `track(el, { material })` or for the layer via `material` / `text.material = …`. Built-ins get the DOM color in `diffuseColor` (`material.color` tints it). A `ShaderMaterial` is written as for a plain mesh: `position` and `uv` (0–1 across the element) are the glyph's, coverage is applied after its `main()`, so it must write `gl_FragColor` (no `glslVersion: GLSL3`, no `RawShaderMaterial`); it can read `keemeraIndex` (char, word, line, charInLine), `keemeraColor`, `keemeraGlyphUv`, `keemeraSize`, `keemeraSetGlyph(int)` (vertex, before reading `position`: draws another letter or digit of the same face, e.g. a scramble), `keemeraSetPadding(px)` (vertex: room outside the glyph) with `keemeraCoverageAt(offsetPx)` (fragment: coverage elsewhere, for blur, glow, outlines), `keemeraCoverage` (writable: it's applied after `main()`, `= 1.0` draws the whole quad), and `keemeraGlyphCenter` / `keemeraWordCenter` / `keemeraLineCenter` (same space as `position`) to move a glyph, word or line as one piece.
- Shaders are plain strings with include guards: inline with `${noise3d}` in your GLSL, duplicates are safe.

Add shards to a `Shepherd` and to the scene (`app.scene.add(obj)`).

## Pitfalls

- Missing `{ store }` on a shard throws `[Keemera] <Name> requires { store }`.
- Tracker positions look wrong → app created without `camera: { useDomSize: true }`, or the tracked element itself is CSS `position: sticky`.
- Nothing renders → `autoRender: false` with no render function, or `autoRun: false` with no one calling `app.tick()`.
- Double scroll lag/jitter → Lenis and keemera on separate loops; use the single-ticker pattern above.
- A TextLayer element stays visible as plain DOM text → it uses a character or font family missing from the `.kfont` (see the console warning); bake it with `--chars` or add the face's file to the pack.
- TextLayer glyphs misaligned → the CSS font file differs from the baked one, ligatures/OpenType features are forced back on, or an ancestor has a CSS transform.
- Your own `pointermove` listener, `requestAnimationFrame` clock or `resize` handler duplicates `store.mouse`, `store.time` or `store.viewport` (and drifts out of the app's frame order): read the store instead.
- Custom gesture input (`gestures: false`): emit `APP_MOUSE_MOVE` with `{ xy: [x, y] }` in pixels relative to the wrapper.
