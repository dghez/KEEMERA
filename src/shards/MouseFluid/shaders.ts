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

  #ifdef USE_TURBULENCE
    uniform sampler2D uTurbulence;
    uniform float uTurbulenceStrength;
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
    float radSize = 0.035;
    float rad = pow(smoothstep(0.0, 0.2, length(uSpeed)), 0.85);
    rad = clamp(rad, 0.0, radSize) * 2.0;

    // MASKS
    float dist = distance(vUv * aspect, uMouse * aspect);
    float sm = 1.0 - smoothstep(rad * 0.2, rad, dist);
    float m = 1.0 - step(rad, dist);

    // MOUSE SHAPE
    float baseStrength = length(uSpeed);
    vec2 shapeVelocity = mix(vec2(0.0), uNormalizedSpeed * 16.0, m);
    vec3 mouseShape = vec3(shapeVelocity * 0.5 + 0.5, saturate(baseStrength * m * 30.0));

    // BLURRED VELOCITY
    vec2 blurredUv = vUv;
    #ifdef USE_TURBULENCE
      // jitter the blurred read, fine scale
      blurredUv += (texture2D(uTurbulence, vUv * aspect * 90.0).rg - 0.5) * 0.02 * uTurbulenceStrength;
    #endif
    vec4 blurred = texture2D(uBlurred, blurredUv);
    vec2 velocityInverse = (vec2(0.5) - blurred.rg) * 2.0;
    vec2 direction = velocityInverse * 0.027;

    #ifdef USE_TURBULENCE
      // push the advection around, more where the fluid is strong
      vec2 turbulence = vec2(0.5) - texture2D(uTurbulence, vUv * aspect * 30.0).rg;
      direction += turbulence * 0.065 * blurred.b * 1.4 * 1.3 * uTurbulenceStrength;
    #endif

    // ADVECTION
    vec4 advected = texture2D(uPrev, vUv + direction);
    advected.rg -= 0.5;
    advected.rg *= 0.96;
    if (abs(advected.b) < 0.0001) advected.rg = vec2(0.0);
    advected.rg += 0.5;
    advected.b *= 0.9;

    // FINAL
    vec3 color = mix(advected.rgb, mouseShape, saturate(baseStrength * sm * 100.0));

    gl_FragColor = vec4(saturate(color), 1.0);
  }
`
