import { PerspectiveCamera } from 'three'

export default class Camera extends PerspectiveCamera {
    #store

    constructor({ store, fov = 60, aspect = 1, near = 0.1, far = 300, position = [0, 0, 100], lookAt = [0, 0, 0], useDomSize = false } = {}) {
        super(fov, aspect, near, far)
        this.#store = store

        // 1 world unit = 1 css pixel at z = 0; position, near and far are recomputed on resize
        this.useDomSize = useDomSize

        this.position.set(...position)
        this.lookAt(...lookAt)
        this.initialPosition = this.position.clone()
    }

    update() {}

    resize() {
        const { width, height } = this.#store.viewport
        if (!width || !height) return

        this.aspect = width / height

        if (this.useDomSize) {
            const z = height / Math.tan(this.fov * Math.PI / 360) * 0.5
            this.position.set(0, 0, z)
            this.far = z * 20
            this.near = this.far / 1000
            this.lookAt(0, 0, 0)
        }

        this.updateProjectionMatrix()
    }

    saveInitialPosition() {
        this.initialPosition.copy(this.position)
    }
}
