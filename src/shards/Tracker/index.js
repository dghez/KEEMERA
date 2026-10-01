import { Group } from 'three'

import { rect, qs, clamp } from '../../utils/dom'
import requireStore from '../../utils/requireStore'

const STICKY_DEFAULTS = {
    start: 'top top',
    end: 'bottom bottom',
}

function getEdge(r, edge) {
    if (edge === 'center') return r.top + r.height * 0.5
    return r[edge]
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

export default class Tracker extends Group {
    #props
    #store

    #tracker
    #observer
    #stickyTrigger
    #stickyConfig
    #stickyStart
    #stickyEnd

    constructor(props = {}) {
        super()
        this.#props = props
        this.#store = requireStore(props.store, new.target.name)
        this.#tracker = undefined
        this.#observer = undefined

        this.#stickyTrigger = undefined
        this.#stickyConfig = null
        this.#stickyStart = 0
        this.#stickyEnd = 0

        this.el = undefined

        this.trackPosition = { x: 0, y: 0 }
        this.trackSize = { w: 0, h: 0 }
        this.rect = { width: 0, height: 0, left: 0, top: 0 }
        this.offset = { x: 0, y: 0 }

        this.preventUpdatePosition = props.preventUpdatePosition ?? false
        this.preventUpdateScale = props.preventUpdateScale ?? true

        this.sticky = props.sticky ?? false
        this.isActive = false

        this.#init()
    }

    #normalizeSticky(sticky) {
        if (!sticky) return null

        const config = typeof sticky === 'string' ? { container: sticky } : { ...sticky }
        const { top, start, container, end } = config

        if (!container) { throw new Error('Tracker sticky config requires a container selector') }

        return {
            ...STICKY_DEFAULTS,
            container,
            end,
            start: start ?? (top != null ? `top top+=${top}` : STICKY_DEFAULTS.start),
        }
    }

    #init() {
        const t = typeof this.#props.tracker === 'string' ? qs(this.#props.tracker) : this.#props.tracker

        if (!t) { throw new Error(`Tracker element not found for selector: ${this.#props.tracker}`) }
        this.#tracker = t
        this.el = this.#tracker

        this.#stickyConfig = this.#normalizeSticky(this.sticky)
        if (this.#stickyConfig) { this.#initSticky() }

        this.#resize()
        this.#initIntersectionObserver()
    }

    #initSticky() {
        const { container } = this.#stickyConfig
        const triggerEl = qs(container)

        if (!triggerEl) { throw new Error(`Sticky container not found for selector: ${container}`) }

        this.#stickyTrigger = triggerEl
        setTimeout(() => this.#resize(), 500)
    }

    #resolvePosition(position) {
        return typeof position === 'function' ? position() : position
    }

    #refreshStickyBounds() {
        if (!this.#stickyTrigger) return

        const { start, end } = this.#stickyConfig
        const { scroll, height: viewportHeight } = this.#store.viewport
        const scrollY = scroll.y

        const startPos = this.#resolvePosition(start)
        const endPos = this.#resolvePosition(end)

        this.#stickyStart = scrollAtPosition(this.#stickyTrigger, startPos, scrollY, viewportHeight)
        this.#stickyEnd = scrollAtPosition(this.#stickyTrigger, endPos, scrollY, viewportHeight)
    }

    #getStickyProgress(scrollY) {
        const range = this.#stickyEnd - this.#stickyStart
        return clamp(0, 1, (scrollY - this.#stickyStart) / range)
    }

    #getStickyCorrection(scrollY) {
        const progress = this.#getStickyProgress(scrollY)
        const range = this.#stickyEnd - this.#stickyStart

        return progress * range
    }

    #initIntersectionObserver() {
        const options = { threshold: 0 }

        this.#observer = new IntersectionObserver((entries) => {
            const entry = entries[0]
            const isVisible = !!entry && entry.isIntersecting && entry.intersectionRatio > 0
            this.isActive = isVisible
        }, options)

        this.#observer.observe(this.#tracker)
    }

    #setPosition() {
        const { width, height, scroll } = this.#store.viewport
        const scrollY = scroll.y

        this.trackPosition.x = this.rect.left - (width * 0.5) + (this.rect.width * 0.5)
        let y = -(this.rect.height * 0.5) + (height * 0.5) - this.rect.top + scrollY - this.offset.y

        if (this.#stickyTrigger) {
            y -= this.#getStickyCorrection(scrollY)
        }

        this.trackPosition.y = y
        this.trackPosition.z = 0

        if (this.preventUpdatePosition) return
        this.position.set(this.trackPosition.x, this.trackPosition.y, 0)
    }

    #resize() {
        const { width, height, left, top } = rect(this.#tracker)
        this.rect.width = width
        this.rect.height = height
        this.rect.left = left
        this.rect.top = top

        this.trackSize = { w: width, h: height }
        this.offset.y = this.#store.viewport.scroll.y

        if (!this.preventUpdateScale) { this.scale.set(this.trackSize.w, this.trackSize.h, 1) }

        this.#refreshStickyBounds()
        this.#update()
    }

    #update() {
        this.#setPosition()
    }

    #destroy() {
        this.#stickyTrigger = undefined

        if (this.#observer) {
            this.#observer.disconnect()
            this.#observer = undefined
        }
    }

    update() {
        this.#update()
    }

    resize() {
        this.#resize()
    }

    destroy() {
        this.#destroy()
    }
}
