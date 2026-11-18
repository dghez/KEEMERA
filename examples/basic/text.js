import { gsap } from 'gsap'
import Lenis from 'lenis'
import { Color, MeshBasicMaterial, ShaderMaterial } from 'three'
import Keemera, { EVENTS, PRIORITY, Shepherd } from '@dghez/keemera'
import { MouseFluid, TextLayer } from '@dghez/keemera/shards'

/* ───────── Options: ?compare, ?wireframe, ?debug ───────── */

const params = new URLSearchParams(window.location.search)

/* ───────── Stress copy: deterministic, about 10k glyphs ───────── */

const WORDS = 'outline curve band glyph pixel winding coverage quadratic browser layout kerning baseline ray texel instance shader scroll measure range font face ink edge sample'.split(' ')
let seed = 7
const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647

const stress = document.querySelector('[data-stress]')
for (let p = 0; p < 24; p++) {
    const words = Array.from({ length: 62 }, () => WORDS[Math.floor(random() * WORDS.length)])
    words[0] = words[0][0].toUpperCase() + words[0].slice(1)
    const el = document.createElement('p')
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
    // baked from examples/assets/fonts with `npm run fonts`
    preload: [
        { key: 'geist', type: 'font', path: '/fonts/geist.kfont' },
        { key: 'turbulence', type: 'texture', path: '/turbulence.jpg' },
    ],
})

lenis.on('scroll', ({ scroll }) => app.setScroll(scroll))
app.setScroll(lenis.scroll)
app.events.on(EVENTS.APP_RESIZE, () => lenis.resize(), PRIORITY.first)

await app.ready

/* ───────── Text layer ───────── */

const text = new TextLayer({ store: app.store, compare: params.has('compare'), wireframe: params.has('wireframe') })

// W toggles the glyph boxes
window.addEventListener('keydown', (e) => {
    if (e.key === 'w' && !e.metaKey && !e.ctrlKey && !e.target.isContentEditable) text.wireframe = !text.wireframe
})
app.scene.add(text)

// any material works: this ShaderMaterial is written as for a plain mesh. `position` and `uv` are the glyph's,
// `uv` spans the whole element; Slug coverage is applied after its main()
const gradient = new ShaderMaterial({
    uniforms: {
        uFrom: { value: new Color('#a3392a') },
        uTo: { value: new Color('#1c1b18') },
    },
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
    transparent: true,
    depthWrite: false,
})

// a built-in material: the DOM color (white here) times material.color
const basic = new MeshBasicMaterial({ color: '#2f5bd3', transparent: true, depthWrite: false })

