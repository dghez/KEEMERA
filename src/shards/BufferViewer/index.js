import { Mesh, MeshBasicMaterial, OrthographicCamera, PlaneGeometry, Scene } from 'three'

import requireStore from '../../utils/requireStore'

const GEOMETRY = new PlaneGeometry(2, 2)

// Draws on top of the main render: call render() on EVENTS.WEBGL_AFTER_RENDER
export default class BufferViewer {
    #store
    #scene
    #camera
    #views
    #width
    #x
    #y

    constructor({ store, width = 300, x = 0, y = 0 } = {}) {
        this.#store = requireStore(store, 'BufferViewer')
        this.#scene = new Scene()
        this.#camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
        this.#views = []

        this.#width = width
        this.#x = x
        this.#y = y
    }

    createView(texture, { width = this.#width, x = this.#x, y = this.#y, sourceWidth = 1, sourceHeight = 1 } = {}) {
        const material = new MeshBasicMaterial({
            map: texture,
            depthTest: false,
            depthWrite: false,
            transparent: true,
        })

        const mesh = new Mesh(GEOMETRY, material)
        mesh.frustumCulled = false
        this.#scene.add(mesh)

        const view = { mesh, width, x, y, sourceWidth, sourceHeight }
        this.#views.push(view)
        return view
    }

    #syncViewSourceSize(view) {
        const map = view?.mesh?.material?.map
        const img = map?.image
        const texW = img?.width
        const texH = img?.height

        if (texW > 0 && texH > 0) {
            view.sourceWidth = texW
            view.sourceHeight = texH
            return
        }

        view.sourceWidth = Math.max(1, view.sourceWidth || 1)
        view.sourceHeight = Math.max(1, view.sourceHeight || 1)
    }

    resize() {
        const { viewport } = this.#store
        const width = Math.max(1, viewport.width || 1)
        const height = Math.max(1, viewport.height || 1)
        const aspect = width / height

        this.#camera.left = -aspect
        this.#camera.right = aspect
        this.#camera.top = 1
        this.#camera.bottom = -1
        this.#camera.near = 0
        this.#camera.far = 1
        this.#camera.updateProjectionMatrix()
        for (let i = 0; i < this.#views.length; i++) {
            this.#syncViewSourceSize(this.#views[i])
        }
    }

    render() {
        if (!this.#views.length) return
        const { renderer: gl, viewport } = this.#store
        const viewportW = viewport.width
        const viewportH = viewport.height
        const prevAutoClear = gl.autoClear

        gl.autoClear = false
        gl.setScissorTest(true)

        for (let i = 0; i < this.#views.length; i++) {
            const view = this.#views[i]
            if (!view.mesh.material.map) continue
            this.#syncViewSourceSize(view)
            const w = Math.min(view.width, viewportW)
            const h = Math.max(1, Math.round((w * view.sourceHeight) / view.sourceWidth))
            gl.setViewport(view.x, view.y, w, h)
            gl.setScissor(view.x, view.y, w, h)
            gl.render(this.#scene, this.#camera)
        }

        gl.setScissorTest(false)
        gl.setViewport(0, 0, viewportW, viewportH)
        gl.autoClear = prevAutoClear
    }

    destroy() {
        this.#views.forEach((view) => {
            view.mesh.material.dispose()
        })

        this.#scene.clear()
        this.#views = []
    }
}
