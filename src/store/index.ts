import { EVENTS } from '../events'
import type Emitter from '../events/Emitter'
import type { GlState, Store } from '../types'

const GL_STATES = Object.freeze({
    IDLE: 'idle',
    LOADING: 'loading',
    LOADED: 'loaded',
    READY: 'ready',
    DESTROYED: 'destroyed',
} as const)

const GL_EVENTS: Partial<Record<GlState, typeof EVENTS.WEBGL_APP_LOADING | typeof EVENTS.WEBGL_APP_LOADED | typeof EVENTS.WEBGL_APP_READY>> = {
    [GL_STATES.LOADING]: EVENTS.WEBGL_APP_LOADING,
    [GL_STATES.LOADED]: EVENTS.WEBGL_APP_LOADED,
    [GL_STATES.READY]: EVENTS.WEBGL_APP_READY,
}

export default function createStore({ events, isDebug = false, showHelpers = false }: { events: Emitter, isDebug?: boolean, showHelpers?: boolean }): Store {
    const store = {
        state: GL_STATES.IDLE as GlState,
        setState(v: GlState) {
            const prev = store.state
            store.state = v

            if (store.isDebug) {
                console.log(`%c[KEEMERA STATE]: ${v} %c`, 'background: #c47002; color: white; padding: 6px 4px;', '')
            }

            store.events?.emit(EVENTS.WEBGL_STATE_CHANGE, { state: v, prev })
            const event = GL_EVENTS[v]
            if (event) { store.events?.emit(event) }
        },

        events,
        dom: undefined,
        gl: undefined,
        scene: undefined,
        camera: undefined,
        resources: undefined,
        viewport: undefined,
        mouse: undefined,
        time: undefined,
        gestures: undefined,
        uniforms: undefined,
        isDebug,
        showHelpers,
    }

    // the remaining fields are assigned by Keemera and Core right after creation
    return store as unknown as Store
}

export { GL_STATES }
