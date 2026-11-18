import { matchFace } from '../../resources/font'
import type { FontGlyph, FontPackFace, FontStyle } from '../../resources/font'

// The browser does the layout; this only reads it back. One Range per grapheme gives its pen position,
// so kerning, letter-spacing, wrapping, justify and <sup> come out exactly as the DOM drew them.
// Approach from dom-gpu-text (MIT, Jesper Landberg)

// linear rgb and alpha, 0–65535 (Uint16 normalized on the GPU)
export type RGBA = [number, number, number, number]

// sRGB byte → linear, 16 bit: the shader then skips the decode
const LINEAR = Array.from({ length: 256 }, (_, i) => {
    const c = i / 255
    return Math.round((c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) * 65535)
})
const toLinear = (r: number, g: number, b: number, a: number): RGBA => [
    LINEAR[Math.round(r)], LINEAR[Math.round(g)], LINEAR[Math.round(b)], Math.round(a * 257),
]

export interface PlacedGlyph {
    face: FontPackFace
    glyph: FontGlyph
    // pen on the baseline, px from the element's top-left, y down
    x: number
    y: number
    size: number
    color: RGBA
    char: number
    word: number
    line: number
    charInLine: number
}

export interface MeasureResult {
    glyphs: PlacedGlyph[]
    rect: DOMRect
    chars: number
    words: number
    lines: number
    // characters no face can draw, and font-family lists with no face at all
    missing: Set<string>
    unmatched: Set<string>
}

interface RunStyle {
    key: string
    face: FontPackFace | undefined
    families: string
    size: number
    color: RGBA
    transform: string
    hidden: boolean
    font: Pick<CSSStyleDeclaration, 'fontFamily' | 'fontWeight' | 'fontStyle' | 'fontStretch' | 'fontVariationSettings'>
    // content box top → baseline, px
    ascent: number
}

// whitespace and invisible formatting characters: no glyph, but they end a word
const INVISIBLE = /^[\s\u00ad\u200b-\u200f\u2028-\u202f\u2060-\u206f\ufeff]+$/u

const parseFamilies = (value: string) => value
    .split(',')
    .map(f => f.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean)

const parseStyle = (value: string): FontStyle => (value.startsWith('italic') || value.startsWith('oblique') ? 'italic' : 'normal')

const RGB = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/

function* graphemes(text: string) {
    if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
        const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
        for (const { segment, index } of segmenter.segment(text)) yield { segment, index }
        return
    }
    let index = 0
    for (const segment of text) {
        yield { segment, index }
        index += segment.length
    }
}

// text-transform is paint: the DOM keeps the authored characters, the browser draws the transformed ones
const applyTransform = (text: string, transform: string, isWordStart: boolean) => {
    if (transform === 'uppercase') return text.toUpperCase()
    if (transform === 'lowercase') return text.toLowerCase()
    if (transform === 'capitalize' && isWordStart) return text.toUpperCase()
    return text
}

const firstRect = (range: Range) => {
    const rects = range.getClientRects()
    for (let i = 0; i < rects.length; i++) {
        if (rects[i].width > 0 || rects[i].height > 0) return rects[i]
    }
    return undefined
}

// Per-layer caches: baselines per font and size, and parsed colors
export class MeasureCache {
    #ascents: Map<string, number>
    #colors: Map<string, RGBA>
    #context: CanvasRenderingContext2D | null | undefined

    constructor() {
        this.#ascents = new Map()
        this.#colors = new Map()
        this.#context = undefined
    }

    color(css: string): RGBA {
        let color = this.#colors.get(css)
        if (color) return color

        const m = css.match(RGB)
        if (m) {
            const alpha = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])
            color = toLinear(Number(m[1]), Number(m[2]), Number(m[3]), alpha * 255)
        } else {
            // oklch(), color(), …: let a canvas convert it to sRGB bytes
            this.#context ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true })
            const ctx = this.#context
            if (ctx) {
                ctx.clearRect(0, 0, 1, 1)
                ctx.fillStyle = css
                ctx.fillRect(0, 0, 1, 1)
                const d = ctx.getImageData(0, 0, 1, 1).data
                color = toLinear(d[0], d[1], d[2], d[3])
            } else {
                color = toLinear(0, 0, 0, 255)
            }
        }

        this.#colors.set(css, color)
        return color
    }

    // A text Range's rect is the font's content box, whatever the line-height, so the baseline sits a fixed
    // distance below its top. Measured, not computed from the font's tables: each OS picks its own metrics
    prepare(styles: RunStyle[]) {
        const pending = styles.filter(s => !this.#ascents.has(s.key) && s.face)
        if (pending.length) this.#probe(pending)
        for (const style of styles) style.ascent = this.#ascents.get(style.key) ?? 0
    }

    #probe(styles: RunStyle[]) {
        const root = document.createElement('div')
        root.setAttribute('aria-hidden', 'true')
        root.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;white-space:nowrap;line-height:normal;contain:layout style'

        const probes = styles.map((style) => {
            const span = document.createElement('span')
            Object.assign(span.style, style.font)
            span.style.fontSize = `${style.size}px`

            const text = document.createTextNode('H')
            // an empty inline-block sits on the baseline
            const mark = document.createElement('span')
            mark.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline'

            span.append(text, mark)
            root.append(span, document.createElement('br'))
            return { style, text, mark }
        })

        document.body.append(root)
        const range = document.createRange()

        for (const { style, text, mark } of probes) {
            range.selectNodeContents(text)
            const top = firstRect(range)?.top ?? 0
            this.#ascents.set(style.key, mark.getBoundingClientRect().top - top)
        }

        root.remove()
    }

    clear() {
        this.#ascents.clear()
        this.#colors.clear()
    }
}

