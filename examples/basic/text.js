import { gsap } from 'gsap'
import Lenis from 'lenis'
import { AmbientLight, Color, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshPhongMaterial, PlaneGeometry, PointLight, ShaderMaterial, Vector4, WebGLRenderTarget } from 'three'
import Keemera, { EVENTS, PRIORITY, Shepherd } from '@dghez/keemera'
import { MouseFluid, PlaneBackground, TextLayer, Tracker } from '@dghez/keemera/shards'

import './style.css'

/* ───────── Options: ?compare, ?wireframe (or W), ?debug ───────── */

const params = new URLSearchParams(window.location.search)

/* ───────── Plate VII copy: deterministic, a few thousand glyphs ───────── */

const WORDS = 'outline curve band glyph pixel winding coverage quadratic browser layout kerning baseline ray texel instance shader scroll measure range font face ink edge sample quill vellum rubric margin folio'.split(' ')
let seed = 7
const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647

const stress = document.querySelector('[data-stress]')
for (let p = 0; p < 18; p++) {
    const words = Array.from({ length: 58 }, () => WORDS[Math.floor(random() * WORDS.length)])
    words[0] = words[0][0].toUpperCase() + words[0].slice(1)
    const el = document.createElement('p')
    el.className = 'text-justify'
    el.dataset.text = ''
    el.textContent = `${words.join(' ')}.`
    stress.append(el)
}

/* ───────── App ───────── */

const lenis = new Lenis({ lerp: 0.12, wheelMultiplier: 1.1, autoResize: false })

const wrapper = document.querySelector('[data-gl]')
const app = new Keemera({
    wrapper,
    canvas: wrapper.querySelector('canvas'),
    debug: params.has('debug'),
    autoRun: false,
    // Slug antialiases every glyph itself
    renderer: { antialias: false },
    clearAlpha: 0,
    camera: { useDomSize: true },
    preload: [
        // IM Fell English (roman, italic, SC) and EB Garamond (roman, italic), baked with `npm run fonts`
        { key: 'liber', type: 'font', path: '/fonts/liber.kfont' },
        { key: 'turbulence', type: 'texture', path: '/turbulence.jpg' },
    ],
})

lenis.on('scroll', ({ scroll }) => app.setScroll(scroll))
app.setScroll(lenis.scroll)
app.events.on(EVENTS.APP_RESIZE, () => lenis.resize(), PRIORITY.first)

await app.ready

const { store } = app

/* ───────── Inks: the page's palette, linear ───────── */

const INK = new Color('#1c1b18')
const RUBRIC = new Color('#a3392a')
const WOAD = new Color('#2f4f8f')

const plain = /* glsl */`
    void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`

// mouse repulsion, shared by several materials. The store's eased mouse (NDC) and resolution (css px) are shared
// uniforms: nothing to update per frame
const repelUniforms = () => ({
    uMouse: store.uniforms.mouse.smooth,
    uResolution: store.uniforms.resolution,
    uRadius: { value: 180 },
    uStrength: { value: 48 },
})

const repel = /* glsl */`
    uniform vec2 uMouse;
    uniform vec3 uResolution;
    uniform float uRadius;
    uniform float uStrength;

    // moves p away from the mouse, as one piece around center; returns the force, 0–1
    float repel(inout vec3 p, vec2 center) {
        // NDC → world px, origin at the canvas center like the layer
        vec2 mouse = uMouse * uResolution.xy * 0.5;
        vec2 away = (modelMatrix * vec4(center, 0.0, 1.0)).xy - mouse;
        float distance = length(away);
        float force = clamp(1.0 - distance / uRadius, 0.0, 1.0);
        force *= force;
        p.xy += away / max(distance, 1e-3) * force * uStrength;
        return force;
    }
`

const shader = options => new ShaderMaterial({ transparent: true, depthWrite: false, ...options })

/* Plate IV: three inks */

