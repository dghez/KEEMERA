import { Mesh, ShaderMaterial, PlaneGeometry, Vector2 } from 'three'
import { gsap } from 'gsap'
import { Tracker } from 'keemera/shards'
import { noise3d } from 'keemera/shaders'

import { INK, localMouse, ease } from './ink'

const GEO = new PlaneGeometry(1, 1, 32, 32)

const VARIANTS = { dither: 0, shield: 1 }

const vertexShader = /* glsl */ `
    uniform float uVelocity;
    uniform float uHover;
    uniform float uReveal;
    uniform vec2 uMouse;
    varying vec2 vUv;

    #define PI 3.141592653589793

    void main() {
        vUv = uv;
        vec3 pos = position;

        // the middle of the plane lags behind while scrolling
        float bend = sin(uv.x * PI);
        pos.y -= bend * uVelocity * 0.08;
        pos.z += bend * abs(uVelocity) * 90.0;

        // bulge under the cursor (z is in css pixels, the mesh is only scaled on x/y)
        pos.z += uHover * smoothstep(0.55, 0.0, length(uv - uMouse)) * 60.0;
        pos.y -= (1.0 - uReveal) * 0.06;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
`

const fragmentShader = /* glsl */ `
    ${noise3d}
    ${INK}

    uniform float uTime;
    uniform float uVelocity;
    uniform float uHover;
    uniform float uReveal;
    uniform vec2 uMouse;
    uniform vec2 uSize;
    varying vec2 vUv;

    // every panel is a plate seen through a lens
    uniform sampler2D tMap;
    uniform vec2 uImageSize;
    uniform float uLensRadius;

    // css "cover", keeping focus (image uv) as centered as the crop allows
    vec2 coverFocus(vec2 uv, vec2 focus) {
        float pa = uSize.x / uSize.y;
        float ia = uImageSize.x / uImageSize.y;
        vec2 scale = pa > ia ? vec2(1.0, ia / pa) : vec2(pa / ia, 1.0);
        vec2 origin = clamp(focus - scale * 0.5, vec2(0.0), 1.0 - scale);
        return origin + uv * scale;
    }

    float luma(vec2 uv) {
        vec3 c = texture2D(tMap, coverFocus(uv, vec2(0.5, 0.62))).rgb;
        return dot(c, vec3(0.299, 0.587, 0.114));
    }

    // the plate outside the lens, printed flat
    vec3 printed(vec2 uv) {
        return mix(INK, PAPER, smoothstep(0.15, 0.85, luma(uv)));
    }

    // lens center (xy, css px) and radius (z): it drifts on its own, the cursor takes it over on hover
    vec3 lens() {
        vec2 idle = vec2(0.5 + sin(uTime * 0.35) * 0.3, 0.5 + cos(uTime * 0.27) * 0.22);
        return vec3(mix(idle, uMouse, uHover) * uSize, uLensRadius * mix(0.85, 1.0, uHover));
    }

    #if VARIANT == 0
    // ordered dithering thresholds, 0..1
    float bayer2(vec2 a) { a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
    float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
    float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }

    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

    vec3 body(vec2 uv) {
        vec2 px = uv * uSize;
        vec3 L = lens();
        vec2 c = L.xy;
        float R = L.z;
        float d = length(px - c);
        float k = clamp(d / R, 0.0, 1.0);

        vec3 col = printed(uv);
        // nothing below reaches past the dotted ring
        if (d > R + 9.0) return col;

        // inside: magnified and 1-bit, cells get chunkier toward the rim
        float cell = 2.0 + floor(k * 3.0);
        vec2 id = floor(px / cell);
        vec2 cpx = (id + 0.5) * cell;
        float mag = 1.8 - k * k * 0.6;
        float l = smoothstep(0.1, 0.9, luma((c + (cpx - c) / mag) / uSize));
        float on = step(l, bayer8(id));
        vec3 ink = mix(INK, RUBRIC, smoothstep(0.7, 0.95, k));

        // a few small red spots drifting through the ink, flickering cell by cell
        float spot = smoothstep(0.72, 0.8, snoise(vec3(cpx * 0.035, uTime * 0.5)));
        spot *= step(0.35, hash(id + floor(uTime * 10.0)));
        ink = mix(ink, RUBRIC, spot);

        float inside = 1.0 - smoothstep(R - 1.0, R + 1.0, d);
        col = mix(col, mix(PAPER, ink, on), inside);

        // ink rim, dotted rubric ring outside it
        float rim = 1.0 - smoothstep(0.75, 1.5, abs(d - R));
        float ang = atan(px.y - c.y, px.x - c.x);
        float dots = step(0.5, fract(ang * (R + 7.0) / 6.0));
        float ring = (1.0 - smoothstep(0.75, 1.5, abs(d - R - 7.0))) * dots;
        col = mix(col, INK, rim);
        return mix(col, RUBRIC, ring * uHover);
    }
    #else
    vec3 body(vec2 uv) {
        vec2 px = uv * uSize;
        vec3 L = lens();
        vec2 c = L.xy;
        float R = L.z;
        vec2 dir = px - c;
        float d = length(dir);
        float k = clamp(d / R, 0.0, 1.0);

        vec3 col = printed(uv);
        if (d > R + 2.0) return col;

        // water rings travelling out from the center, calmer toward the rim
        float wave = sin(d * 0.11 - uTime * 2.4) * smoothstep(1.0, 0.2, k);
        vec2 radial = dir / max(d, 0.0001);

        // the shield shows her slightly magnified and shaken by the water
        vec2 m = dir / 1.15 + radial * wave * 3.0;
        float dark = smoothstep(0.85, 0.15, luma((c + m) / uSize));

        // banknote engraving: horizontal lines, the darker the image the wider the line,
        // bowed by the convex shield and bent by the rings
        float spacing = 4.0;
        float v = (dir.y * (1.0 + 0.3 * k * k) + wave * 2.5) / spacing;
        float dist = 0.5 - abs(fract(v) - 0.5);
        float w = mix(0.06, 0.5, dark);
        float fw = fwidth(v);
        float line = 1.0 - smoothstep(w - fw, w + fw, dist);
        vec3 shield = mix(PAPER, RUBRIC, line);

        // rim: red ticks between two ink rules, like studs around the shield
        float ang = atan(dir.y, dir.x);
        float band = smoothstep(R - 7.0, R - 6.0, d) * (1.0 - smoothstep(R - 1.5, R - 0.5, d));
        float ticks = step(0.55, fract(ang * R / 5.0));
        shield = mix(shield, mix(PAPER, RUBRIC, ticks), band);

        float inside = 1.0 - smoothstep(R - 1.0, R + 1.0, d);
        col = mix(col, shield, inside);

        float rules = max(1.0 - smoothstep(0.75, 1.5, abs(d - R)), 1.0 - smoothstep(0.5, 1.2, abs(d - R + 7.0)));
        return mix(col, INK, rules);
    }
    #endif

    void main() {
        vec2 uv = (vUv - 0.5) * (0.85 + 0.15 * uReveal) + 0.5;
        vec3 color = body(uv);

        vec3 rv = revealLines(vUv * uSize, vUv, uReveal);
        color = mix(color, mix(RUBRIC, INK, rv.z), rv.x);
        gl_FragColor = vec4(color, max(rv.y, rv.x));
    }
`

