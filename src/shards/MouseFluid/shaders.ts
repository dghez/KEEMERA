export const vertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`

export const fragmentShader = /* glsl */ `
  #define saturate(x) clamp(x, 0.0, 1.0)

  uniform sampler2D uPrev;
  uniform sampler2D uBlurred;
  uniform vec2 uMouse;
  uniform vec2 uSpeed;
  uniform vec2 uNormalizedSpeed;
  uniform vec3 uResolution;
  uniform bool uReset;

  // settings, see MouseFluid.settings
  uniform float uRadius;
  uniform float uShapeVelocity;
  uniform float uShapeStrength;
  uniform float uPaint;
  uniform float uAdvection;
  uniform float uVelocityFade;
  uniform float uStrengthFade;

  #ifdef USE_TURBULENCE
    uniform sampler2D uTurbulence;
    uniform float uTurbulenceStrength;
    uniform float uTurbulenceJitter;
    uniform float uTurbulenceJitterScale;
    uniform float uTurbulencePush;
    uniform float uTurbulencePushScale;
    uniform float uTurbulenceSpeed;
    uniform float uTurbulenceCurlStep;
    uniform float uTime;
  #endif

  varying vec2 vUv;

  void main() {
    // NEUTRAL BUFFER: no velocity (rg 0.5), no strength (b 0)
    if (uReset) {
      gl_FragColor = vec4(0.5, 0.5, 0.0, 1.0);
      return;
    }

    vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);

    // RADIUS
    float rad = pow(smoothstep(0.0, 0.2, length(uSpeed)), 0.85);
    rad = clamp(rad, 0.0, uRadius) * 2.0;

    // MASKS
    float dist = distance(vUv * aspect, uMouse * aspect);
    float sm = 1.0 - smoothstep(rad * 0.2, rad, dist);
    float m = 1.0 - step(rad, dist);

    // MOUSE SHAPE
    float baseStrength = length(uSpeed);
    vec2 shapeVelocity = mix(vec2(0.0), uNormalizedSpeed * uShapeVelocity, m);
    vec3 mouseShape = vec3(shapeVelocity * 0.5 + 0.5, saturate(baseStrength * m * uShapeStrength));

    // BLURRED VELOCITY
    vec2 blurredUv = vUv;
    #ifdef USE_TURBULENCE
      // jitter the blurred read, fine scale. difference of two far apart reads: zero mean whatever the
      // texture brightness, a plain rg - 0.5 shifts everything diagonally when the noise isn't centered
      vec2 juv = vUv * aspect * uTurbulenceJitterScale + uTime * uTurbulenceSpeed * vec2(0.13, 0.07);
      vec2 jitter = texture2D(uTurbulence, juv).rg - texture2D(uTurbulence, juv + vec2(0.5, 0.37)).rg;
      blurredUv += jitter * uTurbulenceJitter * uTurbulenceStrength;
    #endif
    vec4 blurred = texture2D(uBlurred, blurredUv);
    vec2 velocityInverse = (vec2(0.5) - blurred.rg) * 2.0;
    vec2 direction = velocityInverse * uAdvection;

    #ifdef USE_TURBULENCE
      // push the advection around, more where the fluid is strong
      // curl of the noise: swirls rather than a drift, zero mean, scrolled over time so the eddies keep changing
      vec2 tuv = vUv * aspect * uTurbulencePushScale - uTime * uTurbulenceSpeed * vec2(0.07, 0.11);
      float e = uTurbulenceCurlStep;
      float ny1 = texture2D(uTurbulence, tuv + vec2(0.0, e)).r;
      float ny0 = texture2D(uTurbulence, tuv - vec2(0.0, e)).r;
      float nx1 = texture2D(uTurbulence, tuv + vec2(e, 0.0)).r;
      float nx0 = texture2D(uTurbulence, tuv - vec2(e, 0.0)).r;
      vec2 curl = vec2(ny1 - ny0, nx0 - nx1);
      direction += curl * uTurbulencePush * blurred.b * uTurbulenceStrength;
    #endif

    // ADVECTION
    vec4 advected = texture2D(uPrev, vUv + direction);
    advected.rg -= 0.5;
    advected.rg *= uVelocityFade;
    if (abs(advected.b) < 0.0001) advected.rg = vec2(0.0);
    advected.rg += 0.5;
    advected.b *= uStrengthFade;

    // FINAL
    vec3 color = mix(advected.rgb, mouseShape, saturate(baseStrength * sm * uPaint));

    gl_FragColor = vec4(saturate(color), 1.0);

  }
`
