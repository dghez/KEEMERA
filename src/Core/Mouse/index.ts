import { Vector2, Vector3 } from 'three'

import { EVENTS } from '../../events'
import type { DragPayload } from '../../events'
import type { Store } from '../../types'

export default class Mouse {
    #store: Store
    #unsubscribers: (() => void)[]

    static: Vector2
    smooth: Vector2
    smoother: Vector2
    world: Vector3
    viewport: Vector3
    viewportSmooth: Vector3
    isDragging: boolean
    isHolding: boolean

    constructor({ store }: { store: Store }) {
        this.#store = store
        this.#unsubscribers = []

        this.static = new Vector2(-0, -0)
        this.smooth = new Vector2(-0, -0)
        this.smoother = new Vector2(-0, -0)
        this.world = new Vector3(-10000, -10000, -10000)
        this.viewport = new Vector3(-0, -0)
        this.viewportSmooth = new Vector3(-0, -0)
        this.isDragging = false
        this.isHolding = false

        this.#init()
    }

    #init() {
        const { uniforms } = this.#store
        uniforms.mouse.smooth.value = this.smooth
        uniforms.mouse.smoother.value = this.smoother
        this.#initEvents()
    }

    #setPosition(x: number, y: number) {
        const { viewport } = this.#store
        if (!viewport?.width || !viewport?.height) return

        this.viewport.x = x
        this.viewport.y = y

        this.static.x = (x / viewport.width) * 2 - 1
        this.static.y = -(y / viewport.height) * 2 + 1
    }

    #onMouseMove = ({ xy }: { xy: [number, number] }) => {
        const [x, y] = xy
        this.#setPosition(x, y)
    }

    #onDrag = ({ xy, active, dragging }: DragPayload) => {
        const [x, y] = xy
        this.#setPosition(x, y)

        this.isDragging = !!dragging
        this.isHolding = !!active
    }

    #initEvents() {
        const { events } = this.#store
        this.#unsubscribers.push(
            events.on(EVENTS.APP_MOUSE_MOVE, this.#onMouseMove),
            events.on(EVENTS.APP_MOUSE_DRAG, this.#onDrag),
        )
    }

    update() {
        const { scale } = this.#store.time
        this.viewportSmooth.lerp(this.viewport, 0.15 * scale)
        this.smooth.lerp(this.static, 0.090 * scale)
        this.smoother.lerp(this.static, 0.033 * scale)
    }

    destroy() {
        this.#unsubscribers.forEach(off => off())
        this.#unsubscribers = []
    }
}
