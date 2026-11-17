import { BoxGeometry, Group, Mesh, MeshNormalMaterial, Vector2, Vector3 } from 'three'
import { EffectComposer, RenderPass, EffectPass, Effect, EffectAttribute } from 'postprocessing'
import Keemera, { EVENTS, Shepherd } from '@dghez/keemera'
import { MouseFluid } from '@dghez/keemera/shards'

// MouseFluid test page: a grid of spinning boxes, distorted in post by the fluid velocity
// ?debug shows the fluid buffer
const params = new URLSearchParams(window.location.search)

const wrapper = document.querySelector('[data-gl]')
const app = new Keemera({
    wrapper,
    canvas: wrapper.querySelector('canvas'),
    debug: params.has('debug'),
    camera: { useDomSize: true },
    // from examples/assets (vite publicDir)
    preload: [{ key: 'turbulence', type: 'texture', path: '/turbulence.jpg' }],
})

await app.ready

const { store } = app

/* ───────── Scene: boxes in css px ───────── */

const SIZE = 90
const GAP = 160
const geometry = new BoxGeometry(SIZE, SIZE, SIZE)
const material = new MeshNormalMaterial()
const boxes = new Group()

for (let x = -4; x <= 4; x++) {
    for (let y = -2; y <= 2; y++) {
        const box = new Mesh(geometry, material)
        box.position.set(x * GAP, y * GAP, 0)
        box.rotation.set(x * 0.3, y * 0.3, 0)
        boxes.add(box)
    }
}
app.scene.add(boxes)

/* ───────── Fluid + post ───────── */

const fluid = new MouseFluid({
    store,
    turbulence: { texture: app.resources.get('turbulence'), strength: 1 },
})

// post settings, live: tweak them from the ?debug panel
const post = {
    rgbShift: { value: new Vector3(2.1, 2.2, 2.3) }, // per channel frequency of the color bands
    rgbShiftFact: { value: 0.5 }, // phase of the color bands
    shade: { value: 1.25 },
    colorMultiplier: { value: 1 },
    colorMin: { value: -0.2 }, // lowest color shift (negative darkens)
    weight: { value: 0.01 }, // fluid strength (b) that fades the color shift out
    offset: { value: 0.12 }, // uv offset per unit of velocity
    offsetStrength: { value: 5 }, // offset scaled by the color shift length
    colorAmount: { value: 1 }, // visible color shift: 0 = distortion only
    // the brush paints a hard, saturated disc: soften it and fade it out under the cursor so only the trail distorts
    softness: { value: 1.1 }, // fluid read spread, in fluid texels
    cursorMask: { value: 1 }, // 0 = off, 1 = full fade under the cursor
    cursorRadius: { value: 0.03 }, // uv, inner radius fully masked
    cursorFeather: { value: 0.12 }, // uv, fade width outside the radius
    cursorSpeed: { value: 0.03 }, // mouse speed (ndc per frame) at which the mask reaches full size; slow moves barely mask
    boost: { value: 0.6 }, // velocity response curve: 1 = linear, < 1 lifts the small velocities of slow moves
}
// runtime, not tunable
const mouseUv = { value: new Vector2() }
const mouseSpeed = { value: 0 }
const prevMouse = new Vector2()
const aspect = { value: 1 }
const fluidTexel = { value: new Vector2() }