// does nothing a default material wouldn't: keemeraColor is the DOM color, linear
const passthrough = new ShaderMaterial({
    vertexShader: /* glsl */`
        void main() {
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: /* glsl */`
        void main() {
            gl_FragColor = keemeraColor;
            #include <colorspace_fragment>
        }
    `,
    transparent: true,
    depthWrite: false,
})

// mouse repulsion, shared by the materials below. The store's eased mouse (NDC) and resolution (css px) are
// shared uniforms: nothing to update per frame
const repelUniforms = () => ({
    uMouse: app.store.uniforms.mouse.smooth,
    uResolution: app.store.uniforms.resolution,
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

// every glyph is a quad: paint it with its own UV (red = u, green = v), the glyph on top. Overwriting
// keemeraCoverage keeps the whole rectangle instead of cutting it to the glyph's outline. Repelled letter by letter
const glyphUv = new ShaderMaterial({
    uniforms: repelUniforms(),
    vertexShader: /* glsl */`
        ${repel}

        varying vec2 vGlyphUv;

        void main() {
            vec3 p = position;
            repel(p, keemeraGlyphCenter);
            vGlyphUv = keemeraGlyphUv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
    `,
    fragmentShader: /* glsl */`
        varying vec2 vGlyphUv;

        void main() {
            vec3 color = mix(vec3(vGlyphUv, 0.0), keemeraColor.rgb, keemeraCoverage);
            gl_FragColor = vec4(color, 1.0);
            keemeraCoverage = 1.0;
            #include <colorspace_fragment>
        }
    `,
    transparent: true,
    depthWrite: false,
})

// one material per piece, the only difference is which center it's repelled around
const push = center => new ShaderMaterial({
    uniforms: {
        ...repelUniforms(),
        uColor: { value: new Color('#e2482b') },
    },
    vertexShader: /* glsl */`
        ${repel}

        varying float vShift;

        void main() {
            vec3 p = position;
            // how far it moved, 0–1: drives the color
            vShift = repel(p, ${center});
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
    `,
    fragmentShader: /* glsl */`
        uniform vec3 uColor;

        varying float vShift;

        void main() {
            // the further it's pushed, the more it turns to uColor
            vec3 color = mix(keemeraColor.rgb, uColor, clamp(vShift * 1.5, 0.0, 1.0));
            gl_FragColor = vec4(color, keemeraColor.a);
            #include <colorspace_fragment>
        }
    `,
    transparent: true,
    depthWrite: false,
})

// the mouse fluid as a screen-space texture: its velocity picks a hue, its strength how much of it shows.
// fluid.uniform always holds the current frame; the store's resolution maps gl_FragCoord to screen uv
const fluid = new MouseFluid({
    store: app.store,
    turbulence: { texture: app.resources.get('turbulence'), strength: 1 },
})

const fluidColor = new ShaderMaterial({
    uniforms: {
        uFluid: fluid.uniform,
        uResolution: app.store.uniforms.resolution,
        uAmount: { value: 3 },
    },
    vertexShader: /* glsl */`
        void main() {
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: /* glsl */`
        uniform sampler2D uFluid;
        uniform vec3 uResolution;
        uniform float uAmount;

        void main() {
            vec2 screenUv = gl_FragCoord.xy / (uResolution.xy * uResolution.z);
            vec3 sim = texture(uFluid, screenUv).rgb;
            vec2 velocity = (sim.rg - 0.5) * 2.0;

            // direction of the flow → hue (cosine palette), strength → how much of it
            float angle = atan(velocity.y, velocity.x) / 6.2831853;
            vec3 hue = 0.5 + 0.5 * cos(6.2831853 * (angle + vec3(0.0, 0.33, 0.67)));
            float amount = clamp(sim.b * uAmount, 0.0, 1.0);

            gl_FragColor = vec4(mix(keemeraColor.rgb, hue, amount), keemeraColor.a);
            #include <colorspace_fragment>
        }
    `,
    transparent: true,
    depthWrite: false,
})

const materials = {
    'fluid': fluidColor,
    'basic': basic,
    'passthrough': passthrough,
    'glyph-uv': glyphUv,
    'push-glyph': push('keemeraGlyphCenter'),
    'push-word': push('keemeraWordCenter'),
    'push-line': push('keemeraLineCenter'),
}

document.querySelectorAll('[data-text]').forEach((el) => {
    text.track(el, {
        live: el.dataset.text === 'live',
        material: el.matches('h1') ? gradient : materials[el.dataset.text],
    })
})

const shepherd = new Shepherd()
shepherd.add(fluid)
shepherd.add(text)

app.events.on(EVENTS.APP_TICK, state => shepherd.update(state))
app.events.on(EVENTS.APP_RESIZE, state => shepherd.resize(state))
app.events.on(EVENTS.APP_DESTROY, () => shepherd.destroy())

/* ───────── HUD ───────── */

const hud = document.querySelector('[data-hud]')
let fps = 60

app.events.on(EVENTS.WEBGL_AFTER_RENDER, ({ delta, frame }) => {
    if (delta > 0) fps += (1 / delta - fps) * 0.08
    if (frame % 10) return

    const blocks = text.blocks
    const drawn = blocks.filter(b => b.isDrawn)
    const glyphs = drawn.reduce((sum, b) => sum + b.glyphCount, 0)
    hud.textContent = [
        `fps     ${Math.round(fps)}`,
        `calls   ${app.gl.info.render.calls}`,
        `blocks  ${drawn.length} / ${blocks.length}`,
        `glyphs  ${glyphs}`,
        `W       ${text.wireframe ? 'wireframe' : 'glyphs'}`,
    ].join('\n')
})

/* ───────── Loop: Lenis first, then Keemera, on the gsap ticker ───────── */

gsap.ticker.add((time) => {
    lenis.raf(time * 1000)
    app.tick()
})
gsap.ticker.lagSmoothing(0)

window.keemera = { app, lenis, text }
