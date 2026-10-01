import { gsap } from 'gsap'
import { Scene } from 'three'

import { EVENTS, PRIORITY, createEmitter } from './events'
import createStore, { GL_STATES } from './store'
import createUniforms from './Core/uniforms'
import Core from './Core'
import Shepherd from './Core/Shepherd'
import Resources from './resources'

export default class Keemera {
    static EVENTS = EVENTS
    static PRIORITY = PRIORITY
    static STATES = GL_STATES

    #options
    #core
    #frameState
    #resizeObserver
    #isPlaying
    #isDestroyed

    constructor(options = {}) {
        const {
            wrapper,
            canvas,
            debug = false,
            showHelpers = false,
            autoRun = true,
            autoResize = true,
            resources: resourcesOptions = {},
        } = options

        if (!wrapper || !canvas) {
            throw new Error('[Keemera] new Keemera({ wrapper, canvas }) requires both a wrapper element and a canvas')
        }

        this.#options = { ...options, autoRun, autoResize }
        this.#isPlaying = false
        this.#isDestroyed = false
        this.#frameState = { delta: 0, elapsed: 0, frame: 0, width: 0, height: 0, dpr: 1, scroll: 0, mouse: undefined }

        const events = createEmitter({ debug })
        const store = createStore({ events, isDebug: debug, showHelpers })

        this.events = events
        this.store = store
        this.scene = new Scene()
        this.shepherd = new Shepherd()

        store.uniforms = createUniforms()
        store.scene = this.scene
        store.shepherd = this.shepherd
        store.resources = new Resources({ store, ...resourcesOptions })
        this.resources = store.resources

        this.#core = new Core({ store, wrapper, canvas, options })

        this.ready = this.#init()
    }

    get renderer() { return this.store.renderer }
    get camera() { return this.store.camera }
    get viewport() { return this.store.viewport }
    get mouse() { return this.store.mouse }
    get time() { return this.store.time }
    get state() { return this.store.state }
    get isPlaying() { return this.#isPlaying }

    async #init() {
        const { store } = this
        const { preload = [], autoRun, autoResize } = this.#options

        store.setState(GL_STATES.LOADING)

        try {
            await this.resources.load(preload)
        } catch (e) {
            console.error(e)
            throw e
        }

        if (this.#isDestroyed) return this

        store.setState(GL_STATES.LOADED)

        if (autoResize) { this.#initResizeObserver() }

        store.time.reset()
        this.resize()

        await new Promise(res => setTimeout(res, 0))
        if (this.#isDestroyed) return this

        store.setState(GL_STATES.READY)

        if (autoRun) { this.play() }

        return this
    }

    #initResizeObserver() {
        this.#resizeObserver = new ResizeObserver(() => this.resize())
        this.#resizeObserver.observe(this.store.dom.wrapper)
    }

    #syncFrameState() {
        const { time, viewport, mouse } = this.store
        const s = this.#frameState

        s.delta = time.delta
        s.elapsed = time.elapsed
        s.frame = time.frames
        s.width = viewport.width
        s.height = viewport.height
        s.dpr = viewport.dpr
        s.scroll = viewport.scroll.y
        s.mouse = mouse

        return s
    }

    tick = () => {
        if (this.#isDestroyed) return

        const { events } = this.store

        this.#core.update()
        const state = this.#syncFrameState()

        events.emit(EVENTS.APP_TICK, state)
        this.shepherd.update(state)

        events.emit(EVENTS.WEBGL_BEFORE_RENDER, state)
        this.#core.render()
        events.emit(EVENTS.WEBGL_AFTER_RENDER, state)
    }

    play() {
        if (this.#isPlaying || this.#isDestroyed) return

        this.#isPlaying = true
        this.store.time.resume()
        gsap.ticker.add(this.tick)
    }

    pause() {
        if (!this.#isPlaying) return

        this.#isPlaying = false
        gsap.ticker.remove(this.tick)
    }

    resize() {
        if (this.#isDestroyed) return

        this.#core.resize()
        const state = this.#syncFrameState()

        this.shepherd.resize(state)
        this.store.events.emit(EVENTS.APP_RESIZE, state)
    }

    setScroll(y) {
        this.store.viewport.setScroll(y)
    }

    destroy() {
        if (this.#isDestroyed) return

        this.pause()
        this.#isDestroyed = true

        this.#resizeObserver?.disconnect()
        this.#resizeObserver = undefined

        this.shepherd.destroy()
        this.scene.clear()
        this.resources.dispose()
        this.#core.destroy()

        this.store.setState(GL_STATES.DESTROYED)
        this.events.destroy()
    }
}
