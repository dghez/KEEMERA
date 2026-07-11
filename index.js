import events, { EVENTS } from "@js/events"
import store, { GL_STATES } from "@gl/store"
import resources from '@gl/resources'

import Core from './Core'
import Scene from './Scene'

export default class Gl {
    #props
    #core
    #scene
    constructor(props) {
        this.#props = props

        this.#init()
    }

    #setup() {
        this.#core = new Core(this.#props)
    }

    async #load() {
        store.setGlState(GL_STATES.LOADING)

        await resources.load()

        store.setGlState(GL_STATES.LOADED)
        setTimeout(() => store.setGlState(GL_STATES.READY), 0)
    }

    async #init() {
        this.#setup()
        await this.#load()

        this.#initEvents()

        this.#initScene()
        store.time.reset()
        this.#onResize()
    }

    #initEvents() {
        events.on(EVENTS.APP_TICK, this.#onRaf)
        events.on(EVENTS.APP_RESIZE, this.#onResize)
    }

    #destroyEvents() {
        events.off(EVENTS.APP_TICK, this.#onRaf)
        events.off(EVENTS.APP_RESIZE, this.#onResize)
    }

    #initScene() {
        this.#scene = new Scene()
        store.scene.add(this.#scene)
    }

    #onResize = () => {
        this.#core.onResize()
        this.#scene?.resize()
    }

    #onRaf = (v) => {
        this.#scene.update()
        this.#core.update(v)
    }

    destroy() {
        this.#destroyEvents()
        this.#core.destroy()
        this.#scene?.destroy()
    }
}
