const blendNormal = /* glsl */ `
#ifndef KEEMERA_BLEND_NORMAL
#define KEEMERA_BLEND_NORMAL

vec3 blendNormal(vec3 base, vec3 blend) {
	return blend;
}

vec3 blendNormal(vec3 base, vec3 blend, float opacity) {
	return (blendNormal(base, blend) * opacity + base * (1.0 - opacity));
}

#endif
`

export default blendNormal