// port of the AstroDither fluid pass: a sine color shift driven by the velocity, and a uv offset scaled by it
// the fluid is in screen uv y-up like the input buffer, so no flip
const fragmentShader = /* glsl */ `
    uniform sampler2D uFluid;
    uniform vec3 uRgbShift;
    uniform float uRgbShiftFact;
    uniform float uShade;
    uniform float uColorMultiplier;
    uniform float uColorMin;
    uniform float uWeight;
    uniform float uOffset;
    uniform float uOffsetStrength;
    uniform float uColorAmount;
    uniform float uSoftness;
    uniform float uCursorMask;
    uniform float uCursorRadius;
    uniform float uCursorFeather;
    uniform float uCursorSpeed;
    uniform float uMouseSpeed;
    uniform float uBoost;
    uniform vec2 uMouse;
    uniform float uAspect;
    uniform vec2 uFluidTexel;

    // 9 taps, rounds off the hard edge of the brush disc
    vec4 readFluid(vec2 uv) {
        vec2 o = uFluidTexel * uSoftness;
        vec4 f = texture2D(uFluid, uv) * 4.0;
        f += texture2D(uFluid, uv + vec2(o.x, 0.0)) * 2.0;
        f += texture2D(uFluid, uv - vec2(o.x, 0.0)) * 2.0;
        f += texture2D(uFluid, uv + vec2(0.0, o.y)) * 2.0;
        f += texture2D(uFluid, uv - vec2(0.0, o.y)) * 2.0;
        f += texture2D(uFluid, uv + o);
        f += texture2D(uFluid, uv - o);
        f += texture2D(uFluid, uv + vec2(o.x, -o.y));
        f += texture2D(uFluid, uv + vec2(-o.x, o.y));
        return f / 16.0;
    }

    void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec4 fluid = readFluid(uv);

        // CURSOR MASK: pull the field back to still (0.5) around the mouse
        // sized by the mouse speed like the brush is, so slow moves keep their distortion
        vec2 a = vec2(uAspect, 1.0);
        float d = distance(uv * a, uMouse * a);
        float size = smoothstep(0.0, uCursorSpeed, uMouseSpeed);
        float mask = smoothstep(uCursorRadius * size, (uCursorRadius + uCursorFeather) * size, d);
        mask = mix(1.0, mask, uCursorMask * size);
        fluid.rg = mix(vec2(0.5), fluid.rg, mask);
        fluid.b *= mask;

        vec2 vel = (vec2(0.5) - fluid.rg) * 2.0;

        // BOOST: power curve on the velocity length, lifts the weak trails of slow moves
        float mag = length(vel);
        vel *= pow(mag, uBoost) / max(mag, 1e-4);
        float weight = fluid.b * uWeight;

        // COLOR SHIFT. smoothstep(0.4, -0.9, w) written with ordered edges, reversed edges are undefined in GLSL
        vec3 adder = sin((vec3(vel.x + vel.y) * uRgbShift + vec3(5.0) * uRgbShiftFact) * 3.0)
            * (1.0 - smoothstep(-0.9, 0.4, weight))
            * uShade
            * max(abs(vel.x), abs(vel.y))
            * uColorMultiplier;
        adder = clamp(adder, uColorMin, 1000.0);

        // DISTORTION
        vec2 offset = (fluid.rg - 0.5) * uOffset;
        vec4 color = texture2D(inputBuffer, uv + offset * length(adder) * uOffsetStrength);
        // the color shift still drives the distortion above, this only controls how much of it is visible
        color.rgb += adder * uColorAmount;

        outputColor = vec4(color.rgb, 1.0);
    }
`

// samples neighbouring pixels, hence CONVOLUTION
class FluidDistortEffect extends Effect {
    constructor() {
        super('FluidDistortEffect', fragmentShader, {
            attributes: EffectAttribute.CONVOLUTION,
            uniforms: new Map([
                ['uFluid', fluid.uniform],
                ['uRgbShift', post.rgbShift],
                ['uRgbShiftFact', post.rgbShiftFact],
                ['uShade', post.shade],
                ['uColorMultiplier', post.colorMultiplier],
                ['uColorMin', post.colorMin],
                ['uWeight', post.weight],
                ['uOffset', post.offset],
                ['uOffsetStrength', post.offsetStrength],
                ['uColorAmount', post.colorAmount],
                ['uSoftness', post.softness],
                ['uCursorMask', post.cursorMask],
                ['uCursorRadius', post.cursorRadius],
                ['uCursorFeather', post.cursorFeather],
                ['uCursorSpeed', post.cursorSpeed],
                ['uBoost', post.boost],
                ['uMouseSpeed', mouseSpeed],
                ['uMouse', mouseUv],
                ['uAspect', aspect],
                ['uFluidTexel', fluidTexel],
            ]),
        })
    }
}

const composer = new EffectComposer(store.gl)
composer.addPass(new RenderPass(store.scene, store.camera))
composer.addPass(new EffectPass(store.camera, new FluidDistortEffect()))

app.setRenderFunction(state => composer.render(state.delta))

/* ───────── Lifecycle ───────── */

// the fluid updates on APP_TICK, before the render reads it
const shepherd = new Shepherd()
shepherd.add(fluid)

