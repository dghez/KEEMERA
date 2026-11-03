const aastep = /* glsl */ `
#ifndef KEEMERA_AASTEP
#define KEEMERA_AASTEP

// Kudos to Luigi https://twitter.com/luruke/status/1638489004721991680/photo/1
float aastep(float threshold, float value) {
    float afwidth = length(vec2(dFdx(value), dFdy(value))) * 0.70710678118654757;
    return smoothstep(threshold-afwidth, threshold+afwidth, value);
}

// USAGE
float aaAlpha(float _alpha, vec2 _uv) {
    float alpha = _alpha;
    float cut = 0.001;
    alpha *= aastep(cut, _uv.x);
    alpha *= 1.0 - aastep(1.0 - cut, _uv.x);
    alpha *= aastep(cut, _uv.y);
    alpha *= 1.0 - aastep(1.0 - cut, _uv.y);

    return alpha;
}

#endif
`

export default aastep
