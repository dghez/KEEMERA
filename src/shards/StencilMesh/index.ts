import { PlaneGeometry, MeshBasicMaterial, Mesh, AlwaysStencilFunc, ReplaceStencilOp, EqualStencilFunc } from 'three'
import type { Material } from 'three'

export interface StencilMeshProps {
    stencilRef?: number
}

const PLANE = new PlaneGeometry()

// Needs a renderer created with { renderer: { stencil: true } }
export default class StencilMesh extends Mesh<PlaneGeometry, MeshBasicMaterial> {
    stencilRef: number

    constructor(props: StencilMeshProps = {}) {
        const stencilRef = props.stencilRef ?? 1

        super(PLANE, new MeshBasicMaterial({
            color: 0xffffff * Math.random(),
            colorWrite: false,
            depthTest: false,
            depthWrite: false,
            stencilWrite: true,
            stencilRef,
            stencilFunc: AlwaysStencilFunc,
            stencilZPass: ReplaceStencilOp,
        }))

        this.stencilRef = stencilRef
        this.renderOrder = -100
        this.matrixAutoUpdate = false
    }

    applyStencilToMaterial(material: Material) {
        material.stencilWrite = true
        material.stencilRef = this.stencilRef
        material.stencilFunc = EqualStencilFunc
        material.stencilZPass = ReplaceStencilOp
    }
}
