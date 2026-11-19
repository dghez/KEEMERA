// Font outlines → Slug curve and band data, packed into a .kfont file.
// The layout matches the reference shaders in github.com/EricLengyel/Slug (MIT / Apache-2.0),
// ported in src/shards/TextLayer/shaders.ts. The reader is src/resources/font.ts.

export const MAGIC = 'KFNT'
export const FORMAT_VERSION = 1
// Both textures are this wide; the shader wraps band lists with `>> 12`
export const TEXTURE_WIDTH = 4096

const MAX_BANDS = 16
// Slug's README: bands overlap slightly so a curve on a boundary is never missed
const BAND_EPSILON = 1 / 1024
const BAND_SLACK = 1

const round = v => Math.round(v * 1e5) / 1e5

// default refit tolerance, em: 1/2000 em is 0.1 px on 200 px type
export const DEFAULT_TOLERANCE = 0.0005
// never merge across a turn sharper than this (radians): corners stay corners
const CORNER_ANGLE = (30 * Math.PI) / 180
// longest run of segments one quadratic may replace
const MAX_RUN = 12
// samples per original segment when fitting and checking a run
const FIT_SAMPLES = 8

/* ───────── Outlines ───────── */

// fontkit path → closed contours of quadratics [x1, y1, x2, y2, x3, y3], em units, y up
export function glyphContours(glyph, unitsPerEm) {
    const s = 1 / unitsPerEm
    const contours = []
    let contour = null
    let x = 0, y = 0, sx = 0, sy = 0

    const push = (x1, y1, x2, y2, x3, y3) => {
        if (x1 === x2 && x2 === x3 && y1 === y2 && y2 === y3) return
        contour.push([x1 * s, y1 * s, x2 * s, y2 * s, x3 * s, y3 * s])
    }
    // Slug's README: a line from p1 to p2 is the quadratic {p1, p2, p2}
    const line = (nx, ny) => {
        push(x, y, nx, ny, nx, ny)
        x = nx
        y = ny
    }
    const open = () => {
        if (contour) return
        contour = []
        sx = x
        sy = y
    }
    const close = () => {
        if (!contour) return
        if (x !== sx || y !== sy) line(sx, sy)
        if (contour.length) contours.push(contour)
        contour = null
    }

    for (const { command, args } of glyph.path.commands) {
        if (command === 'moveTo') {
            close()
            x = args[0]
            y = args[1]
            open()
        } else if (command === 'lineTo') {
            open()
            line(args[0], args[1])
        } else if (command === 'quadraticCurveTo') {
            open()
            push(x, y, args[0], args[1], args[2], args[3])
            x = args[2]
            y = args[3]
        } else if (command === 'bezierCurveTo') {
            open()
            // CFF: split at t = .5 and give each half the quadratic with control (3(c1 + c2) - c0 - c3) / 4.
            // Doing it on the whole cubic puts the control point far outside the curve
            const [c1x, c1y, c2x, c2y, ex, ey] = args
            const a1x = (x + c1x) / 2, a1y = (y + c1y) / 2
            const a2x = (x + 2 * c1x + c2x) / 4, a2y = (y + 2 * c1y + c2y) / 4
            const mx = (x + 3 * c1x + 3 * c2x + ex) / 8, my = (y + 3 * c1y + 3 * c2y + ey) / 8
            const b1x = (c1x + 2 * c2x + ex) / 4, b1y = (c1y + 2 * c2y + ey) / 4
            const b2x = (c2x + ex) / 2, b2y = (c2y + ey) / 2
            push(x, y, (3 * (a1x + a2x) - x - mx) / 4, (3 * (a1y + a2y) - y - my) / 4, mx, my)
            push(mx, my, (3 * (b1x + b2x) - mx - ex) / 4, (3 * (b1y + b2y) - my - ey) / 4, ex, ey)
            x = ex
            y = ey
        } else if (command === 'closePath') {
            close()
            x = sx
            y = sy
        }
    }
    close()

    return contours
}

/* ───────── Simplification ───────── */

