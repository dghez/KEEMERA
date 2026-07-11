import { Group, } from 'three'
import Shepherd from '@gl/Core/Sheperd'

import store from '@gl/store'

export default class Scene extends Group {
    #shepherd

    constructor() {
        super()

        this.#shepherd = new Shepherd()
        this.#init()
    }

    #init() {


    }

    update(v) {
        this.#shepherd.update(v)
    }

    resize() {
        this.#shepherd.resize()
    }

    destroy() {
        this.#shepherd.destroy()
    }
}
