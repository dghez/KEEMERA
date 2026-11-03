const scaleFromPoint = /* glsl */ `
#ifndef KEEMERA_SCALE_FROM_POINT
#define KEEMERA_SCALE_FROM_POINT

vec2 scaleFromPoint(vec2 uv, float scale, vec2 point) {
    vec2 scaledUV = (uv - point) * scale + point;
    return scaledUV;
}

#endif
`

export default scaleFromPoint
