export default class Emitter {
    #labels
    #priorities

    constructor({ labels, priorities, debug = false } = {}) {
        this.#labels = labels ? { ...labels } : undefined
        this.#priorities = { ...priorities }
        this.debug = debug
        this.events = {}
    }

    getEvents() {
        return { ...this.#labels }
    }

    addEvents(labels = {}) {
        this.#labels = { ...this.#labels, ...labels }
        return this.getEvents()
    }

    getPriorities() {
        return { ...this.#priorities }
    }

    addPriorities(priorities = {}) {
        this.#priorities = { ...this.#priorities, ...priorities }
        return this.getPriorities()
    }

    #resolvePriority(priority) {
        if (typeof priority === 'number') return priority
        if (typeof priority === 'string' && priority in this.#priorities) return this.#priorities[priority]

        if (priority !== undefined) { console.warn(`[Keemera] Unknown priority "${priority}", falling back to 0`) }
        return 0
    }

    emit(event, ...args) {
        const callbacks = this.events[event] || []
        for (let i = 0, { length } = callbacks; i < length; i++) {
            callbacks[i].cb(...args)
        }
    }

    on(event, cb, priority = 0) {
        if (this.debug && this.#labels && !Object.values(this.#labels).includes(event)) {
            console.warn(`[Keemera] The "${event}" event is not registered. Add it with events.addEvents().`)
        }

        const data = { cb, priority: this.#resolvePriority(priority) }
        this.events[event]?.push(data) || (this.events[event] = [data])
        this.events[event].sort((a, b) => a.priority - b.priority)

        return () => this.off(event, cb)
    }

    off(event, callback) {
        this.events[event] = this.events[event]?.filter(({ cb }) => callback !== cb)
    }

    once(event, cb, priority = 0) {
        const onceCallback = (...args) => {
            this.off(event, onceCallback)
            cb(...args)
        }

        this.on(event, onceCallback, priority)

        return () => this.off(event, onceCallback)
    }

    destroy() {
        this.events = {}
    }
}
