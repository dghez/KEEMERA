// Distortion driven by the MouseFluid texture, exposed as MouseFluid.distortionShader. Renderer agnostic: include
// it in any shader and bind `fluid.distortionUniforms`. A sine color shift driven by the velocity, and a uv offset scaled by it.
// The fluid is in screen uv, y up.
export const distortionShader = /* glsl */ `
  #ifndef KEEMERA_MOUSE_FLUID_DISTORTION
  #define KEEMERA_MOUSE_FLUID_DISTORTION

  uniform sampler2D uMouseFluid;
  uniform vec3 uMouseFluidRgbShift;
  uniform float uMouseFluidRgbShiftFact;
  uniform float uMouseFluidShade;
  uniform float uMouseFluidColorMultiplier;
  uniform float uMouseFluidColorMin;
  uniform float uMouseFluidWeight;
  uniform float uMouseFluidOffset;
  uniform float uMouseFluidOffsetStrength;
  uniform float uMouseFluidColorAmount;
  uniform float uMouseFluidSoftness;
  uniform float uMouseFluidCursorMask;
  uniform float uMouseFluidCursorRadius;
  uniform float uMouseFluidCursorFeather;
  uniform float uMouseFluidCursorSpeed;
  uniform float uMouseFluidBoost;
  // runtime, set by MouseFluid.update()
  uniform vec2 uMouseFluidMouse;
  uniform float uMouseFluidMouseSpeed;
  uniform float uMouseFluidAspect;
  uniform vec2 uMouseFluidTexel;

  // 9 taps, rounds off the hard edge of the brush disc
  vec4 mouseFluidRead(vec2 uv) {
    vec2 o = uMouseFluidTexel * uMouseFluidSoftness;
    vec4 f = texture2D(uMouseFluid, uv) * 4.0;
    f += texture2D(uMouseFluid, uv + vec2(o.x, 0.0)) * 2.0;
    f += texture2D(uMouseFluid, uv - vec2(o.x, 0.0)) * 2.0;
    f += texture2D(uMouseFluid, uv + vec2(0.0, o.y)) * 2.0;
    f += texture2D(uMouseFluid, uv - vec2(0.0, o.y)) * 2.0;
    f += texture2D(uMouseFluid, uv + o);
    f += texture2D(uMouseFluid, uv - o);
    f += texture2D(uMouseFluid, uv + vec2(o.x, -o.y));
    f += texture2D(uMouseFluid, uv + vec2(-o.x, o.y));
    return f / 16.0;
  }

  // uv offset to sample your texture with; color: the color shift to add on top (scaled by colorAmount)
  vec2 mouseFluidDistortion(vec2 uv, out vec3 color) {
    vec4 fluid = mouseFluidRead(uv);

    // CURSOR MASK: pull the field back to still (0.5) around the mouse, sized by the mouse speed like
    // the brush is, so the fresh brush disc doesn't show and slow moves keep their distortion
    vec2 a = vec2(uMouseFluidAspect, 1.0);
    float d = distance(uv * a, uMouseFluidMouse * a);
    float size = smoothstep(0.0, uMouseFluidCursorSpeed, uMouseFluidMouseSpeed);
    float mask = smoothstep(uMouseFluidCursorRadius * size, (uMouseFluidCursorRadius + uMouseFluidCursorFeather) * size, d);
    mask = mix(1.0, mask, uMouseFluidCursorMask * size);
    fluid.rg = mix(vec2(0.5), fluid.rg, mask);
    fluid.b *= mask;

    vec2 vel = (vec2(0.5) - fluid.rg) * 2.0;

    // BOOST: power curve on the velocity length, lifts the weak trails of slow moves
    float mag = length(vel);
    vel *= pow(mag, uMouseFluidBoost) / max(mag, 1e-4);
    float weight = fluid.b * uMouseFluidWeight;

    // COLOR SHIFT. smoothstep(0.4, -0.9, w) written with ordered edges, reversed edges are undefined in GLSL
    vec3 adder = sin((vec3(vel.x + vel.y) * uMouseFluidRgbShift + vec3(5.0) * uMouseFluidRgbShiftFact) * 3.0)
      * (1.0 - smoothstep(-0.9, 0.4, weight))
      * uMouseFluidShade
      * max(abs(vel.x), abs(vel.y))
      * uMouseFluidColorMultiplier;
    adder = clamp(adder, uMouseFluidColorMin, 1000.0);

    // the full color shift drives the offset, colorAmount only sets how much of it is visible
    color = adder * uMouseFluidColorAmount;
    return (fluid.rg - 0.5) * uMouseFluidOffset * length(adder) * uMouseFluidOffsetStrength;
  }

  // shortcut: map sampled with the distortion, color shift added
  vec4 mouseFluidDistort(sampler2D map, vec2 uv) {
    vec3 color;
    vec2 offset = mouseFluidDistortion(uv, color);
    vec4 result = texture2D(map, uv + offset);
    result.rgb += color;
    return result;
  }

  #endif
`
