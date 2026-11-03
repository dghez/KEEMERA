import type { EventArgs, EventCallback, EventName, Priority } from './types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Listener = { cb: (...args: any[]) => void, priority: number }

export default class Emitter {
    #labels: Record<string, string> | undefined
    #priorities: Record<string, number>
    events: Record<string, Listener[]>

    constructor({ labels, priorities }: { labels?: Record<string, string>, priorities?: Record<string, number> } = {}) {
        this.#labels = labels ? { ...labels } : undefined
        this.#priorities = { ...priorities }
        this.events = {}
    }

    getEvents() {
        return { ...this.#labels }
    }

    addEvents(labels: Record<string, string> = {}) {
        this.#labels = { ...this.#labels, ...labels }
        return this.getEvents()
    }

    getPriorities() {
        return { ...this.#priorities }
    }

    addPriorities(priorities: Record<string, number> = {}) {
        this.#priorities = { ...this.#priorities, ...priorities }
        return this.getPriorities()
    }

    #resolvePriority(priority?: Priority) {
        if (typeof priority === 'number') return priority
        if (typeof priority === 'string' && priority in this.#priorities) return this.#priorities[priority]

        if (priority !== undefined) { console.warn(`[Keemera] Unknown priority "${priority}", falling back to 0`) }
        return 0
    }

    emit<E extends EventName>(event: E, ...args: EventArgs<E>) {
        const callbacks = this.events[event] || []
        for (let i = 0, { length } = callbacks; i < length; i++) {
            callbacks[i].cb(...args)
        }
    }

    on<E extends EventName>(event: E, cb: EventCallback<E>, priority: Priority = 0) {
        if (this.#labels && !Object.values(this.#labels).includes(event)) {
            console.warn(`[Keemera] The "${event}" event is not registered. Add it with events.addEvents().`)
        }

        const data = { cb, priority: this.#resolvePriority(priority) }
        const listeners = this.events[event] ??= []
        listeners.push(data)
        listeners.sort((a, b) => a.priority - b.priority)

        return () => this.off(event, cb)
    }

    off<E extends EventName>(event: E, callback: EventCallback<E>) {
        this.events[event] = this.events[event]?.filter(({ cb }) => callback !== cb)
    }

    once<E extends EventName>(event: E, cb: EventCallback<E>, priority: Priority = 0) {
        const onceCallback = ((...args: EventArgs<E>) => {
            this.off(event, onceCallback)
            cb(...args)
        }) as EventCallback<E>

        this.on(event, onceCallback, priority)

        return () => this.off(event, onceCallback)
    }

    destroy() {
        this.events = {}
    }
}