// a built-in material: the DOM color (white here) times material.color
const basic = new MeshBasicMaterial({ color: WOAD, transparent: true, depthWrite: false })

// does nothing a default material wouldn't: keemeraColor is the DOM color, linear
const passthrough = shader({
    vertexShader: plain,
    fragmentShader: /* glsl */`
        void main() {
            gl_FragColor = keemeraColor;
            #include <colorspace_fragment>
        }
    `,
})

// `uv` spans the whole element
const gradient = shader({
    uniforms: { uFrom: { value: RUBRIC }, uTo: { value: INK } },
    vertexShader: /* glsl */`
        varying vec2 vUv;

        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: /* glsl */`
        uniform vec3 uFrom;
        uniform vec3 uTo;
        varying vec2 vUv;

        void main() {
            gl_FragColor = vec4(mix(uFrom, uTo, smoothstep(0.0, 1.0, vUv.x)), 1.0);
            #include <colorspace_fragment>
        }
    `,
})

/* Plate III: every glyph is a quad */

const leafVertex = /* glsl */`
    ${repel}

    varying vec2 vGlyphUv;

    void main() {
        vec3 p = position;
        repel(p, keemeraGlyphCenter);
        vGlyphUv = keemeraGlyphUv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }
`

// painted with its own UV (red = u, green = v), the glyph on top. Overwriting keemeraCoverage keeps the whole
// rectangle instead of cutting it to the glyph's outline
const glyphUv = shader({
    uniforms: repelUniforms(),
    vertexShader: leafVertex,
    fragmentShader: /* glsl */`
        varying vec2 vGlyphUv;

        void main() {
            vec3 color = mix(vec3(vGlyphUv, 0.0), keemeraColor.rgb, keemeraCoverage);
            gl_FragColor = vec4(color, 1.0);
            keemeraCoverage = 1.0;
            #include <colorspace_fragment>
        }
    `,
})

// the quad's edge in rubric, 1 device px, around the glyph in ink
const glyphBox = shader({
    uniforms: { ...repelUniforms(), uEdge: { value: RUBRIC } },
    vertexShader: leafVertex,
    fragmentShader: /* glsl */`
        uniform vec3 uEdge;
        varying vec2 vGlyphUv;

        void main() {
            vec2 inside = min(vGlyphUv, 1.0 - vGlyphUv) / fwidth(vGlyphUv);
            float edge = 1.0 - clamp(min(inside.x, inside.y), 0.0, 1.0);
            float glyph = keemeraCoverage;

            gl_FragColor = vec4(mix(uEdge, keemeraColor.rgb, glyph), 1.0);
            keemeraCoverage = max(glyph, edge);
            #include <colorspace_fragment>
        }
    `,
})

/* Plate V: pushed away by the hand, by letter, word or line; the farther, the more rubric */

const push = center => shader({
    uniforms: { ...repelUniforms(), uColor: { value: RUBRIC } },
    vertexShader: /* glsl */`
        ${repel}

        varying float vShift;

        void main() {
            vec3 p = position;
            vShift = repel(p, ${center});
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
    `,
    fragmentShader: /* glsl */`
        uniform vec3 uColor;
        varying float vShift;

        void main() {
            vec3 color = mix(keemeraColor.rgb, uColor, clamp(vShift * 1.5, 0.0, 1.0));
            gl_FragColor = vec4(color, keemeraColor.a);
            #include <colorspace_fragment>
        }
    `,
})

/* Plate VI: the hand scrambles the letters. Each glyph reads the mouse fluid under its center; where it runs, the
   glyph is swapped for another letter of its face (keemeraSetGlyph), faster where the fluid is stronger */

const fluid = new MouseFluid({
    store,
    turbulence: { texture: app.resources.get('turbulence'), strength: 1 },
})
// tuned for text: a broader brush, and a field that takes about half a second to settle instead of a tenth,
// so the effects linger like ink in water
fluid.settings.radius.value *= 1.8
fluid.settings.strengthFade.value = 0.99
fluid.settings.velocityFade.value = 0.985

// the flow at a screen uv: velocity (-1..1) and how much is going on there, 0..1. The velocity is what the fluid
// carries and swirls; the brush's strength alone fades in place, so both count
const flow = /* glsl */`
    uniform sampler2D uFluid;

    vec3 flowAt(vec2 screenUv, float amount) {
        vec3 sim = texture(uFluid, screenUv).rgb;
        vec2 velocity = (sim.rg - 0.5) * 2.0;
        float raw = max(sim.b, length(velocity) * 1.5);
        // an exponential fade never quite reaches 0: drop the faint tail, so the effects end instead of lingering
        float live = max(raw - 0.06, 0.0) / 0.94;
        return vec3(velocity, clamp(live * amount, 0.0, 1.0));
    }
`

const scrambled = shader({
    uniforms: {
        uFluid: fluid.uniform,
        uTime: store.uniforms.time,
        uAmount: { value: 2 },
        uRubric: { value: RUBRIC },
    },
    vertexShader: /* glsl */`
        ${flow}
        uniform float uTime;
        uniform float uAmount;

        varying float vScramble;

        float hash(float n) {
            return fract(sin(n) * 43758.5453);
        }

        void main() {
            // the fluid under the glyph's center (screen uv, y up)
            vec4 clip = projectionMatrix * modelViewMatrix * vec4(keemeraGlyphCenter, 0.0, 1.0);
            float stir = flowAt(clip.xy / clip.w * 0.5 + 0.5, uAmount).z;

            // each letter has a fixed threshold: above it, it's lost; below, it's itself. The field fades
            // exponentially, so the thresholds are spread on a log scale (0.05 to 0.7): the letters then come back
            // at an even rate over the whole fade, not in a rush at its start
            float char = keemeraIndex.x;
            float threshold = 0.05 * pow(14.0, hash(char * 1.37));
            float unrest = smoothstep(threshold, threshold * 2.0, stir);

            if (stir > threshold) {
                // an unhurried flip, each letter at its own steady pace, a touch quicker while stirred hard
                float pace = mix(1.2, 2.4, hash(char * 2.71)) * mix(1.0, 1.6, unrest);
                float tick = floor(uTime * pace + hash(char * 7.13) * 4.0);
                keemeraSetGlyph(int(hash(char * 3.1 + tick * 17.7) * 997.0));
                vScramble = mix(0.35, 1.0, unrest);
            } else {
                vScramble = 0.0;
            }

            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: /* glsl */`
        uniform vec3 uRubric;
        varying float vScramble;

        void main() {
            gl_FragColor = vec4(mix(keemeraColor.rgb, uRubric, vScramble * 0.85), keemeraColor.a);
            #include <colorspace_fragment>
        }
    `,
})

const hash12 = /* glsl */`
    float hash12(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
    }
`

/* Plate VI, second figure: a grainy blur where the hand breathes on the page. Each pixel takes a few coverage
   samples scattered over a disc (keemeraCoverageAt) whose radius follows the fluid; the scatter changes every
   frame, so the blur is grain, not smoothness. The quads grow to make room (keemeraSetPadding) */

const breathed = shader({
    uniforms: {
        uFluid: fluid.uniform,
        uResolution: store.uniforms.resolution,
        uTime: store.uniforms.time,
        uAmount: { value: 1 },
        uRadius: { value: 10 },
        uTint: { value: RUBRIC },
    },
    vertexShader: /* glsl */`
        uniform float uRadius;

        void main() {
            keemeraSetPadding(uRadius);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: /* glsl */`
        ${flow}
        uniform vec3 uResolution;
        uniform float uTime;
        uniform float uAmount;
        uniform float uRadius;
        uniform vec3 uTint;

        ${hash12}

        void main() {
            vec3 f = flowAt(gl_FragCoord.xy / (uResolution.xy * uResolution.z), uAmount);
            // device px
            float radius = f.z * uRadius * uResolution.z;

            if (radius > 0.5) {
                // smeared along the current, a little across it, with a scatter that changes every frame: grain
                vec2 along = length(f.xy) > 1e-3 ? normalize(f.xy) : vec2(1.0, 0.0);
                vec2 across = vec2(-along.y, along.x);
                float frame = floor(uTime * 24.0);
                float sum = 0.0;
                for (int i = 0; i < 4; i++) {
                    vec2 seed = gl_FragCoord.xy + float(i) * 17.31 + frame * 3.1;
                    float a = hash12(seed) - 0.5;
                    float b = hash12(seed + 9.7) - 0.5;
                    sum += keemeraCoverageAt((along * a * 2.0 + across * b * 0.6) * radius);
                }
                keemeraCoverage = sum / 4.0;
            }

            gl_FragColor = vec4(mix(keemeraColor.rgb, uTint, f.z * 0.3), keemeraColor.a);
            #include <colorspace_fragment>
        }
    `,
})

/* Plate VI, third figure: the current bends the letters. The library's MouseFluid.distortionShader gives the
   offset and the color shift, as on the fluid page; here each pixel reads the glyph's coverage at that offset, three
   times apart along it for the aberration */

const PAPER = new Color('#f2f0ea')

const warped = shader({
    uniforms: {
        ...fluid.distortionUniforms,
        uResolution: store.uniforms.resolution,
        uPadding: { value: 18 },
        // the snippet is tuned for a full-screen post pass: a fraction of its offset is plenty for a glyph
        uScale: { value: 0.3 },
        uSplit: { value: 6 },
        uPaper: { value: PAPER },
    },
    vertexShader: /* glsl */`
        uniform float uPadding;

        void main() {
            keemeraSetPadding(uPadding);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: /* glsl */`
        ${MouseFluid.distortionShader}
        uniform vec3 uResolution;
        uniform float uPadding;
        uniform float uScale;
        uniform float uSplit;
        uniform vec3 uPaper;

        void main() {
            vec2 toPx = uResolution.xy * uResolution.z;
            vec3 shift;
            vec2 offset = mouseFluidDistortion(gl_FragCoord.xy / toPx, shift) * toPx * uScale;
            // the same for the bend: under a device pixel or two of offset, it's tail, not water
            float live = smoothstep(0.75, 2.5, length(offset));
            offset *= live;
            shift *= live;
            // never further than the quad reaches, or the glyph would be cut
            float reach = uPadding * 0.6 * uResolution.z;
            if (length(offset) > reach) offset = normalize(offset) * reach;

            // still water: the coverage already computed is the answer, no extra outline evaluations
            if (dot(offset, offset) < 0.0625 && dot(shift, shift) < 1e-4) {
                gl_FragColor = keemeraColor;
                #include <colorspace_fragment>
                return;
            }

            // red and blue pulled apart along the offset, as far as the color shift is strong
            vec2 along = length(offset) > 1e-3 ? normalize(offset) : vec2(1.0, 0.0);
            vec2 split = along * min(length(shift), 1.0) * uSplit * uResolution.z;
            vec3 channels = vec3(
                keemeraCoverageAt(offset + split),
                keemeraCoverageAt(offset),
                keemeraCoverageAt(offset - split)
            );

            // one alpha for three channels: the paper fills in where a channel has no ink
            float coverage = max(channels.r, max(channels.g, channels.b));
            vec3 ink = keemeraColor.rgb + shift;
            keemeraCoverage = coverage;
            gl_FragColor = vec4(mix(uPaper, ink, channels / max(coverage, 1e-4)), keemeraColor.a);
            #include <colorspace_fragment>
        }
    `,
})

/* Plate I: the title dissolves into ink grain and re-forms as its English, on loop, like the homepage's title.
   Two stacked elements share one grain: where one keeps a pixel the other drops it */

const inkSwap = isLatin => shader({
    uniforms: {
        uGrain: { value: app.resources.get('turbulence') },
        uResolution: store.uniforms.resolution,
        uTime: store.uniforms.time,
        uPeriod: { value: 8 },
    },
    vertexShader: plain,
    fragmentShader: /* glsl */`
        uniform sampler2D uGrain;
        uniform vec3 uResolution;
        uniform float uTime;
        uniform float uPeriod;

        void main() {
            // 0 = Latin, 1 = English: hold, dissolve, hold, dissolve back
            float t = fract(uTime / uPeriod);
            float swap = smoothstep(0.38, 0.5, t) - smoothstep(0.88, 1.0, t);

            float grain = texture(uGrain, gl_FragCoord.xy / (uResolution.z * 140.0)).r;
            float edge = mix(-0.15, 1.15, swap);
            float latin = smoothstep(edge - 0.08, edge + 0.08, grain);

            gl_FragColor = keemeraColor;
            keemeraCoverage *= ${isLatin ? 'latin' : '1.0 - latin'};
            #include <colorspace_fragment>
        }
    `,
})

/* Plate VIII: by candlelight. The dark ground is drawn in WebGL (a DOM background would hide the canvas, which sits
   behind the page): a PlaneBackground over the section, lit too. The letters use a plain MeshPhongMaterial, and a
   PointLight follows the store's mouse, a little in front of the page */

const candleGround = new PlaneBackground({
    store,
    tracker: '[data-candle]',
    preventUpdateScale: false,
})
candleGround.mesh.material = new MeshLambertMaterial({ color: new Color('#16130f') })
// under the letters, which sit on the same plane
candleGround.mesh.material.depthWrite = false
candleGround.mesh.renderOrder = -1
app.scene.add(candleGround)

const candleInk = new MeshPhongMaterial({
    color: 0xffffff,
    specular: new Color('#e9b45a'),
    shininess: 28,
    transparent: true,
    depthWrite: false,
})

const candle = new PointLight(new Color('#ffd9a0'), 2600, 900, 1.15)
app.scene.add(candle, new AmbientLight(new Color('#c9b8a0'), 0.12))

// the store's eased mouse, NDC → world px (camera.useDomSize), held a little in front of the page
app.events.on(EVENTS.APP_TICK, () => {
    const { smooth } = store.mouse
    const { width, height } = store.viewport
    candle.position.set(smooth.x * width * 0.5, smooth.y * height * 0.5, 140)
})

/* ───────── Text layer ───────── */

const text = new TextLayer({ store, compare: params.has('compare'), wireframe: params.has('wireframe') })
app.scene.add(text)

const materials = {
    'basic': basic,
    'passthrough': passthrough,
    'gradient': gradient,
    'glyph-uv': glyphUv,
    'glyph-box': glyphBox,
    'push-glyph': push('keemeraGlyphCenter'),
    'push-word': push('keemeraWordCenter'),
    'push-line': push('keemeraLineCenter'),
    'title-latin': inkSwap(true),
    'title-english': inkSwap(false),
    'folio': scrambled,
    'candle': candleInk,
    'candle-small': candleInk,
    'breath': breathed,
    'warp': warped,
}

document.querySelectorAll('[data-text]').forEach((el) => {
    text.track(el, {
        // the running head is position: fixed
        live: el.dataset.text === 'live',
        material: materials[el.dataset.text],
    })
})

// W toggles the glyph boxes
window.addEventListener('keydown', (e) => {
    if (e.key === 'w' && !e.metaKey && !e.ctrlKey && !e.target.isContentEditable) text.wireframe = !text.wireframe
})

const shepherd = new Shepherd()
shepherd.add(candleGround)
shepherd.add(text)

app.events.on(EVENTS.APP_TICK, state => shepherd.update(state))
app.events.on(EVENTS.APP_RESIZE, state => shepherd.resize(state))
app.events.on(EVENTS.APP_DESTROY, () => shepherd.destroy())

/* ───────── Plate IX: Oniric, god rays from the word ─────────
   The word has its own TextLayer, so it can be rendered alone into a small mask framed on the word itself (same
   aspect, a quarter of its size: every texel is spent on the word, even the parts scrolled off screen). A plane
   behind the section marches each pixel toward the light (the store's mouse) through that mask: wherever the word
   stands between the pixel and the light, ink accumulates, so the word throws rays away from the hand. Nothing runs
   while the section is off screen: the plane is a Tracker, whose isActive follows an IntersectionObserver */

const oniric = document.querySelector('[data-oniric]')

// the word spans the page: size it to the section's width once fonts are in, and on every resize
const fitOniric = () => {
    oniric.style.fontSize = '20vw'
    const style = getComputedStyle(oniric)
    const available = oniric.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    const range = document.createRange()
    range.selectNodeContents(oniric)
    oniric.style.fontSize = `${(20 * available) / range.getBoundingClientRect().width}vw`
}
await document.fonts.ready
fitOniric()
app.events.on(EVENTS.APP_RESIZE, fitOniric)

// a wide cull margin: the mask frames the whole word, even the parts outside the viewport
const oniricText = new TextLayer({ store, cullMargin: 4000 })
oniricText.track(oniric)
app.scene.add(oniricText)
shepherd.add(oniricText)

const MASK_SCALE = 0.25
// room around the element for ink that overhangs its box (italic tails, accents), css px
const MASK_MARGIN = 24
const mask = new WebGLRenderTarget(1, 1, { depthBuffer: false })
// the word's frame on screen, css px, top-left origin; and as screen uv (x, y bottom, w, h) for the shader
const frame = { x: 0, y: 0, width: 1, height: 1 }
const maskRect = new Vector4()

// from the rect the layer already keeps (document px): no DOM reads per frame
const updateFrame = () => {
    const block = oniricText.blocks[0]
    if (!block) return false
    const { doc } = block
    const { width, height, scroll } = store.viewport
    frame.x = doc.x - MASK_MARGIN
    frame.y = doc.y - scroll.y - MASK_MARGIN
    frame.width = doc.width + MASK_MARGIN * 2
    frame.height = doc.height + MASK_MARGIN * 2
    maskRect.set(frame.x / width, 1 - (frame.y + frame.height) / height, frame.width / width, frame.height / height)
    return true
}

// same aspect as the word, a quarter of its size
const sizeMask = () => {
    if (!updateFrame()) return
    mask.setSize(Math.max(1, Math.round(frame.width * MASK_SCALE)), Math.max(1, Math.round(frame.height * MASK_SCALE)))
}
app.events.on(EVENTS.APP_RESIZE, sizeMask)

// visibility only: the section's Tracker knows when it's on screen (IntersectionObserver)
const oniricGate = new Tracker({ store, tracker: '[data-oniric-section]', preventUpdatePosition: true })
shepherd.add(oniricGate)

const raysMaterial = new ShaderMaterial({
    uniforms: {
        uMask: { value: mask.texture },
        uMaskRect: { value: maskRect },
        uMouse: store.uniforms.mouse.smooth,
        uResolution: store.uniforms.resolution,
        // the knobs: steps per ray (cost), how far toward the light they reach, how fast each step fades
        uSamples: { value: 32 },
        uLength: { value: 0.45 },
        uDecay: { value: 0.965 },
        uStrength: { value: 2.2 },
        uInk: { value: INK },
    },
    vertexShader: plain,
    fragmentShader: /* glsl */`
        uniform sampler2D uMask;
        // where the mask sits on screen: x, y (bottom), width, height, in screen uv
        uniform vec4 uMaskRect;
        uniform vec2 uMouse;
        uniform vec3 uResolution;
        uniform int uSamples;
        uniform float uLength;
        uniform float uDecay;
        uniform float uStrength;
        uniform vec3 uInk;

        float hash12(vec2 p) {
            vec3 p3 = fract(vec3(p.xyx) * 0.1031);
            p3 += dot(p3, p3.yzx + 33.33);
            return fract((p3.x + p3.y) * p3.z);
        }

        void main() {
            vec2 uv = gl_FragCoord.xy / (uResolution.xy * uResolution.z);
            vec2 light = uMouse * 0.5 + 0.5;
            // the ray from this pixel toward the light, as far as it reaches: uv + ray * t, t in 0..1
            vec2 ray = (light - uv) * uLength + 1e-6;

            // only the part of the ray inside the word's frame can find ink (slab test against the rect)
            vec2 a = (uMaskRect.xy - uv) / ray;
            vec2 b = (uMaskRect.xy + uMaskRect.zw - uv) / ray;
            vec2 near = min(a, b);
            vec2 far = max(a, b);
            float t0 = max(max(near.x, near.y), 0.0);
            float t1 = min(min(far.x, far.y), 1.0);

            float ink = 0.0;
            if (t0 < t1) {
                // march only the steps that fall in the frame; a per-pixel offset hides the banding of few steps
                float count = float(uSamples);
                float jitter = hash12(gl_FragCoord.xy);
                int first = int(floor(t0 * count));
                int last = int(ceil(t1 * count));
                for (int i = 0; i < 64; i++) {
                    if (i > last || i >= uSamples) break;
                    if (i < first) continue;
                    vec2 m = (uv + ray * ((float(i) + jitter) / count) - uMaskRect.xy) / uMaskRect.zw;
                    if (m.x >= 0.0 && m.y >= 0.0 && m.x <= 1.0 && m.y <= 1.0) ink += texture(uMask, m).a * pow(uDecay, float(i));
                }
                ink = ink / count * uStrength;
            }

            gl_FragColor = vec4(uInk, clamp(ink, 0.0, 1.0));

            #include <colorspace_fragment>
        }
    `,
    transparent: true,
    depthWrite: false,
})

// the rays' plane only covers where rays can land, recomputed each frame from the word's frame and the light
const rays = new Mesh(new PlaneGeometry(1, 1), raysMaterial)
// under the word, which sits on the same plane
rays.renderOrder = -1
rays.frustumCulled = false
app.scene.add(rays)

// a pixel P picks up ink if the word lies within uLength of the way from P to the light L: so rays land in the
// word's frame scaled away from L by up to 1 / (1 - uLength). That box, clipped to the section and the screen
const fitRays = () => {
    const { width, height, scroll } = store.viewport
    const { smooth } = store.mouse
    const lx = (smooth.x + 1) * 0.5 * width
    const ly = (1 - smooth.y) * 0.5 * height
    const k = 1 / (1 - raysMaterial.uniforms.uLength.value)

    const x0 = frame.x
    const y0 = frame.y
    const x1 = frame.x + frame.width
    const y1 = frame.y + frame.height
    let left = Math.min(x0, lx + (x0 - lx) * k)
    let right = Math.max(x1, lx + (x1 - lx) * k)
    let top = Math.min(y0, ly + (y0 - ly) * k)
    let bottom = Math.max(y1, ly + (y1 - ly) * k)

    const sectionTop = oniricGate.rect.top + oniricGate.offset.y - scroll.y
    left = Math.max(left, oniricGate.rect.left, 0)
    right = Math.min(right, oniricGate.rect.left + oniricGate.rect.width, width)
    top = Math.max(top, sectionTop, 0)
    bottom = Math.min(bottom, sectionTop + oniricGate.rect.height, height)
    if (right <= left || bottom <= top) return false

    // screen px, y down → world px from the center, y up (camera.useDomSize)
    rays.scale.set(right - left, bottom - top, 1)
    rays.position.set((left + right) * 0.5 - width * 0.5, height * 0.5 - (top + bottom) * 0.5, 0)
    return true
}

const clearColor = new Color()
app.events.on(EVENTS.WEBGL_BEFORE_RENDER, () => {
    rays.visible = false
    if (!oniricGate.isActive || !updateFrame()) return
    rays.visible = fitRays()
    if (!rays.visible) return

    // the word's frame changes size when it's measured again (fonts, resize): follow it
    const w = Math.max(1, Math.round(frame.width * MASK_SCALE))
    const h = Math.max(1, Math.round(frame.height * MASK_SCALE))
    if (w !== mask.width || h !== mask.height) mask.setSize(w, h)

    // the word alone, into the mask: the camera frames only the word, a window of the full view
    const { gl, camera } = app
    const { width, height } = store.viewport
    const target = gl.getRenderTarget()
    const alpha = gl.getClearAlpha()
    gl.getClearColor(clearColor)
    camera.setViewOffset(width, height, frame.x, frame.y, frame.width, frame.height)

    gl.setRenderTarget(mask)
    gl.setClearColor(0x000000, 0)
    gl.clear()
    gl.render(oniricText, camera)
    camera.clearViewOffset()
    gl.setRenderTarget(target)
    gl.setClearColor(clearColor, alpha)
})
app.events.on(EVENTS.APP_DESTROY, () => {
    mask.dispose()
    rays.geometry.dispose()
    raysMaterial.dispose()
})

// the fluid only feeds Plate VI: simulate it only while that plate is on screen
let fluidVisible = false
const fluidObserver = new IntersectionObserver(([entry]) => { fluidVisible = entry.isIntersecting })
fluidObserver.observe(document.querySelector('[data-text="folio"]').closest('section'))

app.events.on(EVENTS.APP_TICK, () => { if (fluidVisible) fluid.update() })
app.events.on(EVENTS.APP_RESIZE, () => fluid.resize())
app.events.on(EVENTS.APP_DESTROY, () => {
    fluidObserver.disconnect()
    fluid.destroy()
})

/* ───────── Readouts: scroll meter, volume and HUD ───────── */

const hud = Object.fromEntries([...document.querySelectorAll('[data-hud]')].map(el => [el.dataset.hud, el]))
const volume = Object.fromEntries([...document.querySelectorAll('[data-volume]')].map(el => [el.dataset.volume, el]))
const meter = document.querySelector('[data-scroll-meter]')
const faces = store.resources.get('liber').faces.length
let fps = 60

// reading scrollHeight forces a layout, so only do it on resize
let scrollRange = 1
const measureScroll = () => { scrollRange = Math.max(document.documentElement.scrollHeight - store.viewport.height, 1) }
measureScroll()
app.events.on(EVENTS.APP_RESIZE, measureScroll)

app.events.on(EVENTS.WEBGL_AFTER_RENDER, ({ delta, frame, scroll }) => {
    if (delta > 0) fps += (1 / delta - fps) * 0.08
    if (meter && !(frame % 4)) meter.textContent = String(Math.round((scroll / scrollRange) * 100)).padStart(3, '0')
    if (frame % 10) return

    const blocks = text.blocks
    const drawn = blocks.filter(b => b.isDrawn)
    const glyphs = drawn.reduce((sum, b) => sum + b.glyphCount, 0).toLocaleString('en')
    const draws = app.gl.info.render.calls

    hud.fps.textContent = Math.round(fps)
    hud.draws.textContent = draws
    hud.blocks.textContent = `${drawn.length} / ${blocks.length}`
    hud.glyphs.textContent = glyphs
    hud.mode.textContent = text.wireframe ? 'wireframe' : 'glyphs'

    // short values: a wrapping one would move the tracked labels beside it without resizing them
    volume.glyphs.textContent = glyphs
    volume.draws.textContent = draws
    volume.faces.textContent = faces
})

/* ───────── Loop: Lenis first, then Keemera, on the gsap ticker ───────── */

gsap.ticker.add((time) => {
    lenis.raf(time * 1000)
    app.tick()
})
gsap.ticker.lagSmoothing(0)

window.keemera = { app, lenis, text }
