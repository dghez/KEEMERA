import { Clock } from 'three'
import store from '@gl/store'

export default class Clk {
    constructor() {
        this.clock = new Clock()
        this.elapsed = 0
        this.delta = 0
        this.realDelta = 0
        this.scale = 1
        this.frames = 0

        this.clock.start()
    }

    reset() {
        this.frames = 0
        this.clock.start()
        this.clock.getElapsedTime() // save time internally

        this.clock.delta = this.clock.getDelta() // calc delta
        this.realDelta = this.clock.delta
        this.elapsed = 0

        store.helpers.uniforms.time.value = this.elapsed
        store.helpers.uniforms.timeScale.value = this.scale
    }

    update() {
        this.frames += 1
        this.clock.delta = this.clock.getDelta() // calc delta
        this.clock.getElapsedTime() // save time internally

        this.realDelta = this.clock.delta
        this.delta = this.clock.delta * this.scale
        this.elapsed += this.delta

        store.helpers.uniforms.time.value = this.elapsed
        store.helpers.uniforms.timeScale.value = this.scale
    }
}

const time = new Clk()
export { time }
