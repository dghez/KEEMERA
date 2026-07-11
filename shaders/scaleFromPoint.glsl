vec2 scaleFromPoint(vec2 uv, float scale, vec2 point) {
    vec2 scaledUV = (uv - point) * scale + point;
    return scaledUV;
}
