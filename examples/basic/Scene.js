import { Group } from 'three'
import { Shepherd } from 'keemera'
import { PlaneBackground } from 'keemera/shards'

// The old Scene pattern, now user-land: a Group with its own Shepherd that forwards update/resize/destroy.
// Tracker planes need the camera created with { useDomSize: true } so 1 unit = 1 css pixel.
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

    update(state) {
        this.#shepherd.update(state)
        this.children.forEach((child, i) => {
            child.rotation.z = Math.sin(state.elapsed + i) * 0.03
        })
    }

    resize(state) {
        this.#shepherd.resize(state)
    }

    destroy() {
        this.#shepherd.destroy()
    }
}
