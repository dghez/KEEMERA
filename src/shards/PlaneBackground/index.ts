import { PlaneGeometry, MeshBasicMaterial, Mesh } from 'three'
import Tracker from '../Tracker'
import type { TrackerProps } from '../Tracker'

const GEOMETRY = new PlaneGeometry()

export default class PlaneBackground extends Tracker {
    material: MeshBasicMaterial | undefined
    mesh: Mesh<PlaneGeometry, MeshBasicMaterial> | undefined

    constructor(props: TrackerProps) {
        super(props)

        this.material = undefined
        this.mesh = undefined

        this.#init()
    }

    #init() {
        const material = new MeshBasicMaterial()
        const mesh = new Mesh(GEOMETRY, material)

        this.material = material
        this.mesh = mesh

        this.add(mesh)
    }

    destroy() {
        super.destroy()
        this.material?.dispose()
    }
}
