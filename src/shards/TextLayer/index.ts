import { Group, MeshBasicMaterial } from 'three'
import type { Material } from 'three'

import FaceBatch from './FaceBatch'
import TextBlock, { BLOCK_ATTRIBUTE } from './TextBlock'
import measure, { MeasureCache } from './measure'
import { assertTextMaterial } from './material'
import { qs } from '../../utils/dom'
import requireStore from '../../utils/requireStore'
import type FontPack from '../../resources/font'
import type { FontPackFace } from '../../resources/font'
import type { TextBlockOptions } from './TextBlock'
import type { Store } from '../../types'

export interface TextLayerProps {
    store: Store
    // font packs to draw with; default: every `font` asset loaded in store.resources
    fonts?: FontPack[]
    // hide the DOM copy once the GPU draws it; default true
    hideDom?: boolean
    // debug: tint the DOM copy red over the GPU copy, any drift shows as a fringe; default false
    compare?: boolean
    // debug: draw each glyph's ink box as a 1px outline instead of the glyph; default false, also `layer.wireframe`
    wireframe?: boolean
    // ms of measuring per frame, at least one element always goes; default 4
    budget?: number
    // the material every element draws with unless it has its own (track(el, { material })); default: unlit, the DOM color
    material?: Material
}

const COMPARE_FILL = 'rgba(255, 0, 0, 0.6)'

const describe = (el: HTMLElement) => {
    const id = el.id ? `#${el.id}` : ''
    const cls = el.classList.length ? `.${[...el.classList].slice(0, 2).join('.')}` : ''
    return `<${el.tagName.toLowerCase()}${id}${cls}>`
}

const isFontPack = <T>(asset: T): asset is T & FontPack => !!asset && typeof asset === 'object' && 'isFontPack' in asset

// DOM text drawn on the GPU from the fonts' outlines (Slug), at the positions the browser laid it out.
// One instanced draw per font pack and material for every element added; scrolling moves one transform.
// Positions are in CSS pixels from the canvas center: needs a pixel-matched camera (`camera: { useDomSize: true }`)
export default class TextLayer extends Group {
    #store: Store
    #props: TextLayerProps
    #blocks: Map<HTMLElement, TextBlock>
    #dirty: Set<TextBlock>
    // one draw per font pack and material
    #batches: Map<FontPack, Map<Material, FaceBatch>>
    #material: Material
    #defaultMaterial: MeshBasicMaterial | undefined
    // holds the batches: scroll and the viewport offset are its transform, the layer's own stays free
    #content: Group
    #live: TextBlock[]
    #wireframe: boolean
    #cache: MeasureCache
    #warnings: Set<string>
    #rectsStale: boolean
    #resizeObserver: ResizeObserver | undefined
    #pageObserver: ResizeObserver | undefined
    #mutationObserver: MutationObserver | undefined
    #selectionStyle: HTMLStyleElement | undefined

    uniforms: {
        uKeemeraDpr: { value: number }
    }

    constructor(props: TextLayerProps) {
        super()
        this.#store = requireStore(props.store, new.target.name)
        this.#props = props
        this.#blocks = new Map()
        this.#dirty = new Set()
        this.#batches = new Map()
        this.#defaultMaterial = undefined
        assertTextMaterial(props.material)
        this.#material = props.material ?? this.#createDefaultMaterial()
        this.#content = new Group()
        this.#live = []
        this.#wireframe = props.wireframe ?? false
        this.#cache = new MeasureCache()
        this.#warnings = new Set()
        this.#rectsStale = false
        this.#resizeObserver = undefined
        this.#pageObserver = undefined
        this.#mutationObserver = undefined
        this.#selectionStyle = undefined

        this.uniforms = {
            uKeemeraDpr: { value: 1 },
        }

        this.#init()
    }

