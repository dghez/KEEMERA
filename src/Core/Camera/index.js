import { PerspectiveCamera } from 'three'

export default class Camera extends PerspectiveCamera {
    #store

    constructor({ store, fov = 60, aspect = 1, near = 0.1, far = 300, position = [0, 0, 100], lookAt = [0, 0, 0] } = {}) {
        super(fov, aspect, near, far)
        this.#store = store

        this.position.set(...position)
        this.lookAt(...lookAt)
        this.initialPosition = this.position.clone()
    }

    update() {}

    resize() {
        const { width, height } = this.#store.viewport
        if (!width || !height) return

        this.aspect = width / height
        this.updateProjectionMatrix()
    }

    saveInitialPosition() {
        this.initialPosition.copy(this.position)
    }
}