app.events.on(EVENTS.APP_TICK, (state) => {
    shepherd.update(state)
    // same smoothed mouse the fluid brush uses, NDC to uv
    const { smooth } = store.mouse
    mouseUv.value.set((smooth.x + 1) * 0.5, (smooth.y + 1) * 0.5)
    // eased, so the mask doesn't pop on frame to frame speed noise
    mouseSpeed.value += (smooth.distanceTo(prevMouse) - mouseSpeed.value) * 0.2
    prevMouse.copy(smooth)
    const { width, height } = fluid.texture.image
    fluidTexel.value.set(1 / width, 1 / height)
    boxes.children.forEach((box) => {
        box.rotation.x += state.delta * 0.4
        box.rotation.y += state.delta * 0.6
    })
})
app.events.on(EVENTS.APP_RESIZE, (state) => {
    shepherd.resize(state)
    aspect.value = state.width / state.height
    composer.setSize(state.width, state.height, false)
})
app.events.on(EVENTS.APP_DESTROY, () => {
    shepherd.destroy()
    composer.dispose()
    geometry.dispose()
    material.dispose()
})
app.resize()

/* ───────── Tuning panel (always on; ?debug adds the fluid buffer view) ───────── */

const { default: GUI } = await import('lil-gui')
const gui = new GUI({ title: 'MouseFluid' })

// plain object views over the uniforms, so lil-gui can bind them
const bind = (folder, uniforms, specs) => {
    for (const [key, [min, max, step]] of Object.entries(specs)) {
        folder.add(uniforms[key], 'value', min, max, step).name(key)
    }
}

const sim = gui.addFolder('Simulation')
sim.add(fluid, 'resolution', 0.05, 0.5, 0.005)
// the kernel must be odd
const blur = { kernelSize: fluid.blurKernelSize }
const kernel = sim.add(blur, 'kernelSize', 3, 151, 1).name('blurKernelSize').onChange((v) => {
    blur.kernelSize = Math.max(3, Math.round(v) | 1)
    fluid.blurKernelSize = blur.kernelSize
    kernel.updateDisplay()
})
sim.add(fluid, 'blurIterations', 1, 6, 1)
bind(sim, fluid.settings, {
    radius: [0, 0.2, 0.001],
    shapeVelocity: [0, 50, 0.1],
    shapeStrength: [0, 100, 0.1],
    paint: [0, 300, 1],
    advection: [0, 0.1, 0.0005],
    velocityFade: [0.8, 1, 0.001],
    strengthFade: [0.5, 1, 0.001],
})
const turb = sim.addFolder('Turbulence')
bind(turb, fluid.settings, {
    turbulenceStrength: [0, 5, 0.01],
    turbulenceJitter: [0, 0.1, 0.001],
    turbulenceJitterScale: [0, 3, 0.01],
    turbulencePush: [0, 5, 0.01],
    turbulencePushScale: [0.1, 200, 0.1],
    turbulenceSpeed: [0, 1, 0.001],
    turbulenceCurlStep: [0.001, 0.1, 0.001],
})

const pp = gui.addFolder('Post-processing')
const rgb = pp.addFolder('rgbShift')
rgb.add(post.rgbShift.value, 'x', 0, 10, 0.01).name('r')
rgb.add(post.rgbShift.value, 'y', 0, 10, 0.01).name('g')
rgb.add(post.rgbShift.value, 'z', 0, 10, 0.01).name('b')
bind(pp, post, {
    rgbShiftFact: [0, 2, 0.01],
    shade: [0, 5, 0.01],
    colorMultiplier: [0, 5, 0.01],
    colorMin: [-1, 0, 0.01],
    weight: [0, 1, 0.001],
    offset: [0, 0.5, 0.001],
    offsetStrength: [0, 100, 0.1],
    colorAmount: [0, 1, 0.01],
})
const cursor = pp.addFolder('Cursor')
bind(cursor, post, {
    softness: [0, 8, 0.1],
    cursorMask: [0, 1, 0.01],
    cursorRadius: [0, 0.3, 0.001],
    cursorFeather: [0, 0.5, 0.001],
    cursorSpeed: [0.001, 0.2, 0.001],
})
bind(pp, post, { boost: [0.1, 1.5, 0.01] })

// dump the current values, to port them to the library defaults
gui.add({
    copy: () => {
        const values = (uniforms) => Object.fromEntries(Object.entries(uniforms).map(([k, u]) => [k, u.value.isVector3 ? u.value.toArray() : u.value]))
        const dump = JSON.stringify({
            simulation: { resolution: fluid.resolution, blurKernelSize: fluid.blurKernelSize, blurIterations: fluid.blurIterations, ...values(fluid.settings) },
            post: values(post), // includes the cursor mask
        }, null, 4)
        console.log(dump)
        navigator.clipboard?.writeText(dump).catch(() => {})
    },
}, 'copy').name('Copy values')
gui.add(gui, 'reset').name('Reset')
