import { MoveGesture, DragGesture, Gesture } from '@use-gesture/vanilla'
import events, { EVENTS } from '@js/events'

import store from '@gl/store'

export default class Gestures {
    #gesture

    constructor({ target = window } = {}) {
        this.target = target
        this.#gesture = undefined

        this.#init()
    }

    #init() {
        const t = this.target

        const onDrag = (v) => {
            events.emit(EVENTS.APP_MOUSE_DRAG, v)
            events.emit(EVENTS.APP_MOUSE_HOLD, v.active)
        }
        const onMove = (v) => {
            events.emit(EVENTS.APP_MOUSE_MOVE, v)
        }
        const dragConfig = store.size.isTouch
            ? { filterTaps: true, pointer: { buttons: [1, 2] } }
            : { filterTaps: false, pointer: { buttons: [1, 2] }, delay: 0 }

        this.#gesture = new Gesture(t, {
            // onDrag,
            onMove,
        }, {
            drag: dragConfig,
        })
    }

    destroy() {
        this.#gesture.destroy()
    }
}
