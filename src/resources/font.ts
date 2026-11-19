import { DataTexture, FloatType, NearestFilter, RGBAFormat, RGIntegerFormat, UnsignedShortType } from 'three'

// Reader for the .kfont packs written by `keemera-font` (cli/bake.js)
const MAGIC = 'KFNT'
const VERSION = 1
const HEADER_BYTES = 16

export type FontStyle = 'normal' | 'italic'

export interface FontGlyph {
    // glyph data location in the band texture, -1 for inkless glyphs (spaces)
    locX: number
    locY: number
    // highest vertical / horizontal band index
    bandMaxX: number
    bandMaxY: number
    // ink box, em, y up
    x0: number
    y0: number
    x1: number
    y1: number
    advance: number
}

export interface FontPackFace {
    pack: FontPack
    family: string
    weight: number
    style: FontStyle
    unitsPerEm: number
    ascent: number
    descent: number
    glyphs: Map<number, FontGlyph>
    // this face's letters and digits in the pack's glyph table, for swapping glyphs in a shader
    tableStart: number
    tableCount: number
}

interface FaceMeta {
    family: string
    weight: number
    style: FontStyle
    unitsPerEm: number
    ascent: number
    descent: number
    glyphs: number[][]
    cmap: number[]
}

interface PackMeta {
    version: number
    coverage: string
    width: number
    curveRows: number
    bandRows: number
    faces: FaceMeta[]
}

// letters and digits: what a shader may swap a glyph for (keemeraSetGlyph)
const SWAPPABLE = /^[\p{L}\p{N}]$/u
// two RGBA32F texels per glyph: ink box (x0, y0, x1, y1), then (locX, locY, bandMaxX, bandMaxY)
const TABLE_WIDTH = 4096

const createTexture = (data: Float32Array | Uint16Array, width: number, height: number, isBand: boolean) => {
    const texture = isBand
        ? new DataTexture(data, width, height, RGIntegerFormat, UnsignedShortType)
        : new DataTexture(data, width, height, RGBAFormat, FloatType)

    if (isBand) texture.internalFormat = 'RG16UI'
    texture.minFilter = NearestFilter
    texture.magFilter = NearestFilter
    texture.generateMipmaps = false
    texture.flipY = false
    texture.needsUpdate = true
    return texture
}

export default class FontPack {
    readonly isFontPack = true
    readonly faces: FontPackFace[]
    readonly curveTexture: DataTexture
    readonly bandTexture: DataTexture
    readonly glyphTexture: DataTexture

    constructor(buffer: ArrayBuffer, name = 'font') {
        const view = new DataView(buffer)
        const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4))
        if (magic !== MAGIC) {
            throw new Error(`[Keemera] "${name}" is not a .kfont file. Bake one with: npx keemera-font <font> -o <file>.kfont`)
        }

        const version = view.getUint32(4, true)
        if (version !== VERSION) {
            throw new Error(`[Keemera] "${name}" is .kfont v${version}, this keemera reads v${VERSION}. Bake it again with this version's keemera-font`)
        }

        const jsonBytes = view.getUint32(8, true)
        const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, HEADER_BYTES, jsonBytes))) as PackMeta
        const { width, curveRows, bandRows } = meta

        // zero-copy views: the bake aligns both blocks
        const curveOffset = HEADER_BYTES + Math.ceil(jsonBytes / 16) * 16
        const curveLength = width * curveRows * 4
        const curves = new Float32Array(buffer, curveOffset, curveLength)
        const bands = new Uint16Array(buffer, curveOffset + curveLength * 4, width * bandRows * 2)

        this.curveTexture = createTexture(curves, width, curveRows, false)
        this.bandTexture = createTexture(bands, width, bandRows, true)
        this.faces = meta.faces.map(face => this.#createFace(face))
        this.glyphTexture = this.#createGlyphTable()
    }

    // every face's swappable glyphs in one texture, each face a contiguous run
    #createGlyphTable() {
        const runs = this.faces.map((face) => {
            const unique = new Set<FontGlyph>()
            for (const [cp, glyph] of face.glyphs) {
                if (glyph.locX >= 0 && SWAPPABLE.test(String.fromCodePoint(cp))) unique.add(glyph)
            }
            return [...unique]
        })

        const total = runs.reduce((sum, run) => sum + run.length, 0)
        const height = Math.max(1, Math.ceil((total * 2) / TABLE_WIDTH))
        const data = new Float32Array(TABLE_WIDTH * height * 4)

        let index = 0
        runs.forEach((run, f) => {
            this.faces[f].tableStart = index
            this.faces[f].tableCount = run.length
            for (const g of run) {
                data.set([g.x0, g.y0, g.x1, g.y1, g.locX, g.locY, g.bandMaxX, g.bandMaxY], index * 8)
                index++
            }
        })

        return createTexture(data, TABLE_WIDTH, height, false)
    }

    #createFace(meta: FaceMeta): FontPackFace {
        const glyphs = meta.glyphs.map(([locX, locY, bandMaxX, bandMaxY, x0, y0, x1, y1, advance]) => ({
            locX, locY, bandMaxX, bandMaxY, x0, y0, x1, y1, advance,
        }))

        const map = new Map<number, FontGlyph>()
        for (let i = 0; i < meta.cmap.length; i += 2) map.set(meta.cmap[i], glyphs[meta.cmap[i + 1]])

        return {
            pack: this,
            family: meta.family,
            weight: meta.weight,
            style: meta.style,
            unitsPerEm: meta.unitsPerEm,
            ascent: meta.ascent,
            descent: meta.descent,
            glyphs: map,
            tableStart: 0,
            tableCount: 0,
        }
    }

    dispose() {
        this.curveTexture.dispose()
        this.bandTexture.dispose()
        this.glyphTexture.dispose()
    }
}

/**
 * The face the browser would pick from `faces`: first listed family that exists, then style, then the
 * closest weight (CSS rules: heavier first above 500, lighter first below 400)
 */
export function matchFace(faces: FontPackFace[], families: string[], weight: number, style: FontStyle) {
    for (const family of families) {
        const name = family.toLowerCase()
        const candidates = faces.filter(f => f.family.toLowerCase() === name)
        if (!candidates.length) continue

        const sameStyle = candidates.filter(f => f.style === style)
        const pool = sameStyle.length ? sameStyle : candidates

        const score = (w: number) => {
            if (w === weight) return 0
            if (weight >= 400 && weight <= 500 && w > weight && w <= 500) return w - weight
            const prefersLighter = weight <= 500
            const lighter = w < weight
            return (lighter === prefersLighter ? 1000 : 2000) + Math.abs(w - weight)
        }

        return pool.reduce((best, f) => (score(f.weight) < score(best.weight) ? f : best))
    }
    return undefined
}
