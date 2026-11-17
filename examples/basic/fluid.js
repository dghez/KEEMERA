import { BoxGeometry, Group, Mesh, MeshNormalMaterial } from 'three'
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

// the library only ships the GLSL and its uniforms: wrap them in whatever needs them, here a postprocessing Effect.
// samples neighbouring pixels, hence CONVOLUTION
class FluidDistortEffect extends Effect {
    constructor() {
        super('FluidDistortEffect', /* glsl */ `
            ${MouseFluid.distortionShader}

            void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
                outputColor = vec4(mouseFluidDistort(inputBuffer, uv).rgb, 1.0);
            }
        `, {
            attributes: EffectAttribute.CONVOLUTION,
            uniforms: new Map(Object.entries(fluid.distortionUniforms)),
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

/* ───────── Tuning panel (always on; ?debug adds the fluid buffer view) ───────── */

const { default: GUI } = await import('lil-gui')
const gui = new GUI({ title: 'MouseFluid' })
const { settings, distortion } = fluid

// SIMULATION
const sim = gui.addFolder('Simulation')
sim.add(fluid, 'resolution', 0.05, 0.5, 0.005)
sim.add(fluid, 'blurKernelSize', 3, 151, 2) // odd only: step 2 from 3
sim.add(fluid, 'blurIterations', 1, 6, 1)
sim.add(settings.radius, 'value', 0, 0.2, 0.001).name('radius')
sim.add(settings.shapeVelocity, 'value', 0, 50, 0.1).name('shapeVelocity')
sim.add(settings.shapeStrength, 'value', 0, 100, 0.1).name('shapeStrength')
sim.add(settings.paint, 'value', 0, 300, 1).name('paint')
sim.add(settings.advection, 'value', 0, 0.1, 0.0005).name('advection')
sim.add(settings.velocityFade, 'value', 0.8, 1, 0.001).name('velocityFade')
sim.add(settings.strengthFade, 'value', 0.5, 1, 0.001).name('strengthFade')

const turbulence = sim.addFolder('Turbulence')
turbulence.add(settings.turbulenceStrength, 'value', 0, 5, 0.01).name('strength')
turbulence.add(settings.turbulenceJitter, 'value', 0, 0.1, 0.001).name('jitter')
turbulence.add(settings.turbulenceJitterScale, 'value', 0, 3, 0.01).name('jitterScale')
turbulence.add(settings.turbulencePush, 'value', 0, 5, 0.01).name('push')
turbulence.add(settings.turbulencePushScale, 'value', 0.1, 200, 0.1).name('pushScale')
turbulence.add(settings.turbulenceSpeed, 'value', 0, 1, 0.001).name('speed')
turbulence.add(settings.turbulenceCurlStep, 'value', 0.001, 0.1, 0.001).name('curlStep')

// DISTORTION
const post = gui.addFolder('Distortion')
post.add(distortion.rgbShift.value, 'x', 0, 10, 0.01).name('rgbShift r')
post.add(distortion.rgbShift.value, 'y', 0, 10, 0.01).name('rgbShift g')
post.add(distortion.rgbShift.value, 'z', 0, 10, 0.01).name('rgbShift b')
post.add(distortion.rgbShiftFact, 'value', 0, 2, 0.01).name('rgbShiftFact')
post.add(distortion.shade, 'value', 0, 5, 0.01).name('shade')
post.add(distortion.colorMultiplier, 'value', 0, 5, 0.01).name('colorMultiplier')
post.add(distortion.colorMin, 'value', -1, 0, 0.01).name('colorMin')
post.add(distortion.colorAmount, 'value', 0, 1, 0.01).name('colorAmount')
post.add(distortion.weight, 'value', 0, 1, 0.001).name('weight')
post.add(distortion.offset, 'value', 0, 0.5, 0.001).name('offset')
post.add(distortion.offsetStrength, 'value', 0, 100, 0.1).name('offsetStrength')
post.add(distortion.boost, 'value', 0.1, 1.5, 0.01).name('boost')

const cursor = post.addFolder('Cursor')
cursor.add(distortion.softness, 'value', 0, 8, 0.1).name('softness')
cursor.add(distortion.cursorMask, 'value', 0, 1, 0.01).name('mask')
cursor.add(distortion.cursorRadius, 'value', 0, 0.3, 0.001).name('radius')
cursor.add(distortion.cursorFeather, 'value', 0, 0.5, 0.001).name('feather')
cursor.add(distortion.cursorSpeed, 'value', 0.001, 0.2, 0.001).name('speed')

// dump the current values, to port them to the library defaults
const toValues = uniforms => Object.fromEntries(
    Object.entries(uniforms).map(([key, { value }]) => [key, value.isVector3 ? value.toArray() : value]),
)
gui.add({
    copy() {
        const dump = JSON.stringify({
            simulation: { resolution: fluid.resolution, blurKernelSize: fluid.blurKernelSize, blurIterations: fluid.blurIterations, ...toValues(settings) },
            distortion: toValues(distortion),
        }, null, 4)
        console.log(dump)
        navigator.clipboard?.writeText(dump).catch(() => {})
    },
}, 'copy').name('Copy values')
gui.add(gui, 'reset').name('Reset')
