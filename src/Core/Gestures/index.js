import { Gesture } from '@use-gesture/vanilla'

import { EVENTS } from '../../events'

export default class Gestures {
    #store
    #gesture

    constructor({ store, target = window } = {}) {
        this.#store = store
        this.target = target
        this.#gesture = undefined

        this.#init()
    }

    #init() {
        const { events, viewport } = this.#store

        const onDrag = ({ xy, active, dragging }) => {
            events.emit(EVENTS.APP_MOUSE_DRAG, { xy, active, dragging })
            events.emit(EVENTS.APP_MOUSE_HOLD, active)
        }
        const onMove = ({ xy }) => {
            events.emit(EVENTS.APP_MOUSE_MOVE, { xy })
        }
        const dragConfig = viewport.isTouch
            ? { filterTaps: true, pointer: { buttons: [1, 2] } }
            : { filterTaps: false, pointer: { buttons: [1, 2] }, delay: 0 }

        this.#gesture = new Gesture(this.target, { onDrag, onMove }, { drag: dragConfig })
    }

    destroy() {
        this.#gesture?.destroy()
        this.#gesture = undefined
    }
}
