import { ref, watch } from '@vue/reactivity'
import { Color } from 'three'

import events, { EVENTS } from '@js/events'
import uniforms from '../Core/uniforms/shared'

const COLOR = new Color()

const GL_STATES = {
    LOADING: 'loading',
    LOADED: 'loaded',
    READY: 'ready',
}

const GL_EVENTS = {
    'loading': EVENTS.WEBGL_APP_LOADING,
    'loaded': EVENTS.WEBGL_APP_LOADED,
    'ready': EVENTS.WEBGL_APP_READY,
}

const store = {
    //REACTIVE
    //nuxtApp: undefined,
    glState: ref(''),
    setGlState: function(v) {
        console.log(`%c[GL-APP STATE]: ${v} %c`, 'background: #c47002; color: white; padding: 6px 4px;', '')
        store.glState.value = v

        if (Object.keys(GL_EVENTS).includes(v)) { events.emit(GL_EVENTS[v]) }
    },

    // DYNAMIC
    nuxt: undefined,
    gl: undefined,
    scene: undefined,
    camera: undefined,
    composer: undefined,
    raycaster: undefined,
    dom: undefined,
    mouse: undefined,
    size: undefined,
    time: undefined,
    gestures: undefined,
    dpr: 1,
    scroll: undefined,
    isDebug: false,
    showHelpers: false,
    bufferViewer: undefined,
    quoteGenerator: undefined,
    helpers: {
        uniforms
    }
}

export default store
export { watch, GL_STATES }
