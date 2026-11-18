import {
    BufferAttribute,
    InstancedBufferAttribute,
    InstancedBufferGeometry,
    IntType,
    Mesh,
    ShaderMaterial,
} from 'three'
import type { IUniform } from 'three'

import { fragmentShader, vertexShader } from './shaders'
import type FontPack from '../../resources/font'
import type { PlacedGlyph } from './measure'

// one quad per glyph, corners in 0..1
const QUAD = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0])
const QUAD_INDEX = [0, 1, 2, 2, 1, 3]

const MIN_CAPACITY = 256

interface Range {
    start: number
    capacity: number
}

interface Arrays {
    pen: Float32Array
    box: Float32Array
    glyph: Uint16Array
    // linear rgb + alpha, decoded once per CSS color on the CPU
    color: Uint16Array
    index: Uint16Array
}

type Attributes = { [K in keyof Arrays]: InstancedBufferAttribute }

const ITEM_SIZE = 4
const KEYS = ['pen', 'box', 'glyph', 'color', 'index'] as const

const createArrays = (capacity: number): Arrays => ({
    pen: new Float32Array(capacity * ITEM_SIZE),
    box: new Float32Array(capacity * ITEM_SIZE),
    glyph: new Uint16Array(capacity * ITEM_SIZE),
    color: new Uint16Array(capacity * ITEM_SIZE),
    index: new Uint16Array(capacity * ITEM_SIZE),
})

export interface FaceBatchProps {
    pack: FontPack
    uniforms: Record<string, IUniform>
    wireframe?: boolean
}

// Every glyph of one font pack, for every block of a layer: one instanced draw.
// Each block owns a range with headroom, so a re-measure that fits rewrites only its own slots
export default class FaceBatch {
    #ranges: Map<object, Range>
    #capacity: number
    #cursor: number
    #arrays: Arrays
    #attributes: Attributes | undefined

    pack: FontPack
    material: ShaderMaterial
    mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>

    constructor({ pack, uniforms, wireframe = false }: FaceBatchProps) {
        this.pack = pack
        this.#ranges = new Map()
        this.#capacity = MIN_CAPACITY
        this.#cursor = 0
        this.#arrays = createArrays(this.#capacity)
        this.#attributes = undefined

        this.material = new ShaderMaterial({
            // no glslVersion: three still compiles #version 300 es and declares gl_FragColor for its chunks
            vertexShader,
            fragmentShader,
            uniforms: {
                ...uniforms,
                uCurves: { value: pack.curveTexture },
                uBands: { value: pack.bandTexture },
            },
            transparent: true,
            depthWrite: false,
            premultipliedAlpha: true,
            toneMapped: false,
            clipping: true,
        })
        this.wireframe = wireframe

        this.mesh = new Mesh(this.#createGeometry(), this.material)
        // glyphs are placed in the vertex shader, the quad's own bounds mean nothing
        this.mesh.frustumCulled = false
        this.mesh.visible = false
    }

    #createGeometry() {
        const geometry = new InstancedBufferGeometry()
        geometry.setAttribute('position', new BufferAttribute(QUAD, 3))
        geometry.setIndex(QUAD_INDEX)

        const { pen, box, glyph, color, index } = this.#arrays
        const glyphAttribute = new InstancedBufferAttribute(glyph, ITEM_SIZE)
        // read as uvec4: band texture coordinates and band counts
        glyphAttribute.gpuType = IntType

        this.#attributes = {
            pen: new InstancedBufferAttribute(pen, ITEM_SIZE),
            box: new InstancedBufferAttribute(box, ITEM_SIZE),
            glyph: glyphAttribute,
            color: new InstancedBufferAttribute(color, ITEM_SIZE, true),
            index: new InstancedBufferAttribute(index, ITEM_SIZE),
        }

        geometry.setAttribute('aPen', this.#attributes.pen)
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

    // all of a block's glyphs in this pack, pens offset by the block's document position
    write(owner: object, glyphs: PlacedGlyph[], docX: number, docY: number) {
        const range = this.#reserve(owner, glyphs.length)
        const { pen, box, glyph: data, color, index } = this.#arrays

        for (let i = 0; i < range.capacity; i++) {
            const o = (range.start + i) * ITEM_SIZE
            const g = glyphs[i]

            if (!g) {
                pen.fill(0, o, o + ITEM_SIZE)
                continue
            }

            pen[o] = docX + g.x
            pen[o + 1] = docY + g.y
            pen[o + 2] = g.size
            pen[o + 3] = 0

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

    // the block moved in the document: only its pens change
    move(owner: object, glyphs: PlacedGlyph[], docX: number, docY: number) {
        const range = this.#ranges.get(owner)
        if (!range) return

        const { pen } = this.#arrays
        for (let i = 0; i < glyphs.length; i++) {
            const o = (range.start + i) * ITEM_SIZE
            pen[o] = docX + glyphs[i].x
            pen[o + 1] = docY + glyphs[i].y
        }
        this.#markDirty(['pen'], range)
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

    get wireframe() {
        return 'KEEMERA_TEXT_WIREFRAME' in this.material.defines
    }

    set wireframe(value: boolean) {
        if (value === this.wireframe) return
        this.material.defines = value ? { KEEMERA_TEXT_WIREFRAME: '' } : {}
        this.material.needsUpdate = true
    }

    destroy() {
        this.mesh.removeFromParent()
        this.mesh.geometry.dispose()
        this.material.dispose()
        this.#ranges.clear()
    }
}