const quadAt = (c, t) => {
    const u = 1 - t
    return [u * u * c[0] + 2 * u * t * c[2] + t * t * c[4], u * u * c[1] + 2 * u * t * c[3] + t * t * c[5]]
}

// direction leaving / entering a segment; a line's control sits on its end point
const startTangent = c => (c[2] !== c[0] || c[3] !== c[1] ? [c[2] - c[0], c[3] - c[1]] : [c[4] - c[0], c[5] - c[1]])
const endTangent = c => (c[4] !== c[2] || c[5] !== c[3] ? [c[4] - c[2], c[5] - c[3]] : [c[4] - c[0], c[5] - c[1]])

const angleBetween = (a, b) => {
    const la = Math.hypot(a[0], a[1])
    const lb = Math.hypot(b[0], b[1])
    if (!la || !lb) return 0
    return Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1]) / (la * lb))))
}

// one quadratic through a run of segments: same end points, control by least squares on chord-length samples.
// Returns it if every sample of the run lies within `tolerance` of it, else null
function fitRun(run, tolerance) {
    const points = [[run[0][0], run[0][1]]]
    for (const c of run) {
        for (let i = 1; i <= FIT_SAMPLES; i++) points.push(quadAt(c, i / FIT_SAMPLES))
    }

    const lengths = [0]
    for (let i = 1; i < points.length; i++) {
        lengths.push(lengths[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]))
    }
    const total = lengths[lengths.length - 1]
    if (!total) return null

    const [x0, y0] = points[0]
    const [x2, y2] = points[points.length - 1]
    let sx = 0, sy = 0, sw = 0
    for (let i = 1; i < points.length - 1; i++) {
        const t = lengths[i] / total
        const u = 1 - t
        const w = 2 * u * t
        sx += w * (points[i][0] - u * u * x0 - t * t * x2)
        sy += w * (points[i][1] - u * u * y0 - t * t * y2)
        sw += w * w
    }
    if (!sw) return null

    const fitted = [x0, y0, sx / sw, sy / sw, x2, y2]
    // exactly horizontal or vertical runs stay exact, so the band builder can still drop them from the cross bands
    if (points.every(p => p[1] === y0)) fitted[3] = y0
    if (points.every(p => p[0] === x0)) fitted[2] = x0

    // distance of each sample to the fitted curve (dense, so parameter drift doesn't count as error)
    const dense = Array.from({ length: 65 }, (_, i) => quadAt(fitted, i / 64))
    for (const p of points) {
        let best = Infinity
        for (const q of dense) best = Math.min(best, (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2)
        if (best > tolerance * tolerance) return null
    }
    return fitted
}

// fewer quadratics for the same outline, within `tolerance` em: hand-cut and scanned faces carry many tiny segments
// that cost every pixel a loop iteration. Greedy: grow each run while one quadratic still fits it
export function simplifyContour(contour, tolerance) {
    if (!tolerance || contour.length < 2) return contour

    const out = []
    let i = 0
    while (i < contour.length) {
        let fitted = contour[i]
        let end = i
        while (end + 1 < contour.length && end + 1 - i < MAX_RUN) {
            if (angleBetween(endTangent(contour[end]), startTangent(contour[end + 1])) > CORNER_ANGLE) break
            const candidate = fitRun(contour.slice(i, end + 2), tolerance)
            if (!candidate) break
            fitted = candidate
            end++
        }
        out.push(fitted)
        i = end + 1
    }
    return out
}

/* ───────── Bands ───────── */

const isStraight = (c, axis) => c[axis] === c[axis + 2] && c[axis] === c[axis + 4]
const minOf = (c, axis) => Math.min(c[axis], c[axis + 2], c[axis + 4])
const maxOf = (c, axis) => Math.max(c[axis], c[axis + 2], c[axis + 4])