    // the default material: draws the DOM color, unlit, like the DOM
    #createDefaultMaterial() {
        this.#defaultMaterial ??= new MeshBasicMaterial({
            transparent: true,
            depthWrite: false,
            premultipliedAlpha: true,
            toneMapped: false,
        })
        return this.#defaultMaterial
    }

    // the material of every element without its own; changing it re-draws them
    get material() {
        return this.#material
    }

    set material(value: Material | undefined) {
        assertTextMaterial(value)
        const next = value ?? this.#createDefaultMaterial()
        if (next === this.#material) return
        this.#material = next
        for (const block of this.#blocks.values()) {
            if (!block.material) this.#dirty.add(block)
        }
    }

    get wireframe() {
        return this.#wireframe
    }

    // a define, not a uniform: the normal path carries no debug branch. Toggling recompiles once
    set wireframe(value: boolean) {
        this.#wireframe = value
        for (const batch of this.#eachBatch()) batch.wireframe = value
    }

    get blocks() {
        return [...this.#blocks.values()]
    }

    #init() {
        this.add(this.#content)
        this.resize()

        // an element resizing reflows its own lines
        this.#resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const block = this.#blocks.get(entry.target as HTMLElement)
                if (block) this.#dirty.add(block)
            }
        })

        // the page's size changing can move any element without resizing it
        this.#pageObserver = new ResizeObserver(() => { this.#rectsStale = true })
        this.#pageObserver.observe(document.documentElement)

        // new text, edits
        this.#mutationObserver = new MutationObserver((records) => {
            for (const record of records) {
                const block = this.#blockOf(record.target)
                if (block) this.#dirty.add(block)
            }
        })

        // a face swapping in moves every advance
        document.fonts?.addEventListener('loadingdone', this.#onFontsLoaded)

        // the DOM copy is transparent: let selected text show its ink over the highlight
        this.#selectionStyle = document.createElement('style')
        this.#selectionStyle.textContent = `[${BLOCK_ATTRIBUTE}]::selection, [${BLOCK_ATTRIBUTE}] ::selection { -webkit-text-fill-color: currentColor; }`
        document.head.append(this.#selectionStyle)
    }

    #onFontsLoaded = () => {
        this.#cache.clear()
        this.invalidate()
    }

    #blockOf(node: Node | null) {
        for (let n = node; n; n = n.parentNode) {
            const block = this.#blocks.get(n as HTMLElement)
            if (block) return block
        }
        return undefined
    }

    #warnOnce(message: string) {
        if (this.#warnings.has(message)) return
        this.#warnings.add(message)
        console.warn(message)
    }

    #faces(): FontPackFace[] {
        const packs = this.#props.fonts ?? [...this.#store.resources.getAll().values()].filter(isFontPack)
        return packs.flatMap(pack => pack.faces)
    }

    * #eachBatch() {
        for (const byMaterial of this.#batches.values()) yield * byMaterial.values()
    }

    #batch(pack: FontPack, material: Material) {
        let byMaterial = this.#batches.get(pack)
        if (!byMaterial) {
            byMaterial = new Map()
            this.#batches.set(pack, byMaterial)
        }

        let batch = byMaterial.get(material)
        if (!batch) {
            batch = new FaceBatch({ pack, material, uniforms: this.uniforms, wireframe: this.#wireframe })
            byMaterial.set(material, batch)
            this.#content.add(batch.mesh)
        }
        return batch
    }

    // a batch nobody draws in any more: its mesh, buffers and text material go
    #prune() {
        for (const [pack, byMaterial] of this.#batches) {
            for (const [material, batch] of byMaterial) {
                if (!batch.isEmpty) continue
                batch.destroy()
                byMaterial.delete(material)
            }
            if (!byMaterial.size) this.#batches.delete(pack)
        }
    }

    #release(block: TextBlock) {
        for (const batch of this.#eachBatch()) batch.release(block)
        this.#prune()
        block.isDrawn = false
    }

    #measure(block: TextBlock, faces: FontPackFace[]) {
        const { hideDom = true, compare = false } = this.#props
        const result = measure(block.el, faces, this.#cache)
        block.apply(result, this.#store.viewport.scroll.y)

        // a hole in the text reads as a bug: leave the whole element to the DOM instead
        if (result.missing.size || result.unmatched.size) {
            const reasons = [
                result.missing.size ? `characters missing from the font packs: ${[...result.missing].join(' ')}` : '',
                result.unmatched.size ? `no baked face for font-family ${[...result.unmatched].join(' / ')}` : '',
            ].filter(Boolean).join('; ')
            this.#warnOnce(`[Keemera] TextLayer: ${describe(block.el)} stays in the DOM (${reasons}). Bake them with keemera-font --chars / another input`)
            this.#release(block)
            block.showDom()
            return
        }

        const material = block.material ?? this.#material
        for (const batch of this.#eachBatch()) {
            if (batch.baseMaterial !== material || !block.groups.has(batch.pack)) batch.release(block)
        }
        for (const [pack, glyphs] of block.groups) {
            this.#batch(pack, material).write(block, glyphs, block.doc)
        }
        this.#prune()

        block.isDrawn = true
        // hidden only after a successful measure, so a cold font never flashes empty
        if (compare) block.hideDom(COMPARE_FILL)
        else if (hideDom) block.hideDom()
    }

    #measureDirty() {
        // measuring against a fallback font would place every glyph wrong; loadingdone re-measures
        if (document.fonts?.status === 'loading') return

        const faces = this.#faces()
        if (!faces.length) {
            this.#warnOnce('[Keemera] TextLayer has no fonts. Load a .kfont first: { key, type: \'font\', path }, or pass `fonts`')
            return
        }

        const budget = this.#props.budget ?? 4
        const start = performance.now()

        for (const block of this.#dirty) {
            this.#dirty.delete(block)
            this.#measure(block, faces)
            if (performance.now() - start > budget) break
        }
    }

    // reads every rect first, then writes: one layout
    #refreshRects(blocks: TextBlock[]) {
        const scrollY = this.#store.viewport.scroll.y
        const rects = blocks.map(block => block.el.getBoundingClientRect())

        for (let i = 0; i < blocks.length; i++) {
            const block = blocks[i]
            const { doc } = block
            const x = rects[i].left
            const y = rects[i].top + scrollY
            if (x === doc.x && y === doc.y && rects[i].width === doc.width && rects[i].height === doc.height) continue

            doc.x = x
            doc.y = y
            doc.width = rects[i].width
            doc.height = rects[i].height
            if (!block.isDrawn) continue
            const material = block.material ?? this.#material
            for (const pack of block.groups.keys()) this.#batches.get(pack)?.get(material)?.move(block, doc)
        }
    }

    // start drawing an element's text; returns its block. Tracking it again with another `material` swaps it
    track(target: string | HTMLElement, options?: TextBlockOptions) {
        const el = typeof target === 'string' ? qs(target) : target
        if (!el) throw new Error(`[Keemera] TextLayer.track: no element found for "${target}"`)

        assertTextMaterial(options?.material)

        const existing = this.#blocks.get(el)
        if (existing) {
            if (options && 'material' in options && options.material !== existing.material) {
                existing.material = options.material
                this.#dirty.add(existing)
            }
            return existing
        }

        const block = new TextBlock(el, options)
        this.#blocks.set(el, block)
        if (block.live) this.#live.push(block)
        this.#resizeObserver!.observe(el)
        this.#mutationObserver!.observe(el, { subtree: true, childList: true, characterData: true })
        this.#dirty.add(block)
        return block
    }

    // stop drawing an element and give its text back to the DOM
    untrack(target: string | HTMLElement) {
        const el = typeof target === 'string' ? qs(target) : target
        const block = el && this.#blocks.get(el)
        if (!block) return

        this.#release(block)
        block.destroy()
        this.#blocks.delete(block.el)
        this.#live = this.#live.filter(b => b !== block)
        this.#dirty.delete(block)
        this.#resizeObserver?.unobserve(block.el)

        // a MutationObserver can't drop one target: observe the others again
        this.#mutationObserver?.disconnect()
        for (const other of this.#blocks.keys()) {
            this.#mutationObserver?.observe(other, { subtree: true, childList: true, characterData: true })
        }
    }

    // measure every element again, e.g. after changing styles the observers can't see
    invalidate() {
        for (const block of this.#blocks.values()) this.#dirty.add(block)
    }

    // per frame: one number for scroll; DOM reads only for live blocks, a stale page or dirty blocks
    update() {
        const { viewport } = this.#store
        // glyphs sit in document px, y down: the content shifts up as the page scrolls
        this.#content.position.y = viewport.height * 0.5 + viewport.scroll.y

        if (this.#rectsStale) {
            this.#rectsStale = false
            this.#refreshRects(this.blocks)
        } else if (this.#live.length) {
            this.#refreshRects(this.#live)
        }

        if (this.#dirty.size) this.#measureDirty()
    }

    resize() {
        const { viewport } = this.#store
        this.#content.position.x = -viewport.width * 0.5
        this.#content.position.y = viewport.height * 0.5 + viewport.scroll.y
        this.uniforms.uKeemeraDpr.value = viewport.dpr
        this.#rectsStale = true
    }

    destroy() {
        document.fonts?.removeEventListener('loadingdone', this.#onFontsLoaded)
        this.#resizeObserver?.disconnect()
        this.#pageObserver?.disconnect()
        this.#mutationObserver?.disconnect()
        this.#selectionStyle?.remove()

        for (const block of this.#blocks.values()) block.destroy()
        for (const batch of this.#eachBatch()) batch.destroy()
        // the user's materials are theirs
        this.#defaultMaterial?.dispose()

        this.#content.removeFromParent()
        this.#blocks.clear()
        this.#live = []
        this.#dirty.clear()
        this.#batches.clear()
        this.#cache.clear()
    }
}

export type { TextBlock, TextBlockOptions }
