import { Mesh, ShaderMaterial, PlaneGeometry, Vector2 } from 'three'
import { Tracker } from 'keemera/shards'
import { noise3d } from 'keemera/shaders'

import { INK, flatVertex, localMouse, ease } from './ink'

// lens radius, as a fraction of the plate height
const LENS = 0.2

const fragmentShader = /* glsl */ `
    ${noise3d}
    ${INK}

    uniform sampler2D tMap;
    uniform float uTime;
    uniform float uVelocity;
    uniform float uIntro;
    uniform float uHover;
    uniform vec2 uMouse;
    uniform vec2 uSize;
    uniform float uLensRadius;
    varying vec2 vUv;

    void main() {
        // distance to the cursor, in css pixels
        float d = length((vUv - uMouse) * uSize);
        float lens = smoothstep(uLensRadius * 1.2, uLensRadius * 0.8, d) * uHover;

        vec2 uv = vUv;
        uv.x += sin(uv.y * 14.0 + uTime * 2.0) * uVelocity * 0.012;
        uv = mix(uv, uMouse + (uv - uMouse) * 0.82, lens);

        vec3 img = texture2D(tMap, uv).rgb;
        float dark = 1.0 - dot(img, vec3(0.299, 0.587, 0.114));
        vec3 base = mix(PAPER, INK, smoothstep(0.04, 0.9, dark));

        // under the lens the plate is re-engraved in rubric
        vec2 px = vUv * uSize;
        float h = max(
            hatch(px, 0.785, 5.0, smoothstep(0.08, 0.9, dark) * 0.9),
            hatch(px, -0.785, 5.0, smoothstep(0.45, 1.0, dark) * 0.9)
        );
        vec3 engraved = mix(PAPER, RUBRIC, h);
        vec3 col = mix(base, engraved, lens);

        float ring = 1.0 - smoothstep(0.0, 2.5, abs(d - uLensRadius));
        col = mix(col, RUBRIC, ring * uHover);

        vec3 rv = revealLines(px, vUv, uIntro);
        col = mix(PAPER, col, rv.y);
        col = mix(col, mix(RUBRIC, INK, rv.z), rv.x);

        gl_FragColor = vec4(col, 1.0);
    }
`

export default class HeroPlate extends Tracker {
    #store
    #hover = 0

    constructor({ store, tracker, texture } = {}) {
        super({ store, tracker, preventUpdateScale: false })
        this.#store = store

        this.material = new ShaderMaterial({
            vertexShader: flatVertex,
            fragmentShader,
            uniforms: {
                tMap: { value: texture },
                uTime: store.uniforms.time,
                uVelocity: store.uniforms.scrollVelocity,
                uIntro: { value: 0 },
                uHover: { value: 0 },
                uMouse: { value: new Vector2(0.5, 0.5) },
                uSize: { value: new Vector2(this.trackSize.w, this.trackSize.h) },
                uLensRadius: store.uniforms.lensRadius,
            },
        })

        this.mesh = new Mesh(new PlaneGeometry(), this.material)
        this.add(this.mesh)
    }

    get intro() {
        return this.material.uniforms.uIntro
    }

    resize() {
        super.resize()
        this.material?.uniforms.uSize.value.set(this.trackSize.w, this.trackSize.h)
        // the hero sets the lens size every other lens matches
        this.#store.uniforms.lensRadius.value = this.trackSize.h * LENS
    }

    update(state) {
        super.update(state)
        const { mx, my, inside } = localMouse(this, this.#store)
        const { uniforms } = this.material
        uniforms.uMouse.value.set(mx, my)
        this.#hover = ease(this.#hover, inside ? 1 : 0, state.delta, 6)
        uniforms.uHover.value = this.#hover
    }

    destroy() {
        super.destroy()
        this.mesh.geometry.dispose()
        this.material.dispose()
    }
}
