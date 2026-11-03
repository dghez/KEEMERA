import StencilMesh from '../StencilMesh'
import Tracker from '../Tracker'
import requireStore from '../../utils/requireStore'
import type { StencilMeshProps } from '../StencilMesh'
import type { TrackerProps } from '../Tracker'

export interface SectionMaskProps extends StencilMeshProps {
    store: TrackerProps['store']
    tracker: TrackerProps['tracker']
}

// Needs a renderer created with { renderer: { stencil: true } }
export default class SectionMask extends StencilMesh {
    #props: SectionMaskProps
    #tracker: Tracker

    constructor(props: SectionMaskProps) {
        super(props)

        this.#props = props

        const store = requireStore(props.store, 'SectionMask')
        this.#tracker = new Tracker({ store, tracker: this.#props.tracker })
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
        this.material.dispose()
    }
}
