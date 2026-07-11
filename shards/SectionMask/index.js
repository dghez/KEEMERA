import StencilMesh from "../StencilMesh"
import Tracker from "../Tracker"

export default class SectionMask extends StencilMesh {
    #props
    #tracker

    constructor(props) {
        super(props)

        this.#props = props

        this.#tracker = new Tracker({ tracker: this.#props.tracker })
        this.#init()
    }

    #init() {
        // this.#tracker.add(this) // don't add because we're adding the mesh. maybe change logic?
    }

    update() {
        this.#tracker.update()
        this.position.copy(this.#tracker.position)
        this.updateMatrix()
    }

    resize() {
        this.#tracker.resize()
        this.scale.set(this.#tracker.trackSize.w, this.#tracker.trackSize.h, 1)
        this.updateMatrix()
    }

    destroy() {
        this.#tracker.destroy()
    }
}
