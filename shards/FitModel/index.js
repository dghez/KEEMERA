import { Group, Box3, Vector3 } from 'three'

const V3 = new Vector3()

export default class FitModel extends Group {
    #tracker
    #model

    constructor({ model, scaleFactor = 1, tracker } = {}) {
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

    fit(w, h) {
        this.resize(w, h)
    }

    resize(w, h) {
        let width, height

        if (w && h) {
            width = w
            height = h
        }
        else if (this.#tracker) {
            width = this.#tracker.trackSize.w
            height = this.#tracker.trackSize.h
        }
        else {
            console.log('[FIT-MODEL]: Resize not working')
        }

        const scaleX = width / this.bounds.x
        const scaleY = height / this.bounds.y
        const uniformScale = Math.min(scaleX, scaleY) * this.scaleFactor
        this.scaleMultiplier = uniformScale

        this.scale.setScalar(this.scaleMultiplier)
    }
}
