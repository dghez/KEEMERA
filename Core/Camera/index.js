import { PerspectiveCamera } from 'three'
import store from "@gl/store"

export default class Camera extends PerspectiveCamera {
    constructor(props) {
        super(props)

        this.initialPosition = this.position.clone()
        this.#init()
    }

    #init() {
        this.lookAt(0, 0, 0)
    }

    update() {}

    resize() {
        // let z = store.size.height / Math.tan(this.fov * Math.PI / 360) * 0.5
        // this.position.set(0, 0, z)

        this.aspect = store.size.width / store.size.height
        // this.far = z * 20
        // this.near = this.far / 1000
        // this.lookAt(0, 0, 0)

        this.updateProjectionMatrix()
    }

    saveInitialPosition() {
        this.initialPosition.copy(this.position)
    }
}
