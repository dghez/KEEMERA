// Slug: Eric Lengyel, "GPU-Centered Font Rendering Directly from Glyph Outlines", JCGT 2017.
// Ported from the reference shaders at github.com/EricLengyel/Slug, Copyright 2017 Eric Lengyel,
// MIT / Apache-2.0. The Slug patent was dedicated to the public domain on 2026-03-17.
// Data layout: cli/bake.js
//
// Injected into any material by ./material.ts: the defs go above the material's shader, its main() is renamed
// keemeraBaseMain() and the main below runs around it. Every name is prefixed so it can't clash with user code,
// and nothing here depends on three's chunks, which the material includes after these defs

export const vertexDefs = /* glsl */`
in vec4 aPen;
in vec4 aBlock;
in vec4 aAnchor;
in vec4 aBox;
in uvec4 aGlyph;
in vec4 aColor;
in vec4 aIndex;

uniform float uKeemeraDpr;

out vec2 vKeemeraEm;
flat out vec4 vKeemeraBanding;
flat out ivec4 vKeemeraGlyph;
flat out vec4 vKeemeraColor;
flat out vec4 vKeemeraIndex;
#ifdef KEEMERA_TEXT_WIREFRAME
  flat out vec4 vKeemeraBox;
#endif

// readable from the material's shader
vec3 keemeraPosition;
vec2 keemeraUv;
vec2 keemeraGlyphUv;
vec4 keemeraIndex;
vec4 keemeraColor;
float keemeraSize;
// centers in the same space as position: move a glyph, word or line as one piece around them
vec2 keemeraGlyphCenter;
vec2 keemeraWordCenter;
vec2 keemeraLineCenter;

// px relative to the element, y down → the layer's space, y up
vec2 keemeraToLayer(vec2 local) {
  return vec2(aBlock.x + local.x, -(aBlock.y + local.y));
}

bool keemeraTextVertex() {
  // aPen: pen on the baseline relative to the element (px, y down), font size (px)
  // aBlock: the element's document position and size (px, y down)
  keemeraSize = aPen.z;

  // unused slot of a block's range
  if (keemeraSize <= 0.0) return false;

  // coverage reaches half a device pixel past the ink box, plus slack
  float pad = 0.625 / (keemeraSize * uKeemeraDpr);
  vec2 em = mix(aBox.xy - pad, aBox.zw + pad, position.xy);

  // document px, y down; the layer's content group holds scroll and the viewport offset
  vec2 doc = aBlock.xy + aPen.xy + vec2(em.x, -em.y) * keemeraSize;
  keemeraPosition = vec3(doc.x, -doc.y, 0.0);
  keemeraUv = vec2(
    (doc.x - aBlock.x) / max(aBlock.z, 1e-6),
    1.0 - (doc.y - aBlock.y) / max(aBlock.w, 1e-6)
  );
  keemeraGlyphUv = position.xy;
  keemeraGlyphCenter = keemeraToLayer(aPen.xy + vec2(aBox.x + aBox.z, -(aBox.y + aBox.w)) * 0.5 * keemeraSize);
  keemeraWordCenter = keemeraToLayer(aAnchor.xz);
  keemeraLineCenter = keemeraToLayer(aAnchor.yz);
  keemeraIndex = aIndex;
  keemeraColor = aColor;

  // the bake splits the ink box into even bands, so their transform follows from it
  vec2 bandScale = (vec2(aGlyph.zw) + 1.0) / max(aBox.zw - aBox.xy, vec2(1e-6));

  vKeemeraEm = em;
  vKeemeraBanding = vec4(bandScale, -aBox.xy * bandScale);
  vKeemeraGlyph = ivec4(aGlyph);
  vKeemeraColor = aColor;
  vKeemeraIndex = aIndex;
  #ifdef KEEMERA_TEXT_WIREFRAME
    vKeemeraBox = aBox;
  #endif

  return true;
}

// the material's shader reads the glyph's values through the attribute names it already uses
#define position keemeraPosition
#define uv keemeraUv
`

