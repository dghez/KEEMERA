import type { Scene, WebGLRenderer, WebGLRendererParameters } from 'three'

import type Emitter from './events/Emitter'
import type { GL_STATES } from './store'
import type Camera from './Core/Camera'
import type { CameraOptions } from './Core/Camera'
import type Gestures from './Core/Gestures'
import type Mouse from './Core/Mouse'
import type Time from './Core/Time'
import type Viewport from './Core/Viewport'
import type { Uniforms } from './Core/uniforms'
import type Resources from './resources'
import type { Asset, ResourcesOptions } from './resources'

export type GlState = typeof GL_STATES[keyof typeof GL_STATES]

// Every field is filled in by the Keemera constructor, before the store reaches user code
export interface Store {
    state: GlState
    setState(v: GlState): void
    events: Emitter
    dom: { wrapper: HTMLElement, canvas: HTMLCanvasElement }
    gl: WebGLRenderer
    scene: Scene
    camera: Camera
    resources: Resources
    viewport: Viewport
    mouse: Mouse
    time: Time
    gestures: Gestures | undefined
    uniforms: Uniforms
    isDebug: boolean
    showHelpers: boolean
}

export interface FrameState {
    delta: number
    elapsed: number
    frame: number
    width: number
    height: number
    dpr: number
    scroll: number
    mouse: Mouse
}

export interface ResourceProgress {
    loaded: number
    total: number
    key: string
    progress: number
}

export interface KeemeraOptions {
    wrapper: HTMLElement
    canvas: HTMLCanvasElement
    debug?: boolean
    showHelpers?: boolean
    autoRun?: boolean
    autoResize?: boolean
    autoRender?: boolean
    preload?: Asset[]
    resources?: ResourcesOptions
    dpr?: number | [number, number]
    renderer?: Omit<WebGLRendererParameters, 'canvas'>
    clearColor?: number | string
    clearAlpha?: number
    camera?: CameraOptions
    gestures?: boolean
    gestureTarget?: EventTarget
    breakpoint?: number
}

export type RenderFunction = (state: FrameState, store: Store) => void
