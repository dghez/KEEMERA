import { Group } from 'three'

import { rect, qs, clamp } from '../../utils/dom'
import requireStore from '../../utils/requireStore'

const STICKY_DEFAULTS = {
    start: 'top top',
    end: 'bottom bottom',
}

function getEdge(r, edge) {
    if (edge === 'center') return r.top + r.height * 0.5
    if (edge === 'top' || edge === 'bottom') return r[edge]
    throw new Error(`Invalid trigger edge: ${edge}`)
}

function parseViewportOffset(part, viewportHeight) {
    const m = part.match(/^(top|center|bottom)(([+-])=)?(\d*\.?\d+)?(%)?$/)
    if (!m) throw new Error(`Invalid scroll position: ${part}`)

    const [, edge, , sign, num, isPercent] = m
    let offset = edge === 'top' ? 0 : edge === 'center' ? viewportHeight * 0.5 : viewportHeight

    if (sign && num) {
        const value = parseFloat(num)
        const delta = isPercent ? viewportHeight * (value / 100) : value
        offset = sign === '+' ? offset + delta : offset - delta
    }

    return offset
}

function scrollAtPosition(el, position, scrollY, viewportHeight) {
    const [triggerPart, viewportPart] = position.trim().split(/\s+/)
    const r = el.getBoundingClientRect()
    return getEdge(r, triggerPart) + scrollY - parseViewportOffset(viewportPart, viewportHeight)
}

// Positions are in CSS pixels from the canvas center: needs a pixel-matched camera (`camera: { useDomSize: true }`)
export default class Tracker extends Group {
    #props
    #store

    #tracker
    #intersectionObserver
    #resizeObserver
    #stickyTrigger
    #stickyConfig
    #stickyStart
    #stickyEnd

    constructor(props = {}) {
        super()
        this.#props = props
        this.#store = requireStore(props.store, new.target.name)
        this.#tracker = undefined
        this.#intersectionObserver = undefined
        this.#resizeObserver = undefined

        this.#stickyTrigger = undefined
        this.#stickyConfig = null
        this.#stickyStart = 0
        this.#stickyEnd = 0

        this.el = undefined

        this.trackPosition = { x: 0, y: 0, z: 0 }
        this.trackSize = { w: 0, h: 0 }
        this.rect = { width: 0, height: 0, left: 0, top: 0 }
        this.offset = { x: 0, y: 0 }

        this.preventUpdatePosition = props.preventUpdatePosition ?? false
        this.preventUpdateScale = props.preventUpdateScale ?? true

        this.isActive = false
        this.stickyProgress = 0

        this.#init()
    }

    #normalizeSticky(sticky) {
        if (!sticky) return null

        const config = typeof sticky === 'string' ? { container: sticky } : sticky
        const { start, container, end } = config

        if (!container) { throw new Error('Tracker sticky config requires a container selector') }

        return {
            container,
            start: start ?? STICKY_DEFAULTS.start,
            end: end ?? STICKY_DEFAULTS.end,
        }
    }

    #init() {
        const t = typeof this.#props.tracker === 'string' ? qs(this.#props.tracker) : this.#props.tracker

        if (!t) { throw new Error(`Tracker element not found for selector: ${this.#props.tracker}`) }
        this.#tracker = t
        this.el = this.#tracker

        this.#stickyConfig = this.#normalizeSticky(this.#props.sticky)
        if (this.#stickyConfig) { this.#initSticky() }

        this.#resize()
        this.#initObservers()
    }

    #initSticky() {
        const { container } = this.#stickyConfig
        const triggerEl = qs(container)

        if (!triggerEl) { throw new Error(`Sticky container not found for selector: ${container}`) }

        this.#stickyTrigger = triggerEl
    }

    #resolvePosition(position) {
        return typeof position === 'function' ? position() : position
    }

    #refreshStickyBounds() {
        if (!this.#stickyTrigger) return

        const { start, end } = this.#stickyConfig
        const { scroll, height: viewportHeight } = this.#store.viewport
        const scrollY = scroll.y

        this.#stickyStart = scrollAtPosition(this.#stickyTrigger, this.#resolvePosition(start), scrollY, viewportHeight)
        this.#stickyEnd = scrollAtPosition(this.#stickyTrigger, this.#resolvePosition(end), scrollY, viewportHeight)
    }

    // Scroll distance travelled inside the sticky range, cancelled out so the group stays pinned
    #updateSticky(scrollY) {
        const range = Math.max(0, this.#stickyEnd - this.#stickyStart)
        const travelled = clamp(0, range, scrollY - this.#stickyStart)

        // a zero range has no in-between: it's either before or past the pin
        this.stickyProgress = range ? travelled / range : Number(scrollY >= this.#stickyStart)

        return travelled
    }

    #initObservers() {
        // While pinned the group leaves its element behind, so visibility follows the container instead
        const visibilityTarget = this.#stickyTrigger ?? this.#tracker

        this.#intersectionObserver = new IntersectionObserver(([entry]) => {
            this.isActive = !!entry && entry.isIntersecting
        }, { threshold: 0 })
        this.#intersectionObserver.observe(visibilityTarget)

        // Catches late layout changes (fonts, images) without a window resize. Calls the public
        // resize() so subclasses refresh too; the first callback fires on observe, after construction
        this.#resizeObserver = new ResizeObserver(() => this.resize())
        this.#resizeObserver.observe(this.#tracker)
        if (this.#stickyTrigger) { this.#resizeObserver.observe(this.#stickyTrigger) }
    }

    #setPosition() {
        const { width, height, scroll } = this.#store.viewport
        const scrollY = scroll.y

        let y = (height - this.rect.height) * 0.5 - this.rect.top + scrollY - this.offset.y
        if (this.#stickyTrigger) { y -= this.#updateSticky(scrollY) }

        this.trackPosition.x = this.rect.left - (width * 0.5) + (this.rect.width * 0.5)
        this.trackPosition.y = y

        if (this.preventUpdatePosition) return
        this.position.set(this.trackPosition.x, this.trackPosition.y, 0)
    }

    #resize() {
        const { width, height, left, top } = rect(this.#tracker)
        this.rect.width = width
        this.rect.height = height
        this.rect.left = left
        this.rect.top = top

        this.trackSize.w = width
        this.trackSize.h = height
        this.offset.y = this.#store.viewport.scroll.y

        if (!this.preventUpdateScale) { this.scale.set(width, height, 1) }

        this.#refreshStickyBounds()
        this.#setPosition()
    }

    #destroy() {
        this.#stickyTrigger = undefined

        this.#intersectionObserver?.disconnect()
        this.#intersectionObserver = undefined

        this.#resizeObserver?.disconnect()
        this.#resizeObserver = undefined
    }

    update() {
        this.#setPosition()
    }

    resize() {
        this.#resize()
    }

    destroy() {
        this.#destroy()
    }
}
