import { Group, Box3, Vector3 } from 'three'
import type { Object3D } from 'three'

import type Tracker from '../Tracker'

export interface FitModelProps {
    model: Object3D
    scaleFactor?: number
    tracker?: Tracker
}

const V3 = new Vector3()

export default class FitModel extends Group {
    #tracker: Tracker | undefined
    #model: Object3D

    scaleFactor: number
    bounds: Vector3
    scaleMultiplier: number

    constructor({ model, scaleFactor = 1, tracker }: FitModelProps) {
        super()

        this.#tracker = tracker
        this.#model = model
        this.scaleFactor = scaleFactor

        this.bounds = V3.clone()
        this.scaleMultiplier = 1
        this.#init()
    }

    #init() {
        this.add(this.#model)

        const box = new Box3().setFromObject(this.#model)
        box.getSize(this.bounds)
    }

    fit(w?: number, h?: number) {
        this.resize(w, h)
    }

    resize(w?: number, h?: number) {
        let width: number | undefined, height: number | undefined

        if (w && h) {
            width = w
            height = h
        }
        else if (this.#tracker) {
            width = this.#tracker.trackSize.w
            height = this.#tracker.trackSize.h
        }

        if (!width || !height || !this.bounds.x || !this.bounds.y) {
            console.warn('[Keemera] FitModel.resize needs a size: call fit(w, h) or pass a { tracker }')
            return
        }

        const scaleX = width / this.bounds.x
        const scaleY = height / this.bounds.y
        const uniformScale = Math.min(scaleX, scaleY) * this.scaleFactor
        this.scaleMultiplier = uniformScale

        this.scale.setScalar(this.scaleMultiplier)
    }
}