export const vertexMain = /* glsl */`
void main() {
  if (!keemeraTextVertex()) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  keemeraBaseMain();
}
`

export const fragmentDefs = /* glsl */`
precision highp usampler2D;

// the curve and band textures are 4096 texels wide
#define KEEMERA_SLUG_LOG_WIDTH 12

uniform sampler2D uKeemeraCurves;
uniform usampler2D uKeemeraBands;

in vec2 vKeemeraEm;
flat in vec4 vKeemeraBanding;
flat in ivec4 vKeemeraGlyph;
flat in vec4 vKeemeraColor;
flat in vec4 vKeemeraIndex;

// readable from the material's shader
vec4 keemeraColor;
vec4 keemeraIndex;
float keemeraCoverage;

float keemeraClamp01(float x) {
  return clamp(x, 0.0, 1.0);
}

uint keemeraRootCode(float y1, float y2, float y3) {
  // root eligibility from the signs of the three control points' y
  uint i1 = floatBitsToUint(y1) >> 31u;
  uint i2 = floatBitsToUint(y2) >> 30u;
  uint i3 = floatBitsToUint(y3) >> 29u;

  uint shift = (i2 & 2u) | (i1 & ~2u);
  shift = (i3 & 4u) | (shift & ~4u);

  return (0x2E74u >> shift) & 0x0101u;
}

vec2 keemeraSolveHorizPoly(vec4 p12, vec2 p3) {
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

vec2 keemeraSolveVertPoly(vec4 p12, vec2 p3) {
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

ivec2 keemeraBandLoc(ivec2 glyphLoc, uint offset) {
  // an offset past the row end wraps to the next row
  ivec2 bandLoc = ivec2(glyphLoc.x + int(offset), glyphLoc.y);
  bandLoc.y += bandLoc.x >> KEEMERA_SLUG_LOG_WIDTH;
  bandLoc.x &= (1 << KEEMERA_SLUG_LOG_WIDTH) - 1;
  return bandLoc;
}

float keemeraCoverageOf(float xcov, float ycov, float xwgt, float ywgt) {
  // weighted by how close each ray's crossing is to the pixel center, floored so interiors stay solid.
  // abs() accepts either winding direction; nonzero fill rule
  float coverage = max(abs(xcov * xwgt + ycov * ywgt) / max(xwgt + ywgt, 1.0 / 65536.0), min(abs(xcov), abs(ycov)));
  return keemeraClamp01(coverage);
}

float keemeraSlug(vec2 renderCoord, vec4 bandTransform, ivec4 glyphData) {
  // pixel footprint in em, before anything conditional
  vec2 emsPerPixel = fwidth(renderCoord);
  vec2 pixelsPerEm = 1.0 / emsPerPixel;

  ivec2 bandMax = glyphData.zw;
  ivec2 bandIndex = clamp(ivec2(renderCoord * bandTransform.xy + bandTransform.zw), ivec2(0), bandMax);
  ivec2 glyphLoc = glyphData.xy;

  // horizontal ray: curves of the pixel's horizontal band, sorted by max x descending
  float xcov = 0.0;
  float xwgt = 0.0;

  uvec2 hbandData = texelFetch(uKeemeraBands, ivec2(glyphLoc.x + bandIndex.y, glyphLoc.y), 0).xy;
  ivec2 hbandLoc = keemeraBandLoc(glyphLoc, hbandData.y);

  for (int curveIndex = 0; curveIndex < int(hbandData.x); curveIndex++) {
    ivec2 curveLoc = ivec2(texelFetch(uKeemeraBands, ivec2(hbandLoc.x + curveIndex, hbandLoc.y), 0).xy);

    vec4 p12 = texelFetch(uKeemeraCurves, curveLoc, 0) - vec4(renderCoord, renderCoord);
    vec2 p3 = texelFetch(uKeemeraCurves, ivec2(curveLoc.x + 1, curveLoc.y), 0).xy - renderCoord;

    // every later curve lies left of the pixel too
    if (max(max(p12.x, p12.z), p3.x) * pixelsPerEm.x < -0.5) break;

    uint code = keemeraRootCode(p12.y, p12.w, p3.y);
    if (code != 0u) {
      vec2 r = keemeraSolveHorizPoly(p12, p3) * pixelsPerEm.x;

      if ((code & 1u) != 0u) {
        xcov += keemeraClamp01(r.x + 0.5);
        xwgt = max(xwgt, keemeraClamp01(1.0 - abs(r.x) * 2.0));
      }

      if (code > 1u) {
        xcov -= keemeraClamp01(r.y + 0.5);
        xwgt = max(xwgt, keemeraClamp01(1.0 - abs(r.y) * 2.0));
      }
    }
  }

  // vertical ray: its band headers follow the horizontal ones
  float ycov = 0.0;
  float ywgt = 0.0;

  uvec2 vbandData = texelFetch(uKeemeraBands, ivec2(glyphLoc.x + bandMax.y + 1 + bandIndex.x, glyphLoc.y), 0).xy;
  ivec2 vbandLoc = keemeraBandLoc(glyphLoc, vbandData.y);

  for (int curveIndex = 0; curveIndex < int(vbandData.x); curveIndex++) {
    ivec2 curveLoc = ivec2(texelFetch(uKeemeraBands, ivec2(vbandLoc.x + curveIndex, vbandLoc.y), 0).xy);

    vec4 p12 = texelFetch(uKeemeraCurves, curveLoc, 0) - vec4(renderCoord, renderCoord);
    vec2 p3 = texelFetch(uKeemeraCurves, ivec2(curveLoc.x + 1, curveLoc.y), 0).xy - renderCoord;

    if (max(max(p12.y, p12.w), p3.y) * pixelsPerEm.y < -0.5) break;

    uint code = keemeraRootCode(p12.x, p12.z, p3.x);
    if (code != 0u) {
      vec2 r = keemeraSolveVertPoly(p12, p3) * pixelsPerEm.y;

      if ((code & 1u) != 0u) {
        ycov -= keemeraClamp01(r.x + 0.5);
        ywgt = max(ywgt, keemeraClamp01(1.0 - abs(r.x) * 2.0));
      }

      if (code > 1u) {
        ycov += keemeraClamp01(r.y + 0.5);
        ywgt = max(ywgt, keemeraClamp01(1.0 - abs(r.y) * 2.0));
      }
    }
  }

  return keemeraCoverageOf(xcov, ycov, xwgt, ywgt);
}

#ifdef KEEMERA_TEXT_WIREFRAME
  flat in vec4 vKeemeraBox;

  // debug: a 1 device px outline of the glyph's ink box, the rect the bake measured
  float keemeraWireframe(vec2 renderCoord, vec4 box) {
    vec2 pixelsPerEm = 1.0 / fwidth(renderCoord);
    vec2 inside = min(renderCoord - box.xy, box.zw - renderCoord) * pixelsPerEm;
    return keemeraClamp01(1.0 - abs(min(inside.x, inside.y)));
  }
#endif
`

export const fragmentMain = /* glsl */`
void main() {
  // first: fwidth needs uniform control flow, before any discard in the material
  #ifdef KEEMERA_TEXT_WIREFRAME
    keemeraCoverage = keemeraWireframe(vKeemeraEm, vKeemeraBox);
  #else
    keemeraCoverage = keemeraSlug(vKeemeraEm, vKeemeraBanding, vKeemeraGlyph);
  #endif
  keemeraColor = vKeemeraColor;
  keemeraIndex = vKeemeraIndex;

  keemeraBaseMain();

  // after the material's post chunks: color space, tone mapping and fog only touch rgb
  #ifdef PREMULTIPLIED_ALPHA
    gl_FragColor *= keemeraCoverage;
  #else
    gl_FragColor.a *= keemeraCoverage;
  #endif
}
`