function assignBands(curves, lo, size, count, axis) {
    const lists = Array.from({ length: count }, () => [])
    const scale = count / size

    for (const curve of curves) {
        const first = Math.max(0, Math.floor((minOf(curve.p, axis) - BAND_EPSILON - lo) * scale))
        const last = Math.min(count - 1, Math.floor((maxOf(curve.p, axis) + BAND_EPSILON - lo) * scale))
        for (let b = first; b <= last; b++) lists[b].push(curve)
    }

    return lists
}

// axis 1: horizontal bands (cut along y, sorted by max x), axis 0: vertical bands (cut along x, sorted by max y).
// The band count minimizes the fullest band, fewest bands on a tie
function buildBands(curves, lo, hi, axis) {
    // a straight line parallel to the ray never crosses it
    const eligible = curves.filter(c => !isStraight(c.p, axis))
    const size = hi - lo

    let best = [eligible]
    if (size > 1e-6) {
        const options = []
        for (let count = 1; count <= MAX_BANDS; count++) {
            const lists = assignBands(eligible, lo, size, count, axis)
            options.push({ lists, fullest: lists.reduce((m, l) => Math.max(m, l.length), 0) })
        }
        // more bands always trim the fullest a little but duplicate every curve that spans them:
        // take the fewest bands within BAND_SLACK curves of the best
        const fewest = Math.min(...options.map(o => o.fullest))
        best = options.find(o => o.fullest <= fewest + BAND_SLACK).lists
    }

    const sortAxis = 1 - axis
    best.forEach(list => list.sort((a, b) => maxOf(b.p, sortAxis) - maxOf(a.p, sortAxis)))
    return best
}

/* ───────── Packing ───────── */

class TexelStream {
    constructor(components) {
        this.components = components
        this.data = []
        this.cursor = 0
    }

    // the shader reads runs without wrapping rows, so a run never crosses a row end
    reserve(length) {
        if (length > TEXTURE_WIDTH) throw new Error(`[Keemera] A run of ${length} texels doesn't fit a ${TEXTURE_WIDTH} wide row`)
        const x = this.cursor % TEXTURE_WIDTH
        if (x + length > TEXTURE_WIDTH) this.cursor += TEXTURE_WIDTH - x
        const start = this.cursor
        this.cursor += length
        return start
    }

    set(texel, ...values) {
        const base = texel * this.components
        for (let i = 0; i < values.length; i++) this.data[base + i] = values[i]
    }

    get rows() {
        return Math.max(1, Math.ceil(this.cursor / TEXTURE_WIDTH))
    }

    toTyped(Type) {
        const out = new Type(this.rows * TEXTURE_WIDTH * this.components)
        for (let i = 0; i < this.data.length; i++) out[i] = this.data[i] ?? 0
        return out
    }
}

const loc = texel => [texel % TEXTURE_WIDTH, Math.floor(texel / TEXTURE_WIDTH)]

function packGlyph(contours, curveStream, bandStream) {
    const curves = []
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity

    // each texel holds (p1, p2) and the next texel's xy is p3, shared with the following curve
    for (const contour of contours) {
        const start = curveStream.reserve(contour.length + 1)
        contour.forEach((p, i) => {
            curveStream.set(start + i, p[0], p[1], p[2], p[3])
            curves.push({ p, loc: loc(start + i) })
            x0 = Math.min(x0, p[0], p[2], p[4])
            x1 = Math.max(x1, p[0], p[2], p[4])
            y0 = Math.min(y0, p[1], p[3], p[5])
            y1 = Math.max(y1, p[1], p[3], p[5])
        })
        const last = contour[contour.length - 1]
        curveStream.set(start + contour.length, last[4], last[5], 0, 0)
    }

    const box = [round(x0), round(y0), round(x1), round(y1)]
    const hBands = buildBands(curves, box[1], box[3], 1)
    const vBands = buildBands(curves, box[0], box[2], 0)

    // horizontal band headers, then vertical ones, each (curve count, offset to its list)
    const lists = [...hBands, ...vBands]
    const glyph = bandStream.reserve(lists.length)
    const shared = new Map()

    lists.forEach((list, i) => {
        if (!list.length) {
            bandStream.set(glyph + i, 0, 0)
            return
        }
        const key = list.map(c => c.loc.join(',')).join(';')
        let offset = shared.get(key)
        if (offset === undefined) {
            const start = bandStream.reserve(list.length)
            list.forEach((c, k) => bandStream.set(start + k, c.loc[0], c.loc[1]))
            offset = start - glyph
            if (offset > 0xffff) throw new Error('[Keemera] Band list offset overflows 16 bits')
            shared.set(key, offset)
        }
        bandStream.set(glyph + i, list.length, offset)
    })

    const [gx, gy] = loc(glyph)
    return { entry: [gx, gy, vBands.length - 1, hBands.length - 1, ...box], curveCount: curves.length }
}

