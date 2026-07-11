import { SRGBColorSpace, Scene, MathUtils, WebGLRenderer, ColorManagement } from 'three'
// import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

import store from "@gl/store"

import { mouse } from './Mouse'
import { time } from './Time'
import { size } from './Size'
import Camera from './Camera'
import Gestures from './Gestures'

import events, { EVENTS } from "@js/events"
import resources from '@gl/resources'

export default class Core {
    #renderer
    #dom
    #scene

    constructor({ wrapper, canvas }) {
        this.#dom = { wrapper, canvas }

        this.#init()
    }

    #init() {
        const search = window.location.search || (window.location.hash.includes('?') ? window.location.hash.slice(window.location.hash.indexOf('?')) : '')
        store.isDebug = !!new URLSearchParams(search).get("debug")
        store.showHelpers = !!new URLSearchParams(search).get("showHelpers")

        const dpr = MathUtils.clamp(window.devicePixelRatio, 1.4, 1.8)

        this.#renderer = new WebGLRenderer({
            powerPreference: "high-performance",
            canvas: this.#dom.canvas,
            depth: true,
            stencil: false,
            //antialias: dpr > 1 ? false : true, // false with post
        })

        this.#renderer.outputColorSpace = SRGBColorSpace
        this.#renderer.shadowMap.enabled = false

        this.#renderer.setClearColor(0x000000)
        this.#renderer.setClearAlpha(1)
        this.#renderer.setPixelRatio(dpr)

        // SAVE IN THE STORE #1
        store.dpr = dpr
        store.mouse = mouse
        store.time = time
        store.size = size
        store.gestures = new Gestures({ target: window })

        const width = this.#dom.wrapper.clientWidth
        const height = this.#dom.wrapper.clientHeight
        store.size.setSize(width, height, dpr)

        this.#renderer.setSize(width, height)
        const camera = new Camera(60, width / height, 0.1, 300)
        camera.position.set(0, 0, 100)
        camera.lookAt(0, 0, 0)
        camera.saveInitialPosition()

        this.#scene = new Scene()
        // const orbitControls = new OrbitControls(camera, this.#renderer.domElement)

        // resources
        resources.addContext(this.#renderer)

        // SAVE IN THE STORE #2
        store.dom = this.#dom
        store.gl = this.#renderer
        store.scene = this.#scene
        store.camera = camera

        // FIRST TRIGGER
        this.onResize()

        // RESIZE AGAIN
        this.onResize()
        this.#initEvents()

        store.isDebug && this.#initDebug()
    }

    #initDebug() {}

    #initEvents() {}

    destroy() {
        this.#renderer.dispose()
        store?.gestures.destroy()
    }

    update = (v) => {
        // LERP MOUSE
        store.mouse.update()
        store.time.update()
        store.camera.update()

        // EVENTS
        events.emit(EVENTS.WEBGL_BEFORE_RENDER, v)
        store.gl.render(store.scene, store.camera)
        events.emit(EVENTS.WEBGL_AFTER_RENDER, v)
    }

    onResize() {
        const width = this.#dom.wrapper.clientWidth
        const height = this.#dom.wrapper.clientHeight
        const dpr = store.gl.getPixelRatio()

        store.gl.setSize(width, height)
        store.size.setSize(width, height, dpr)
        store.camera.resize()
    }
}
