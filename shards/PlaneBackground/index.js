import { PlaneGeometry, MeshBasicMaterial, Mesh } from 'three'
import Tracker from "../Tracker"

const GEOMETRY = new PlaneGeometry()

export default class PlaneBackground extends Tracker {
    constructor(props) {
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
}
