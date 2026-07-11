// NEED TO BE UPGRADED TO SOMETHING BETTER
import store from '@gl/store'

export default class Size {
    constructor() {
        this.width = 0
        this.height = 0
        this.dpr = 1
        this.isMobile = false
        this.isTouch = false
    }

    setSize(w, h, dpr) {
        this.width = w
        this.height = h
        this.dpr = dpr

        const { $resize } = store.nuxt

        store.helpers.uniforms.resolution.value.set(w, h, dpr)
        this.isMobile = $resize.small
        this.isTouch = !$resize.mouse

        // this.isTouch = !(window.matchMedia('(hover: hover) and (pointer: fine)').matches)
        // this.isMobile = this.width < 650 // match SM tailwind, from outside
    }
}

const size = new Size()
export { size }
