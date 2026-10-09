---
name: add-shader
description: Add a GLSL snippet to @dghez/keemera/shaders. Use when adding a reusable shader function (noise, blend mode, color adjustment, UV math, easing) to src/shaders.
---

# Add a shader snippet

Snippets are GLSL strings exported from `@dghez/keemera/shaders`. Users inline them in their own shaders with `${snippet}`, so they must be safe to include more than once.

## Checklist

1. Create `src/shaders/<name>.js` (camelCase, same as the export name) from the template below.
2. Export it from `src/shaders/index.js`, keeping lines alphabetical:
   ```js
   export { default as <name> } from './<name>'
   ```
3. Add a bullet to `README.md` under **Building blocks → Shaders**, with the GLSL signature:
   ```
   - `<name>`: what it does, `vec3 <fn>(vec3 rgb, float amount)`.
   ```
4. Run `npm run lint` and `npm run build`. If possible, try it in a material in `examples/basic` to make sure it compiles.

## Rules

- Include guard named `KEEMERA_<NAME>` in UPPER_SNAKE (e.g. `brightnessContrast` → `KEEMERA_BRIGHTNESS_CONTRAST`).
- `/* glsl */` tag on the template string, 2-space indent inside the GLSL.
- Must compile in both vertex and fragment shaders unless it uses derivatives (`fwidth`, `dFdx`), in which case say "fragment only" in the README.
- If it depends on another snippet, interpolate it at the top (`${noise3d}`), the guards make it safe. Say so in the README (like `curlNoise` includes `noise3d`).
- Pick function names unlikely to clash with user code or Three.js chunks.
- Credit the original source in a short `//` comment if it's ported.

## Template

```js
const <name> = /* glsl */ `
#ifndef KEEMERA_<NAME>
#define KEEMERA_<NAME>

float <fn>(float value) {
  return value;
}

#endif
`

export default <name>
```

Reference: `src/shaders/map.js` (simple), `src/shaders/curlNoise.js` (depends on another snippet).
