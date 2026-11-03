import { Timer } from 'three'

import type { Store } from '../../types'

export default class Time {
    #store: Store

    timer: Timer
    elapsed: number
    delta: number
    realDelta: number
    scale: number
    frames: number

    constructor({ store }: { store: Store }) {
        this.#store = store

        this.timer = new Timer()
        this.elapsed = 0
        this.delta = 0
        this.realDelta = 0
        this.scale = 1
        this.frames = 0
    }

    reset() {
        this.frames = 0
        this.timer.reset()

        this.realDelta = 0
        this.delta = 0
        this.elapsed = 0

        this.#syncUniforms()
    }

    // discard the time spent while paused, so the next frame doesn't jump
    resume() {
        this.timer.reset()
    }

    update() {
        this.frames += 1
        this.timer.update()

        this.realDelta = this.timer.getDelta()
        this.delta = this.realDelta * this.scale
        this.elapsed += this.delta

        this.#syncUniforms()
    }

    #syncUniforms() {
        const { uniforms } = this.#store
        uniforms.time.value = this.elapsed
        uniforms.timeScale.value = this.scale
    }

    destroy() {
        this.timer.dispose()
    }
}
