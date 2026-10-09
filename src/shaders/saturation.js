const saturation = /* glsl */ `
#ifndef KEEMERA_SATURATION
#define KEEMERA_SATURATION

vec3 saturation(vec3 rgb, float adjustment) {
  const vec3 W = vec3(0.2125, 0.7154, 0.0721);
  vec3 intensity = vec3(dot(rgb, W));
  return mix(intensity, rgb, adjustment);
}

#endif
`

export default saturation
