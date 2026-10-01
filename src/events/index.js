import Emitter from './Emitter'

const EVENTS = Object.freeze({
    // APP
    'APP_TICK': 'APP:TICK',
    'APP_RESIZE': 'APP:RESIZE',
    'APP_SCROLL': 'APP:SCROLL',

    // GESTURES
    'APP_MOUSE_MOVE': 'APP:MOUSE:MOVE',
    'APP_MOUSE_DRAG': 'APP:MOUSE:DRAG',
    'APP_MOUSE_HOLD': 'APP:MOUSE:HOLD',

    // WEBGL
    'WEBGL_BEFORE_RENDER': 'WEBGL:BEFORE:RENDER',
    'WEBGL_AFTER_RENDER': 'WEBGL:AFTER:RENDER',
    'WEBGL_APP_LOADING': 'WEBGL:APP:LOADING',
    'WEBGL_APP_LOADED': 'WEBGL:APP:LOADED',
    'WEBGL_APP_READY': 'WEBGL:APP:READY',
    'WEBGL_STATE_CHANGE': 'WEBGL:STATE:CHANGE',

    // RESOURCES
    'RESOURCES_PROGRESS': 'RESOURCES:PROGRESS',
})

const PRIORITY = Object.freeze({
    first: -10,
    instant: 0,
    high: 10,
    mid: 20,
    low: 30,
})

const createEmitter = ({ debug = false } = {}) => new Emitter({ labels: EVENTS, priorities: PRIORITY, debug })

export { Emitter, EVENTS, PRIORITY, createEmitter }
