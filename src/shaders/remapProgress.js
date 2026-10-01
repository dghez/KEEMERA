const remapProgress = /* glsl */ `
#ifndef KEEMERA_REMAP_PROGRESS
#define KEEMERA_REMAP_PROGRESS

float remapProgress(float _progress, float _delay) {
  return clamp((_progress - _delay) / (1.0 - _delay), 0.0, 1.0);
}

#endif
`

export default remapProgress
