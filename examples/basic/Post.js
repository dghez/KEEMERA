import { LinearSRGBColorSpace } from 'three'
import { EffectComposer, RenderPass, EffectPass, Effect, EffectAttribute } from 'postprocessing'

import { INK } from './ink'

const fragmentShader = /* glsl */ `
    ${INK}

    uniform float uVelocity;
    uniform float uSmear;

    // the scene is rendered on a transparent target, composite it over paper
    vec3 over(vec4 t) { return t.rgb + PAPER * (1.0 - t.a); }

    void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec2 c = uv - 0.5;
        float av = abs(uVelocity) * uSmear;
        vec2 wuv = 0.5 + c * (1.0 - dot(c, c) * av * 0.3);
        vec2 o = vec2(0.0, uVelocity * 0.014 * uSmear);

        // ink runs: keep the darkest of a few vertical taps
        vec3 a = over(texture2D(inputBuffer, wuv));
        vec3 b = over(texture2D(inputBuffer, wuv + o));
        vec3 d = over(texture2D(inputBuffer, wuv + o * 2.0));
        vec3 col = min(a, mix(min(b, d), a, 0.35));

        outputColor = vec4(col, 1.0);
    }
`

// samples neighbouring pixels, hence CONVOLUTION
class InkSmearEffect extends Effect {
    constructor({ velocity, smear }) {
        super('InkSmearEffect', fragmentShader, {
            attributes: EffectAttribute.CONVOLUTION,
            uniforms: new Map([['uVelocity', velocity], ['uSmear', smear]]),
        })
    }
}

// Ink smear while scrolling, built on postprocessing's EffectComposer.
// While the page is still the effect is invisible, so the composer is skipped and the scene draws straight to the canvas.
// render(), resize() and destroy() are wired to the app in main.js.
export default class Post {
    #composer

    constructor({ store, smear = true }) {
        const { gl, scene, camera, uniforms } = store
        this.smear = { value: smear ? 1 : 0 }

        // the page's shaders write raw sRGB with no conversion anywhere; keep postprocessing from encoding again
        gl.outputColorSpace = LinearSRGBColorSpace

        this.#composer = new EffectComposer(gl)
        this.#composer.addPass(new RenderPass(scene, camera))
        this.#composer.addPass(new EffectPass(camera, new InkSmearEffect({ velocity: uniforms.scrollVelocity, smear: this.smear })))
    }

    resize({ width, height }) {
        this.#composer.setSize(width, height, false)
    }

    // passed to app.setRenderFunction(), replaces the default gl.render(scene, camera)
    render = (state, store) => {
        const { gl, scene, camera, uniforms } = store
        const velocity = Math.abs(uniforms.scrollVelocity.value) * this.smear.value

        if (velocity <= 0.002) {
            gl.render(scene, camera)
            return
        }

        this.#composer.render(state.delta)
    }

    destroy() {
        this.#composer.dispose()
    }
}
