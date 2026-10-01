import { SRGBColorSpace, MathUtils, WebGLRenderer } from 'three'

import Camera from './Camera'
import Gestures from './Gestures'
import Mouse from './Mouse'
import Time from './Time'
import Viewport from './Viewport'

export default class Core {
    #store
    #options
    #dom

    constructor({ store, wrapper, canvas, options = {} }) {
        this.#store = store
        this.#options = options
        this.#dom = { wrapper, canvas }

        this.#init()
    }

    #init() {
        const store = this.#store
        const {
            dpr: dprRange = [1, 1.6],
            renderer: rendererOptions = {},
            clearColor = 0x000000,
            clearAlpha = 1,
            camera: cameraOptions = {},
            gestures = true,
            gestureTarget = window,
            breakpoint = 650,
        } = this.#options

        const [minDpr, maxDpr] = Array.isArray(dprRange) ? dprRange : [dprRange, dprRange]
        const dpr = MathUtils.clamp(window.devicePixelRatio, minDpr, maxDpr)

        const renderer = new WebGLRenderer({
            powerPreference: 'high-performance',
            depth: true,
            stencil: false,
            ...rendererOptions,
            canvas: this.#dom.canvas,
        })

        renderer.outputColorSpace = SRGBColorSpace
        renderer.shadowMap.enabled = false
        renderer.setClearColor(clearColor)
        renderer.setClearAlpha(clearAlpha)
        renderer.setPixelRatio(dpr)

        store.dom = this.#dom
        store.dpr = dpr
        store.renderer = renderer
        store.viewport = new Viewport({ store, breakpoint })
        store.time = new Time({ store })
        store.mouse = new Mouse({ store })
        store.gestures = gestures ? new Gestures({ store, target: gestureTarget }) : undefined
        store.camera = new Camera({ store, ...cameraOptions })

        store.resources?.addContext(renderer)

        this.resize()
    }

    update() {
        const { time, mouse, camera } = this.#store
        time.update()
        mouse.update()
        camera.update()
    }

    render() {
        const { renderer, scene, camera } = this.#store
        renderer.render(scene, camera)
    }

    resize() {
        const { renderer, viewport, camera } = this.#store
        const width = this.#dom.wrapper.clientWidth
        const height = this.#dom.wrapper.clientHeight
        const dpr = renderer.getPixelRatio()

        renderer.setSize(width, height)
        viewport.setSize(width, height, dpr)
        camera.resize()
    }

    destroy() {
        const { renderer, gestures, mouse, time } = this.#store
        gestures?.destroy()
        mouse?.destroy()
        time?.destroy()
        renderer?.dispose()
    }
}
