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

        const gl = new WebGLRenderer({
            powerPreference: 'high-performance',
            depth: true,
            stencil: false,
            ...rendererOptions,
            canvas: this.#dom.canvas,
        })

        gl.outputColorSpace = SRGBColorSpace
        gl.shadowMap.enabled = false
        gl.setClearColor(clearColor)
        gl.setClearAlpha(clearAlpha)
        gl.setPixelRatio(dpr)

        store.dom = this.#dom
        store.gl = gl
        store.viewport = new Viewport({ store, breakpoint })
        store.time = new Time({ store })
        store.mouse = new Mouse({ store })
        store.gestures = gestures ? new Gestures({ store, target: gestureTarget }) : undefined
        store.camera = new Camera({ store, ...cameraOptions })

        store.resources?.addContext(gl)

        this.resize()
    }

    update() {
        const { time, mouse, camera } = this.#store
        time.update()
        mouse.update()
        camera.update()
    }

    render() {
        const { gl, scene, camera } = this.#store
        gl.render(scene, camera)
    }

    resize() {
        const { gl, viewport, camera } = this.#store
        const width = this.#dom.wrapper.clientWidth
        const height = this.#dom.wrapper.clientHeight
        const dpr = gl.getPixelRatio()

        gl.setSize(width, height)
        viewport.setSize(width, height, dpr)
        camera.resize()
    }

    destroy() {
        const { gl, gestures, mouse, time } = this.#store
        gestures?.destroy()
        mouse?.destroy()
        time?.destroy()
        gl?.dispose()
    }
}
