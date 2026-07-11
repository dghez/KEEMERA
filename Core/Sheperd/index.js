export default class Shepherd {
    constructor() {
        this.components = []
    }

    add(component) {
        if (!component) return
        this.components.push(component)
    }

    destroy() {
        this.components.forEach((el) => {
            el?.destroy?.()
        })

        this.components = []
    }

    update(v) {
        this.components.forEach((el) => {
            el?.update?.(v)
        })
    }

    resize() {
        this.components.forEach((el) => {
            el?.resize?.()
        })
    }

}
