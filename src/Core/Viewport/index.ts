import { EVENTS } from '../../events'
import type { Store } from '../../types'

export interface ScrollState {
    y: number
    delta: number
}

export default class Viewport {
    #store: Store
    #touchQuery: MediaQueryList

    breakpoint: number
    width: number
    height: number
    dpr: number
    isMobile: boolean
    isTouch: boolean
    scroll: ScrollState

    constructor({ store, breakpoint = 650 }: { store: Store, breakpoint?: number }) {
        this.#store = store
        this.breakpoint = breakpoint

        this.width = 0
        this.height = 0
        this.dpr = 1
        this.isMobile = false
        this.isTouch = false

        this.scroll = { y: 0, delta: 0 }

        this.#touchQuery = window.matchMedia('(hover: hover) and (pointer: fine)')
        this.isTouch = !this.#touchQuery.matches
    }

    setSize(w: number, h: number, dpr = this.dpr) {
        this.width = w
        this.height = h
        this.dpr = dpr

        this.isMobile = w < this.breakpoint
        this.isTouch = !this.#touchQuery.matches

        this.#store.uniforms.resolution.value.set(w, h, dpr)
    }

    setScroll(y: number) {
        this.scroll.delta = y - this.scroll.y
        this.scroll.y = y

        this.#store.events.emit(EVENTS.APP_SCROLL, this.scroll)
    }
}
