import { ShaderMaterial, WebGLRenderTarget, Vector2, Camera } from 'three'
import { EVENTS } from 'keemera'
import { FullscreenQuad } from 'keemera/shards'

import { INK } from './ink'

const vertexShader = /* glsl */ `
    varying vec2 vUv;

    void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
    }
`

const fragmentShader = /* glsl */ `
    ${INK}

    uniform sampler2D tScene;
    uniform float uVelocity;
    uniform float uSmear;
    varying vec2 vUv;

    // the scene is rendered on a transparent target, composite it over paper
    vec3 over(vec4 t) { return t.rgb + PAPER * (1.0 - t.a); }

    void main() {
        vec2 c = vUv - 0.5;
        float av = abs(uVelocity) * uSmear;
        vec2 uv = 0.5 + c * (1.0 - dot(c, c) * av * 0.3);
        vec2 o = vec2(0.0, uVelocity * 0.014 * uSmear);

        // ink runs: keep the darkest of a few vertical taps
        vec3 a = over(texture2D(tScene, uv));
        vec3 b = over(texture2D(tScene, uv + o));
        vec3 d = over(texture2D(tScene, uv + o * 2.0));
        vec3 col = min(a, mix(min(b, d), a, 0.35));

        gl_FragColor = vec4(col, 1.0);
    }
`

// Renders the scene into a target, then draws it to screen through a full-screen shader.
// While the page is still the effect is invisible, so the pass is skipped and the scene draws straight to the canvas.
export default class Post {
    #store
    #target
    #quad
    #camera = new Camera()
    #size = new Vector2()
    #offs = []
    #active = false

    constructor({ store, smear = true }) {
        this.#store = store
        this.#target = new WebGLRenderTarget(1, 1, { samples: 2 })
        this.smear = { value: smear ? 1 : 0 }

        this.#quad = new FullscreenQuad(new ShaderMaterial({
            vertexShader,
            fragmentShader,
            depthTest: false,
            depthWrite: false,
            uniforms: {
                tScene: { value: this.#target.texture },
                uVelocity: store.uniforms.scrollVelocity,
                uSmear: this.smear,
            },
        }))
        this.#quad.frustumCulled = false

        const { events } = store
        this.#offs.push(
            events.on(EVENTS.WEBGL_BEFORE_RENDER, this.#before),
            events.on(EVENTS.WEBGL_AFTER_RENDER, this.#after),
            events.on(EVENTS.APP_RESIZE, this.#resize),
            events.on(EVENTS.APP_DESTROY, () => this.destroy()),
        )

        this.#resize()
    }

    #resize = () => {
        this.#store.renderer.getDrawingBufferSize(this.#size)
        this.#target.setSize(this.#size.x, this.#size.y)
    }

    #before = () => {
        const velocity = Math.abs(this.#store.uniforms.scrollVelocity.value) * this.smear.value
        this.#active = velocity > 0.002
        if (this.#active) this.#store.renderer.setRenderTarget(this.#target)
    }

    #after = () => {
        if (!this.#active) return
        const { renderer } = this.#store
        renderer.setRenderTarget(null)
        renderer.render(this.#quad, this.#camera)
    }

    destroy() {
        this.#offs.forEach(off => off())
        this.#offs = []
        this.#target.dispose()
        this.#quad.material.dispose()
    }
}
