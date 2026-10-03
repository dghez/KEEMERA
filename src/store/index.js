import { EVENTS } from '../events'

const GL_STATES = Object.freeze({
    IDLE: 'idle',
    LOADING: 'loading',
    LOADED: 'loaded',
    READY: 'ready',
    DESTROYED: 'destroyed',
})

const GL_EVENTS = {
    [GL_STATES.LOADING]: EVENTS.WEBGL_APP_LOADING,
    [GL_STATES.LOADED]: EVENTS.WEBGL_APP_LOADED,
    [GL_STATES.READY]: EVENTS.WEBGL_APP_READY,
}

export default function createStore({ events, isDebug = false, showHelpers = false } = {}) {
    const store = {
        state: GL_STATES.IDLE,
        setState(v) {
            const prev = store.state
            store.state = v

            if (store.isDebug) {
                console.log(`%c[KEEMERA STATE]: ${v} %c`, 'background: #c47002; color: white; padding: 6px 4px;', '')
            }

            store.events?.emit(EVENTS.WEBGL_STATE_CHANGE, { state: v, prev })
            if (GL_EVENTS[v]) { store.events?.emit(GL_EVENTS[v]) }
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

    return store
}

export { GL_STATES }
