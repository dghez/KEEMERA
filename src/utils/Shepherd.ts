export interface Shepherdable<S = unknown> {
    update?(state: S): void
    resize?(state: S): void
    destroy?(): void
}

export default class Shepherd<S = unknown> {
    components: Shepherdable<S>[]

    constructor() {
        this.components = []
    }

    add<T extends Shepherdable<S>>(...components: T[]): T {
        components.forEach((component) => {
            if (!component || this.components.includes(component)) return
            this.components.push(component)
        })

        return components[0]
    }

    remove(...components: Shepherdable<S>[]) {
        this.components = this.components.filter(el => !components.includes(el))
    }

    has(component: Shepherdable<S>) {
        return this.components.includes(component)
    }

    update(state: S) {
        for (let i = 0; i < this.components.length; i++) {
            this.components[i]?.update?.(state)
        }
    }

    resize(state: S) {
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
