const brightnessContrast = /* glsl */ `
#ifndef KEEMERA_BRIGHTNESS_CONTRAST
#define KEEMERA_BRIGHTNESS_CONTRAST

vec3 brightnessContrast(vec3 value, float brightness, float contrast) {
  return (value - 0.5) * contrast + 0.5 + brightness;
}

#endif
`

export default brightnessContrast
