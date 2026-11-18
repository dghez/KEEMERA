import {
    BufferAttribute,
    InstancedBufferAttribute,
    InstancedBufferGeometry,
    IntType,
    Mesh,
} from 'three'
import type { IUniform, Material } from 'three'

import deriveTextMaterial from './material'
import type { TextMaterial } from './material'
import type FontPack from '../../resources/font'
import type { PlacedGlyph } from './measure'

// one quad per glyph, corners in 0..1, facing the camera for lit materials
const QUAD = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0])
const QUAD_NORMAL = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1])
const QUAD_INDEX = [0, 1, 2, 2, 1, 3]

// a block's document rect, css px
export interface BlockRect {
    x: number
    y: number
    width: number
    height: number
}

const MIN_CAPACITY = 256

interface Range {
    start: number
    capacity: number
}

interface Arrays {
    // pen relative to the block, font size
    pen: Float32Array
    // the block's document rect: moving a block rewrites only this
    block: Float32Array
    // word center x, line center x and y, relative to the block
    anchor: Float32Array
    box: Float32Array
    glyph: Uint16Array
    // linear rgb + alpha, decoded once per CSS color on the CPU
    color: Uint16Array
    index: Uint16Array
}

type Attributes = { [K in keyof Arrays]: InstancedBufferAttribute }

const ITEM_SIZE = 4
const KEYS = ['pen', 'block', 'anchor', 'box', 'glyph', 'color', 'index'] as const

const createArrays = (capacity: number): Arrays => ({
    pen: new Float32Array(capacity * ITEM_SIZE),
    block: new Float32Array(capacity * ITEM_SIZE),
    anchor: new Float32Array(capacity * ITEM_SIZE),
    box: new Float32Array(capacity * ITEM_SIZE),
    glyph: new Uint16Array(capacity * ITEM_SIZE),
    color: new Uint16Array(capacity * ITEM_SIZE),
    index: new Uint16Array(capacity * ITEM_SIZE),
})

export interface FaceBatchProps {
    pack: FontPack
    // the user's material (or the layer's default): the batch draws with a text version of it
    material: Material
    uniforms: Record<string, IUniform>
    wireframe?: boolean
}

// Every glyph of one font pack and one material, for every block of a layer: one instanced draw.
// Each block owns a range with headroom, so a re-measure that fits rewrites only its own slots
export default class FaceBatch {
    #ranges: Map<object, Range>
    #capacity: number
    #cursor: number
    #arrays: Arrays
    #attributes: Attributes | undefined

    pack: FontPack
    baseMaterial: Material
    material: TextMaterial
    mesh: Mesh<InstancedBufferGeometry, TextMaterial>

    constructor({ pack, material, uniforms, wireframe = false }: FaceBatchProps) {
        this.pack = pack
        this.#ranges = new Map()
        this.#capacity = MIN_CAPACITY
        this.#cursor = 0
        this.#arrays = createArrays(this.#capacity)
        this.#attributes = undefined

        this.baseMaterial = material
        this.material = deriveTextMaterial(material, {
            ...uniforms,
            uKeemeraCurves: { value: pack.curveTexture },
            uKeemeraBands: { value: pack.bandTexture },
        })
        this.material.keemeraWireframe = wireframe

        this.mesh = new Mesh(this.#createGeometry(), this.material)
        // glyphs are placed in the vertex shader, the quad's own bounds mean nothing
        this.mesh.frustumCulled = false
        this.mesh.visible = false
    }

    #createGeometry() {
        const geometry = new InstancedBufferGeometry()
        geometry.setAttribute('position', new BufferAttribute(QUAD, 3))
        geometry.setAttribute('normal', new BufferAttribute(QUAD_NORMAL, 3))
        geometry.setIndex(QUAD_INDEX)

        const { pen, block, anchor, box, glyph, color, index } = this.#arrays
        const glyphAttribute = new InstancedBufferAttribute(glyph, ITEM_SIZE)
        // read as uvec4: band texture coordinates and band counts
        glyphAttribute.gpuType = IntType

        this.#attributes = {
            pen: new InstancedBufferAttribute(pen, ITEM_SIZE),
            block: new InstancedBufferAttribute(block, ITEM_SIZE),
            anchor: new InstancedBufferAttribute(anchor, ITEM_SIZE),
            box: new InstancedBufferAttribute(box, ITEM_SIZE),
            glyph: glyphAttribute,
            color: new InstancedBufferAttribute(color, ITEM_SIZE, true),
            index: new InstancedBufferAttribute(index, ITEM_SIZE),
        }

