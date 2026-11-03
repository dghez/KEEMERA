import type { EVENTS, PRIORITY } from '.'
import type { FrameState, GlState, ResourceProgress, Store } from '../types'
import type { ScrollState } from '../Core/Viewport'

export type KeemeraEventName = typeof EVENTS[keyof typeof EVENTS]

// `string & {}` keeps autocomplete for the built-in names while accepting custom ones
export type EventName = KeemeraEventName | (string & {})

export type PriorityName = keyof typeof PRIORITY
export type Priority = number | PriorityName | (string & {})

export interface DragPayload {
    xy: [number, number]
    active: boolean
    dragging?: boolean
}

/**
 * Listener arguments per event. Extend it for your own events:
 * declare module '@dghez/keemera' { interface KeemeraEventMap { 'MY:EVENT': [number] } }
 */
export interface KeemeraEventMap {
    'APP:TICK': [state: FrameState]
    'APP:RESIZE': [state: FrameState]
    'APP:SCROLL': [scroll: ScrollState]
    'APP:MOUSE:MOVE': [payload: { xy: [number, number] }]
    'APP:MOUSE:DRAG': [payload: DragPayload]
    'APP:MOUSE:HOLD': [active: boolean]
    'WEBGL:BEFORE:RENDER': [state: FrameState, store: Store]
    'WEBGL:AFTER:RENDER': [state: FrameState, store: Store]
    'WEBGL:APP:LOADING': []
    'WEBGL:APP:LOADED': []
    'WEBGL:APP:READY': []
    'WEBGL:STATE:CHANGE': [change: { state: GlState, prev: GlState }]
    'RESOURCES:PROGRESS': [progress: ResourceProgress]
    'APP:DESTROY': []
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EventArgs<E extends EventName> = E extends keyof KeemeraEventMap ? KeemeraEventMap[E] : any[]
export type EventCallback<E extends EventName> = (...args: EventArgs<E>) => void