/* ───────── Faces → .kfont ───────── */

/**
 * faces: [{ font (fontkit), family, weight, style }]; codepoints: Set or 'all'
 * Returns { meta, curves: Float32Array, bands: Uint16Array, stats }
 */
export function bake(faces, codepoints, { tolerance = DEFAULT_TOLERANCE } = {}) {
    const curveStream = new TexelStream(4)
    const bandStream = new TexelStream(2)
    const stats = []
    let totalCurves = 0

    const metaFaces = faces.map(({ font, family, weight, style }) => {
        const upm = font.unitsPerEm
        const cps = codepoints === 'all' ? font.characterSet : [...codepoints].filter(cp => font.hasGlyphForCodePoint(cp))
        const byGlyph = new Map()
        const glyphs = []
        const cmap = []

        for (const cp of [...cps].sort((a, b) => a - b)) {
            const glyph = font.glyphForCodePoint(cp)
            if (!glyph || glyph.id === 0) continue

            let index = byGlyph.get(glyph.id)
            if (index === undefined) {
                const advance = round(glyph.advanceWidth / upm)
                const contours = glyphContours(glyph, upm).map(c => simplifyContour(c, tolerance))
                if (contours.length) {
                    const { entry, curveCount } = packGlyph(contours, curveStream, bandStream)
                    glyphs.push([...entry, advance])
                    totalCurves += curveCount
                } else {
                    // present but inkless (spaces): locX -1
                    glyphs.push([-1, 0, 0, 0, 0, 0, 0, 0, advance])
                }
                index = glyphs.length - 1
                byGlyph.set(glyph.id, index)
            }
            cmap.push(cp, index)
        }

        stats.push({ family, weight, style, glyphs: glyphs.length, codepoints: cmap.length / 2 })

        return {
            family,
            weight,
            style,
            unitsPerEm: upm,
            // the browser's content box: a text Range's rect is (ascent + descent) × size tall
            ascent: round(font.ascent / upm),
            descent: round(-font.descent / upm),
            glyphs,
            cmap,
        }
    })

    const meta = {
        version: FORMAT_VERSION,
        coverage: 'slug',
        width: TEXTURE_WIDTH,
        curveRows: curveStream.rows,
        bandRows: bandStream.rows,
        faces: metaFaces,
    }

    return {
        meta,
        curves: curveStream.toTyped(Float32Array),
        bands: bandStream.toTyped(Uint16Array),
        stats: { faces: stats, curves: totalCurves },
    }
}

// 'KFNT' | u32 version | u32 json bytes | u32 0 | json, padded to 16 | Float32 curves | Uint16 bands (little-endian)
export function encode({ meta, curves, bands }) {
    const json = Buffer.from(JSON.stringify(meta), 'utf8')
    const padded = Math.ceil(json.length / 16) * 16

    const header = Buffer.alloc(16)
    header.write(MAGIC, 0, 'ascii')
    header.writeUInt32LE(FORMAT_VERSION, 4)
    header.writeUInt32LE(json.length, 8)

    return Buffer.concat([
        header,
        json,
        Buffer.alloc(padded - json.length, 0x20),
        Buffer.from(curves.buffer, curves.byteOffset, curves.byteLength),
        Buffer.from(bands.buffer, bands.byteOffset, bands.byteLength),
    ])
}
