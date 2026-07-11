import { PlaneGeometry, MeshBasicMaterial, Mesh, AlwaysStencilFunc, ReplaceStencilOp, EqualStencilFunc } from 'three'

const PLANE = new PlaneGeometry()

export default class StencilMesh extends Mesh {
    #props
    constructor(props = {}) {
        super(PLANE, new MeshBasicMaterial({
            color: 0xffffff * Math.random(),
            colorWrite: false,
            depthTest: false,
            depthWrite: false,
            stencilWrite: true,
            stencilRef: props.stencilRef || 1,
            stencilFunc: AlwaysStencilFunc,
            stencilZPass: ReplaceStencilOp,
        }))

        this.#props = props

        this.renderOrder = -100
        this.matrixAutoUpdate = false
    }

    applyStencilToMaterial(material) {
        material.stencilWrite = true
        material.stencilRef = this.#props.stencilRef
        material.stencilFunc = EqualStencilFunc
        material.stencilZPass = ReplaceStencilOp
    }
}
