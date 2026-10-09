import { Group } from 'three'
import { Shepherd } from 'keemera'

import HeroPlate from './HeroPlate'
import Panel from './Panel'
import { ease } from './ink'

// data-keemera="<type>" -> class
const TYPES = {
    hero: HeroPlate,
    panel: Panel,
}

export default class Scene extends Group {
    #shepherd
    #store
    #lastScroll = null

    constructor({ store, texture }) {
        super()

        this.#store = store
        this.#shepherd = new Shepherd()
        this.byType = {}

        document.querySelectorAll('[data-keemera]').forEach((el) => {
            const type = el.dataset.keemera
            const Type = TYPES[type]
            if (!Type) {
                console.warn(`[keemera] unknown data-keemera type: "${type}"`)
                return
            }

            const object = new Type({ store, tracker: el, texture })
            this.#shepherd.add(object)
            this.add(object)
            this.byType[type] ??= []
            this.byType[type].push(object)
        })
    }

    get hero() {
        return this.byType.hero?.[0]
    }

    #updateVelocity({ scroll, delta }) {
        const velocity = this.#store.uniforms.scrollVelocity
        const raw = this.#lastScroll === null ? 0 : scroll - this.#lastScroll
        this.#lastScroll = scroll
        velocity.value = ease(velocity.value, Math.min(Math.max(raw / 60, -1), 1), delta, 8)
    }

    update(state) {
        this.#updateVelocity(state)
        this.#shepherd.update(state)
    }

    resize(state) {
        this.#shepherd.resize(state)
    }

    destroy() {
        this.#shepherd.destroy()
    }
}
