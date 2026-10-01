export default class Shepherd {
    constructor() {
        this.components = []
    }

    add(...components) {
        components.forEach((component) => {
            if (!component || this.components.includes(component)) return
            this.components.push(component)
        })

        return components[0]
    }

    remove(...components) {
        this.components = this.components.filter(el => !components.includes(el))
    }

    has(component) {
        return this.components.includes(component)
    }

    update(state) {
        for (let i = 0; i < this.components.length; i++) {
            this.components[i]?.update?.(state)
        }
    }

    resize(state) {
        for (let i = 0; i < this.components.length; i++) {
            this.components[i]?.resize?.(state)
        }
    }

    destroy() {
        this.components.forEach((el) => {
            el?.destroy?.()
        })

        this.components = []
    }
}