        geometry.setAttribute('aPen', this.#attributes.pen)
        geometry.setAttribute('aBlock', this.#attributes.block)
        geometry.setAttribute('aAnchor', this.#attributes.anchor)
        geometry.setAttribute('aBox', this.#attributes.box)
        geometry.setAttribute('aGlyph', this.#attributes.glyph)
        geometry.setAttribute('aColor', this.#attributes.color)
        geometry.setAttribute('aIndex', this.#attributes.index)
        geometry.instanceCount = this.#cursor

        return geometry
    }

    #markDirty(keys: readonly (keyof Arrays)[], range: Range) {
        for (const key of keys) {
            const attribute = this.#attributes![key]
            attribute.addUpdateRange(range.start * ITEM_SIZE, range.capacity * ITEM_SIZE)
            attribute.needsUpdate = true
        }
    }

    // size 0 collapses a slot in the vertex shader
    #collapse(range: Range) {
        this.#arrays.pen.fill(0, range.start * ITEM_SIZE, (range.start + range.capacity) * ITEM_SIZE)
        this.#markDirty(['pen'], range)
    }

    // packs the other blocks' ranges to the front of bigger buffers, then makes room for `capacity` more
    #grow(owner: object, capacity: number) {
        const others = [...this.#ranges].filter(([key]) => key !== owner)
        const needed = others.reduce((sum, [, r]) => sum + r.capacity, 0) + capacity

        let size = Math.max(MIN_CAPACITY, this.#capacity)
        while (size < needed * 1.5) size *= 2

        const old = this.#arrays
        const next = createArrays(size)
        let cursor = 0

        for (const [key, range] of others) {
            const from = range.start * ITEM_SIZE
            const to = from + range.capacity * ITEM_SIZE
            for (const name of KEYS) next[name].set(old[name].subarray(from, to), cursor * ITEM_SIZE)
            this.#ranges.set(key, { start: cursor, capacity: range.capacity })
            cursor += range.capacity
        }
        this.#ranges.delete(owner)

        this.#arrays = next
        this.#capacity = size
        this.#cursor = cursor

        // GL buffers can't grow: a new geometry, and the old one's buffers are freed
        const previous = this.mesh.geometry
        this.mesh.geometry = this.#createGeometry()
        previous.dispose()
    }

    #reserve(owner: object, count: number) {
        const current = this.#ranges.get(owner)
        if (current && count <= current.capacity) return current

        if (current) {
            this.#collapse(current)
            this.#ranges.delete(owner)
        }

        const capacity = Math.ceil(count * 1.25) + 4
        if (this.#cursor + capacity > this.#capacity) this.#grow(owner, capacity)

        const range = { start: this.#cursor, capacity }
        this.#cursor += capacity
        this.#ranges.set(owner, range)
        this.mesh.geometry.instanceCount = this.#cursor
        return range
    }

    #fillBlock(range: Range, rect: BlockRect) {
        const { block } = this.#arrays
        for (let i = 0; i < range.capacity; i++) {
            const o = (range.start + i) * ITEM_SIZE
            block[o] = rect.x
            block[o + 1] = rect.y
            block[o + 2] = rect.width
            block[o + 3] = rect.height
        }
    }

    // all of a block's glyphs in this pack, pens relative to the block
    write(owner: object, glyphs: PlacedGlyph[], rect: BlockRect) {
        const range = this.#reserve(owner, glyphs.length)
        const { pen, anchor, box, glyph: data, color, index } = this.#arrays
        this.#fillBlock(range, rect)

        for (let i = 0; i < range.capacity; i++) {
            const o = (range.start + i) * ITEM_SIZE
            const g = glyphs[i]

            if (!g) {
                pen.fill(0, o, o + ITEM_SIZE)
                continue
            }

            pen[o] = g.x
            pen[o + 1] = g.y
            pen[o + 2] = g.size
            pen[o + 3] = 0

            anchor[o] = g.wordX
            anchor[o + 1] = g.lineX
            anchor[o + 2] = g.lineY
            anchor[o + 3] = 0

            const { glyph } = g
            box[o] = glyph.x0
            box[o + 1] = glyph.y0
            box[o + 2] = glyph.x1
            box[o + 3] = glyph.y1

            data[o] = glyph.locX
            data[o + 1] = glyph.locY
            data[o + 2] = glyph.bandMaxX
            data[o + 3] = glyph.bandMaxY

            color.set(g.color, o)

            index[o] = g.char
            index[o + 1] = g.word
            index[o + 2] = g.line
            index[o + 3] = g.charInLine
        }

        this.#markDirty(KEYS, range)
        this.mesh.visible = true
    }

    // the block moved in the document: only its rect changes
    move(owner: object, rect: BlockRect) {
        const range = this.#ranges.get(owner)
        if (!range) return

        this.#fillBlock(range, rect)
        this.#markDirty(['block'], range)
    }

    release(owner: object) {
        const range = this.#ranges.get(owner)
        if (!range) return

        this.#collapse(range)
        this.#ranges.delete(owner)
        if (!this.#ranges.size) {
            this.#cursor = 0
            this.mesh.geometry.instanceCount = 0
            this.mesh.visible = false
        }
    }

    get isEmpty() {
        return !this.#ranges.size
    }

    get wireframe() {
        return this.material.keemeraWireframe
    }

    set wireframe(value: boolean) {
        this.material.keemeraWireframe = value
    }

    // the text version only: the base material is the user's
    destroy() {
        this.mesh.removeFromParent()
        this.mesh.geometry.dispose()
        this.material.dispose()
        this.#ranges.clear()
    }
}