function readStyle(el: Element, faces: FontPackFace[], cache: MeasureCache): RunStyle {
    const cs = getComputedStyle(el)
    const size = parseFloat(cs.fontSize)
    const weight = parseFloat(cs.fontWeight) || 400
    const style = parseStyle(cs.fontStyle)
    const families = cs.fontFamily

    return {
        key: [families, weight, style, cs.fontStretch, cs.fontVariationSettings, size].join('|'),
        face: matchFace(faces, parseFamilies(families), weight, style),
        families,
        size,
        color: cache.color(cs.color),
        transform: cs.textTransform,
        hidden: cs.visibility !== 'visible',
        font: {
            fontFamily: cs.fontFamily,
            fontWeight: cs.fontWeight,
            fontStyle: cs.fontStyle,
            fontStretch: cs.fontStretch,
            fontVariationSettings: cs.fontVariationSettings,
        },
        ascent: 0,
    }
}

export default function measure(el: HTMLElement, faces: FontPackFace[], cache: MeasureCache): MeasureResult {
    // pass 1, reads only: the text nodes and each parent's style
    const runs: { node: Text, style: RunStyle }[] = []
    const styles = new Map<Element, RunStyle>()
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)

    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
        const parent = node.parentElement
        if (!parent || !node.data.length) continue

        let style = styles.get(parent)
        if (!style) {
            style = readStyle(parent, faces, cache)
            styles.set(parent, style)
        }
        runs.push({ node, style })
    }

    // one probe write for new fonts, then pass 2 reads every rect in a single layout
    cache.prepare([...styles.values()])

    const rect = el.getBoundingClientRect()
    const result: MeasureResult = {
        glyphs: [],
        rect,
        chars: 0,
        words: 0,
        lines: 0,
        missing: new Set(),
        unmatched: new Set(),
    }

    const range = document.createRange()
    let word = -1
    let line = -1
    let charInLine = 0
    let afterSpace = true
    let lineTop = 0
    let lineBottom = 0

    for (const { node, style } of runs) {
        for (const { segment, index } of graphemes(node.data)) {
            if (INVISIBLE.test(segment)) {
                afterSpace = true
                continue
            }

            range.setStart(node, index)
            range.setEnd(node, index + segment.length)
            const r = firstRect(range)
            // collapsed, display: none, or clipped away by the layout
            if (!r) continue

            // a line starts where a glyph stops overlapping the current line box
            const overlap = Math.min(r.bottom, lineBottom) - Math.max(r.top, lineTop)
            if (line < 0 || overlap < Math.min(r.height, lineBottom - lineTop) * 0.5) {
                line++
                charInLine = 0
                lineTop = r.top
                lineBottom = r.bottom
                afterSpace = true
            } else {
                lineTop = Math.min(lineTop, r.top)
                lineBottom = Math.max(lineBottom, r.bottom)
            }

            const isWordStart = afterSpace
            if (isWordStart) word++
            afterSpace = false

            const char = result.chars++
            const inLine = charInLine++
            if (style.hidden) continue

            const { face } = style
            if (!face) {
                result.unmatched.add(style.families)
                continue
            }

            // ß → SS draws two glyphs inside one DOM character
            let x = r.left - rect.left
            const y = r.top - rect.top + style.ascent

            for (const ch of applyTransform(segment.normalize('NFC'), style.transform, isWordStart)) {
                const glyph = face.glyphs.get(ch.codePointAt(0)!)
                if (!glyph) {
                    result.missing.add(ch)
                    continue
                }

                if (glyph.locX >= 0) {
                    result.glyphs.push({ face, glyph, x, y, size: style.size, color: style.color, char, word, line, charInLine: inLine })
                }
                x += glyph.advance * style.size
            }
        }
    }

    result.words = word + 1
    result.lines = line + 1
    return result
}
