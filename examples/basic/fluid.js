import { BoxGeometry, Group, Mesh, MeshNormalMaterial } from 'three'
import { EffectComposer, RenderPass, EffectPass, Effect, EffectAttribute } from 'postprocessing'
import Keemera, { EVENTS, Shepherd } from '@dghez/keemera'
import { MouseFluid } from '@dghez/keemera/shards'

// MouseFluid test page: a grid of spinning boxes, distorted in post by the fluid velocity
// ?debug shows the fluid buffer, ?noturbulence turns the turbulence texture off to compare
const params = new URLSearchParams(window.location.search)
const useTurbulence = !params.has('noturbulence')

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
    turbulence: useTurbulence ? { texture: app.resources.get('turbulence'), strength: 1 } : undefined,
})

// port of the AstroDither fluid pass: a sine color shift driven by the velocity, and a uv offset scaled by it
// the fluid is in screen uv y-up like the input buffer, so no flip
const fragmentShader = /* glsl */ `
    uniform sampler2D uFluid;

    const vec3 RGB_SHIFT = vec3(2.1, 2.2, 2.3);
    const float RGB_SHIFT_FACT = 0.5;
    const float SHADE = 1.25;
    const float COLOR_MULTIPLIER = 1.0;

    void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec4 fluid = texture2D(uFluid, uv);

        vec2 vel = (vec2(0.5) - fluid.rg) * 2.0;
        float weight = fluid.b * 0.01;

        // COLOR SHIFT. smoothstep(0.4, -0.9, w) written with ordered edges, reversed edges are undefined in GLSL
        vec3 adder = sin((vec3(vel.x + vel.y) * RGB_SHIFT + vec3(5.0) * RGB_SHIFT_FACT) * 3.0)
            * (1.0 - smoothstep(-0.9, 0.4, weight))
            * SHADE
            * max(abs(vel.x), abs(vel.y))
            * COLOR_MULTIPLIER;
        adder = clamp(adder, -0.2, 1000.0);

        // DISTORTION
        vec2 offset = (fluid.rg - 0.5) * 0.12;
        vec4 color = texture2D(inputBuffer, uv + offset * length(adder) * 5.0);
        color.rgb += adder;

        outputColor = vec4(color.rgb, 1.0);
    }
`

// samples neighbouring pixels, hence CONVOLUTION
class FluidDistortEffect extends Effect {
    constructor() {
        super('FluidDistortEffect', fragmentShader, {
            attributes: EffectAttribute.CONVOLUTION,
            uniforms: new Map([['uFluid', fluid.uniform]]),
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
    boxes.children.forEach((box) => {
        box.rotation.x += state.delta * 0.4
        box.rotation.y += state.delta * 0.6
    })
})
app.events.on(EVENTS.APP_RESIZE, (state) => {
    shepherd.resize(state)
    composer.setSize(state.width, state.height, false)
})
app.events.on(EVENTS.APP_DESTROY, () => {
    shepherd.destroy()
    composer.dispose()
    geometry.dispose()
    material.dispose()
})
app.resize()
