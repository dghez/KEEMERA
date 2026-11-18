// Slug: Eric Lengyel, "GPU-Centered Font Rendering Directly from Glyph Outlines", JCGT 2017.
// Ported from the reference shaders at github.com/EricLengyel/Slug, Copyright 2017 Eric Lengyel,
// MIT / Apache-2.0. The Slug patent was dedicated to the public domain on 2026-03-17.
// Data layout: cli/bake.js

// three's chunks where they fit: logarithmic depth, clipping planes, output color space, premultiplied alpha
export const vertexShader = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>

in vec4 aPen;
in vec4 aBox;
in uvec4 aGlyph;
in vec4 aColor;

uniform float uDpr;

out vec2 vEm;
flat out vec4 vBanding;
#ifdef KEEMERA_TEXT_WIREFRAME
  flat out vec4 vBox;
#endif
flat out ivec4 vGlyph;
flat out vec4 vColor;

void main() {
  // aPen: pen position (document px, y down), font size (px). The mesh's transform holds scroll and the viewport offset
  float size = aPen.z;

  // unused slot of a block's range: collapsed, no fragments
  if (size <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  // coverage reaches half a device pixel past the ink box, plus slack
  float pad = 0.625 / (size * uDpr);
  vec2 em = mix(aBox.xy - pad, aBox.zw + pad, position.xy);

  // 1 world unit = 1 css px at z = 0 (camera.useDomSize)
  #include <begin_vertex>
  transformed.xy = vec2(aPen.x + em.x * size, em.y * size - aPen.y);
  #include <project_vertex>
  #include <logdepthbuf_vertex>
  #include <clipping_planes_vertex>

  // the bake splits the ink box into even bands, so their transform follows from it
  vec2 bands = vec2(aGlyph.zw) + 1.0;
  vec2 bandScale = bands / max(aBox.zw - aBox.xy, vec2(1e-6));

  vEm = em;
  vBanding = vec4(bandScale, -aBox.xy * bandScale);
  vGlyph = ivec4(aGlyph);
  vColor = aColor;

  #ifdef KEEMERA_TEXT_WIREFRAME
    vBox = aBox;
  #endif
}
`

export const fragmentShader = /* glsl */`
precision highp usampler2D;

#include <common>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>

// the curve and band textures are 4096 texels wide
#define KEEMERA_SLUG_LOG_WIDTH 12

uniform sampler2D uCurves;
uniform usampler2D uBands;

in vec2 vEm;
flat in vec4 vBanding;
flat in ivec4 vGlyph;
flat in vec4 vColor;

uint calcRootCode(float y1, float y2, float y3) {
  // root eligibility from the signs of the three control points' y
  uint i1 = floatBitsToUint(y1) >> 31u;
  uint i2 = floatBitsToUint(y2) >> 30u;
  uint i3 = floatBitsToUint(y3) >> 29u;

  uint shift = (i2 & 2u) | (i1 & ~2u);
  shift = (i3 & 4u) | (shift & ~4u);

  return (0x2E74u >> shift) & 0x0101u;
}

vec2 solveHorizPoly(vec4 p12, vec2 p3) {
  // t where the curve crosses y = 0, as a t^2 - 2b t + c
  vec2 a = p12.xy - p12.zw * 2.0 + p3;
  vec2 b = p12.xy - p12.zw;
  float ra = 1.0 / a.y;
  float rb = 0.5 / b.y;

  float d = sqrt(max(b.y * b.y - a.y * p12.y, 0.0));
  float t1 = (b.y - d) * ra;
  float t2 = (b.y + d) * ra;

  if (abs(a.y) < 1.0 / 65536.0) {
    t1 = p12.y * rb;
    t2 = t1;
  }

  return vec2((a.x * t1 - b.x * 2.0) * t1 + p12.x, (a.x * t2 - b.x * 2.0) * t2 + p12.x);
}

vec2 solveVertPoly(vec4 p12, vec2 p3) {
  // t where the curve crosses x = 0
  vec2 a = p12.xy - p12.zw * 2.0 + p3;
  vec2 b = p12.xy - p12.zw;
  float ra = 1.0 / a.x;
  float rb = 0.5 / b.x;

  float d = sqrt(max(b.x * b.x - a.x * p12.x, 0.0));
  float t1 = (b.x - d) * ra;
  float t2 = (b.x + d) * ra;

  if (abs(a.x) < 1.0 / 65536.0) {
    t1 = p12.x * rb;
    t2 = t1;
  }

  return vec2((a.y * t1 - b.y * 2.0) * t1 + p12.y, (a.y * t2 - b.y * 2.0) * t2 + p12.y);
}

ivec2 calcBandLoc(ivec2 glyphLoc, uint offset) {
  // an offset past the row end wraps to the next row
  ivec2 bandLoc = ivec2(glyphLoc.x + int(offset), glyphLoc.y);
  bandLoc.y += bandLoc.x >> KEEMERA_SLUG_LOG_WIDTH;
  bandLoc.x &= (1 << KEEMERA_SLUG_LOG_WIDTH) - 1;
  return bandLoc;
}

float calcCoverage(float xcov, float ycov, float xwgt, float ywgt) {
  // weighted by how close each ray's crossing is to the pixel center, floored so interiors stay solid.
  // abs() accepts either winding direction; nonzero fill rule
  float coverage = max(abs(xcov * xwgt + ycov * ywgt) / max(xwgt + ywgt, 1.0 / 65536.0), min(abs(xcov), abs(ycov)));
  return saturate(coverage);
}

float slugRender(vec2 renderCoord, vec4 bandTransform, ivec4 glyphData) {
  // pixel footprint in em, before anything conditional
  vec2 emsPerPixel = fwidth(renderCoord);
  vec2 pixelsPerEm = 1.0 / emsPerPixel;

  ivec2 bandMax = glyphData.zw;
  ivec2 bandIndex = clamp(ivec2(renderCoord * bandTransform.xy + bandTransform.zw), ivec2(0), bandMax);
  ivec2 glyphLoc = glyphData.xy;

  // horizontal ray: curves of the pixel's horizontal band, sorted by max x descending
  float xcov = 0.0;
  float xwgt = 0.0;

  uvec2 hbandData = texelFetch(uBands, ivec2(glyphLoc.x + bandIndex.y, glyphLoc.y), 0).xy;
  ivec2 hbandLoc = calcBandLoc(glyphLoc, hbandData.y);

  for (int curveIndex = 0; curveIndex < int(hbandData.x); curveIndex++) {
    ivec2 curveLoc = ivec2(texelFetch(uBands, ivec2(hbandLoc.x + curveIndex, hbandLoc.y), 0).xy);

    vec4 p12 = texelFetch(uCurves, curveLoc, 0) - vec4(renderCoord, renderCoord);
    vec2 p3 = texelFetch(uCurves, ivec2(curveLoc.x + 1, curveLoc.y), 0).xy - renderCoord;

    // every later curve lies left of the pixel too
    if (max(max(p12.x, p12.z), p3.x) * pixelsPerEm.x < -0.5) break;

    uint code = calcRootCode(p12.y, p12.w, p3.y);
    if (code != 0u) {
      vec2 r = solveHorizPoly(p12, p3) * pixelsPerEm.x;

      if ((code & 1u) != 0u) {
        xcov += saturate(r.x + 0.5);
        xwgt = max(xwgt, saturate(1.0 - abs(r.x) * 2.0));
      }

      if (code > 1u) {
        xcov -= saturate(r.y + 0.5);
        xwgt = max(xwgt, saturate(1.0 - abs(r.y) * 2.0));
      }
    }
  }

  // vertical ray: its band headers follow the horizontal ones
  float ycov = 0.0;
  float ywgt = 0.0;

  uvec2 vbandData = texelFetch(uBands, ivec2(glyphLoc.x + bandMax.y + 1 + bandIndex.x, glyphLoc.y), 0).xy;
  ivec2 vbandLoc = calcBandLoc(glyphLoc, vbandData.y);

  for (int curveIndex = 0; curveIndex < int(vbandData.x); curveIndex++) {
    ivec2 curveLoc = ivec2(texelFetch(uBands, ivec2(vbandLoc.x + curveIndex, vbandLoc.y), 0).xy);

    vec4 p12 = texelFetch(uCurves, curveLoc, 0) - vec4(renderCoord, renderCoord);
    vec2 p3 = texelFetch(uCurves, ivec2(curveLoc.x + 1, curveLoc.y), 0).xy - renderCoord;

    if (max(max(p12.y, p12.w), p3.y) * pixelsPerEm.y < -0.5) break;

    uint code = calcRootCode(p12.x, p12.z, p3.x);
    if (code != 0u) {
      vec2 r = solveVertPoly(p12, p3) * pixelsPerEm.y;

      if ((code & 1u) != 0u) {
        ycov -= saturate(r.x + 0.5);
        ywgt = max(ywgt, saturate(1.0 - abs(r.x) * 2.0));
      }

      if (code > 1u) {
        ycov += saturate(r.y + 0.5);
        ywgt = max(ywgt, saturate(1.0 - abs(r.y) * 2.0));
      }
    }
  }

  return calcCoverage(xcov, ycov, xwgt, ywgt);
}

#ifdef KEEMERA_TEXT_WIREFRAME
  flat in vec4 vBox;

  // debug: a 1 device px outline of the glyph's ink box, the rect the bake measured
  float wireframe(vec2 renderCoord, vec4 box) {
    vec2 pixelsPerEm = 1.0 / fwidth(renderCoord);
    vec2 inside = min(renderCoord - box.xy, box.zw - renderCoord) * pixelsPerEm;
    return saturate(1.0 - abs(min(inside.x, inside.y)));
  }
#endif

void main() {
  #ifdef KEEMERA_TEXT_WIREFRAME
    float coverage = wireframe(vEm, vBox);
  #else
    float coverage = slugRender(vEm, vBanding, vGlyph);
  #endif

  // vColor is already linear (decoded on the CPU); <colorspace_fragment> encodes it for the output
  vec4 diffuseColor = vec4(vColor.rgb, vColor.a * coverage);

  #include <clipping_planes_fragment>
  #include <logdepthbuf_fragment>

  gl_FragColor = diffuseColor;

  #include <colorspace_fragment>
  #include <premultiplied_alpha_fragment>
}
`
