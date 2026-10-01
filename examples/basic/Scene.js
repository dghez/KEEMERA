import { Group, MathUtils } from 'three'
import { Shepherd } from 'keemera'
import { PlaneBackground } from 'keemera/shards'

// The old Scene pattern, now user-land: a Group with its own Shepherd,
// registered once on app.shepherd so it receives update/resize/destroy.
export default class Scene extends Group {
    #store
    #shepherd

    constructor({ store }) {
        super()

        this.#store = store
        this.#shepherd = new Shepherd()

        this.#init()
    }

    #init() {
        document.querySelectorAll('[data-track]').forEach((el, i) => {
            const plane = new PlaneBackground({ store: this.#store, tracker: el, preventUpdateScale: false })
            plane.material.color.setHSL(0.55 + i * 0.12, 0.6, 0.5)

            this.#shepherd.add(plane)
            this.add(plane)
        })
    }

    // 1 world unit = 1 css pixel, so tracked planes match their DOM boxes
    #fitCameraToPixels({ height }) {
        const { camera } = this.#store
        camera.position.z = height / 2 / Math.tan(MathUtils.degToRad(camera.fov / 2))
        camera.far = camera.position.z * 2
        camera.updateProjectionMatrix()
    }

    update(state) {
        this.#shepherd.update(state)
        this.children.forEach((child, i) => {
            child.rotation.z = Math.sin(state.elapsed + i) * 0.03
        })
    }

    resize(state) {
        this.#fitCameraToPixels(state)
        this.#shepherd.resize(state)
    }

    destroy() {
        this.#shepherd.destroy()
    }
}
