const map = /* glsl */ `
#ifndef KEEMERA_MAP
#define KEEMERA_MAP

float map(float value, float min1, float max1, float min2, float max2) {
  return min2 + (value - min1) * (max2 - min2) / (max1 - min1);
}

#endif
`

export default map
