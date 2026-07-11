import { Vector2, Vector3 } from "three"

import events, { EVENTS } from "@js/events"
import store from "@gl/store"

const V2 = new Vector2()
const V3 = new Vector3()

export default class Mouse {
    constructor() {
        this.static = V2.clone().set(-0, -0),
        this.smooth = V2.clone().set(-0, -0),
        this.smoother = V2.clone().set(-0, -0),
        this.world = V3.clone().set(-10000, -10000, -10000),
        this.viewport = V3.clone().set(-0, -0)
        this.viewportSmooth = V3.clone().set(-0, -0)
        this.isDragging = false
        this.isHolding = false

        this.#init()
    }

    #init() {
        store.helpers.uniforms.mouse.smooth.value = this.smooth
        store.helpers.uniforms.mouse.smoother.value = this.smoother
        this.#initEvents()
    }

    #onMouseMove = (v) => {
        if (!store.size) return
        const [x, y] = v.xy

        this.viewport.x = x
        this.viewport.y = y

        this.static.x = (x / store.size.width) * 2 - 1
        this.static.y = -(y / store.size.height) * 2 + 1
    }

    #onDrag = (v) => {
        if (!store.size) return

        const [x, y] = v.xy

        this.viewport.x = x
        this.viewport.y = y

        this.static.x = (x / store.size.width) * 2 - 1
        this.static.y = -(y / store.size.height) * 2 + 1

        this.isDragging = v.dragging
        this.isHolding = v.active
    }

    #initEvents() {
        events.on(EVENTS.APP_MOUSE_MOVE, this.#onMouseMove)
        events.on(EVENTS.APP_MOUSE_DRAG, this.#onDrag)
    }

    update() {
        this.viewportSmooth.lerp(this.viewport, 0.15 * store.time.scale)
        this.smooth.lerp(this.static, 0.090 * store.time.scale)
        this.smoother.lerp(this.static, 0.033 * store.time.scale)
    }
}

const mouse = new Mouse()
export { mouse }
