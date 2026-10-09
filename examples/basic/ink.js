// ink palette, raw sRGB (no colorspace conversion anywhere in the chain)
export const INK = /* glsl */ `
    const vec3 PAPER = vec3(0.949, 0.941, 0.918);
    const vec3 INK = vec3(0.110, 0.106, 0.094);
    const vec3 RUBRIC = vec3(0.639, 0.224, 0.165);

    // engraved line set: px in css pixels, darkness 0..1 sets the line width
    float hatch(vec2 px, float angle, float spacing, float darkness) {
        float v = dot(px, vec2(cos(angle), sin(angle))) / spacing;
        float d = min(fract(v), 1.0 - fract(v));
        float w = clamp(darkness, 0.0, 1.0) * 0.5;
        float fw = fwidth(v);
        return (1.0 - smoothstep(w - fw, w + fw, d)) * step(0.02, darkness);
    }

    // engraver's reveal: each scanline is drawn dotted -> dashed -> solid,
    // then the line swells until the image fills the gap. x: line ink, y: content, z: line progress
    vec3 revealLines(vec2 px, vec2 uv, float p) {
        float spacing = 6.0;
        float row = floor(px.y / spacing);
        float dist = abs(fract(px.y / spacing) - 0.5) * spacing;
        float rnd = fract(sin(row * 12.9898) * 43758.5453);
        float stagger = (1.0 - uv.y) * 0.5 + rnd * 0.15;
        float t = p * 1.65 - stagger;
        float lp = clamp(t / 0.6, 0.0, 1.0);
        float cp = clamp((t - 0.6) / 0.4, 0.0, 1.0);
        float period = mix(9.0, 14.0, rnd);
        float fx = fract((px.x + rnd * 40.0) / period);
        float dash = mix(0.1, 1.05, lp * lp);
        float onX = step(fx, dash) * step(0.001, lp);
        float onY = 1.0 - smoothstep(0.5, 1.1, dist);
        float line = onX * onY * (1.0 - cp);
        float content = 1.0 - smoothstep(cp * 3.2, cp * 3.2 + 0.8, dist);
        content *= step(0.001, cp);
        return vec3(line, content, lp);
    }
`

export const flatVertex = /* glsl */ `
    varying vec2 vUv;

    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`

// cursor in the tracker's local uv, plus whether it's inside
export function localMouse(tracker, store) {
    const { height } = store.viewport
    const { w, h } = tracker.trackSize
    const top = height * 0.5 - tracker.trackPosition.y - h * 0.5
    const { viewportSmooth } = store.mouse
    const mx = (viewportSmooth.x - tracker.rect.left) / w
    const my = 1 - (viewportSmooth.y - top) / h
    const inside = !store.viewport.isTouch && mx > 0 && mx < 1 && my > 0 && my < 1
    return { mx, my, inside, top }
}

// frame-rate independent lerp
export const ease = (cur, target, delta, k) => cur + (target - cur) * (1 - Math.exp(-delta * k))