export default class Panel extends Tracker {
    #store
    #revealed = false
    #hover = 0

    constructor({ store, tracker } = {}) {
        super({ store, tracker, preventUpdateScale: false })
        this.#store = store

        // optional image, by resource key: data-keemera-texture="<key>"
        const { keemeraTexture } = this.el.dataset
        const texture = keemeraTexture ? store.resources.get(keemeraTexture) : null

        this.material = new ShaderMaterial({
            vertexShader,
            fragmentShader,
            transparent: true,
            depthWrite: false,
            defines: { VARIANT: VARIANTS[this.el.dataset.keemeraVariant] ?? 0 },
            uniforms: {
                uTime: store.uniforms.time,
                uVelocity: store.uniforms.scrollVelocity,
                uHover: { value: 0 },
                uReveal: { value: 0 },
                uMouse: { value: new Vector2(0.5, 0.5) },
                uSize: { value: new Vector2(this.trackSize.w, this.trackSize.h) },
                tMap: { value: texture },
                uImageSize: { value: new Vector2(texture?.image?.width ?? 1, texture?.image?.height ?? 1) },
                uLensRadius: store.uniforms.lensRadius,
            },
        })

        this.mesh = new Mesh(GEO, this.material)
        this.add(this.mesh)
    }

    resize() {
        super.resize()
        this.material?.uniforms.uSize.value.set(this.trackSize.w, this.trackSize.h)
    }

    update(state) {
        super.update(state)
        const { uniforms } = this.material
        const { mx, my, inside, top } = localMouse(this, this.#store)

        if (!this.#revealed && top < this.#store.viewport.height * 0.85) {
            this.#revealed = true
            gsap.to(uniforms.uReveal, { value: 1, duration: 2.6, ease: 'power1.inOut' })
        }

        uniforms.uMouse.value.set(mx, my)
        this.#hover = ease(this.#hover, inside ? 1 : 0, state.delta, 6)
        uniforms.uHover.value = this.#hover
    }

    destroy() {
        super.destroy()
        this.material?.dispose()
    }
}
