import type FontPack from '../../resources/font'
import type { MeasureResult, PlacedGlyph } from './measure'

export interface TextBlockOptions {
    // read the element's rect every frame: for elements that move without the page reflowing (CSS sticky, transforms)
    live?: boolean
}

// marks tracked elements for the layer's ::selection rule
export const BLOCK_ATTRIBUTE = 'data-keemera-text'

interface SavedStyle {
    value: string
    priority: string
}

// One tracked element: where it sits in the document, its glyphs per font pack, and its DOM copy's styles
export default class TextBlock {
    #saved: Map<string, SavedStyle>

    readonly el: HTMLElement
    readonly live: boolean
    // document position of the element's top-left, css px
    doc: { x: number, y: number }
    groups: Map<FontPack, PlacedGlyph[]>
    // drawn by the GPU; false while waiting for a measure, or when it's left to the DOM
    isDrawn: boolean
    glyphCount: number
    chars: number
    words: number
    lines: number
    // characters the font packs can't draw: the block stays in the DOM
    missing: string[]

    constructor(el: HTMLElement, { live = false }: TextBlockOptions = {}) {
        this.#saved = new Map()

        this.el = el
        this.live = live
        this.doc = { x: 0, y: 0 }
        this.groups = new Map()
        this.isDrawn = false
        this.glyphCount = 0
        this.chars = 0
        this.words = 0
        this.lines = 0
        this.missing = []

        this.#init()
    }

    #init() {
        this.el.setAttribute(BLOCK_ATTRIBUTE, '')
        // the GPU draws one glyph per character: ligatures would make the DOM's advances disagree
        this.#setStyle('font-variant-ligatures', 'none')
    }

    #setStyle(property: string, value: string) {
        const { style } = this.el
        if (!this.#saved.has(property)) {
            this.#saved.set(property, { value: style.getPropertyValue(property), priority: style.getPropertyPriority(property) })
        }
        style.setProperty(property, value, 'important')
    }

    #restoreStyle(property: string) {
        const saved = this.#saved.get(property)
        if (!saved) return

        const { style } = this.el
        if (saved.value) style.setProperty(property, saved.value, saved.priority)
        else style.removeProperty(property)
        this.#saved.delete(property)
    }

    apply(result: MeasureResult, scrollY: number) {
        this.doc.x = result.rect.left
        this.doc.y = result.rect.top + scrollY
        this.chars = result.chars
        this.words = result.words
        this.lines = result.lines
        this.missing = [...result.missing]
        this.glyphCount = result.glyphs.length

        this.groups = new Map()
        for (const glyph of result.glyphs) {
            const { pack } = glyph.face
            let list = this.groups.get(pack)
            if (!list) {
                list = []
                this.groups.set(pack, list)
            }
            list.push(glyph)
        }
    }

    // -webkit-text-fill-color hides the ink and leaves `color`, selection and hit testing alone
    hideDom(fill = 'transparent') {
        this.#setStyle('-webkit-text-fill-color', fill)
    }

    showDom() {
        this.#restoreStyle('-webkit-text-fill-color')
    }

    destroy() {
        this.showDom()
        this.#restoreStyle('font-variant-ligatures')
        this.el.removeAttribute(BLOCK_ATTRIBUTE)
        this.groups.clear()
    }
}
