import { Group, HalfFloatType, LinearFilter, NoBlending, NoColorSpace, RepeatWrapping, ShaderMaterial, Vector2, WebGLRenderTarget } from 'three'
import type { IUniform, Texture } from 'three'
import { GaussianBlurPass } from 'postprocessing'

import BufferViewer from '../BufferViewer'
import type { BufferView } from '../BufferViewer'
import FullscreenQuad from '../FullscreenQuad'
import { EVENTS } from '../../events'
import requireStore from '../../utils/requireStore'
import type { Store } from '../../types'

import { fragmentShader, vertexShader } from './shaders'

export interface MouseFluidProps {
    store: Store
    resolution?: number
    blur?: { kernelSize?: number, iterations?: number }
    turbulence?: { texture: Texture, strength?: number }
    debug?: boolean
}

// simulation tunables, live: change `.value`
export interface MouseFluidSettings {
    radius: IUniform<number> // max brush radius, uv
    shapeVelocity: IUniform<number> // velocity painted by the brush
    shapeStrength: IUniform<number> // strength (b) painted by the brush
    paint: IUniform<number> // how fast the brush overrides the advected field
    advection: IUniform<number> // how far the blurred velocity carries the field each frame, uv
    velocityFade: IUniform<number> // velocity kept each frame
    strengthFade: IUniform<number> // strength kept each frame
    turbulenceStrength: IUniform<number>
    turbulenceJitter: IUniform<number> // jitter of the blurred read, uv
    turbulenceJitterScale: IUniform<number> // tiling of the jitter noise
    turbulencePush: IUniform<number> // push on the advection, scaled by strength
    turbulencePushScale: IUniform<number> // tiling of the push noise
    turbulenceSpeed: IUniform<number> // how fast the noise scrolls, 0 = static
    turbulenceCurlStep: IUniform<number> // finite difference step of the curl, noise uv: smaller = finer eddies
}

// runtime fields missing from postprocessing's typings
type BlurPass = GaussianBlurPass & { blurMaterial: { kernelSize: number }, iterations: number }

interface Targets {
    prev: WebGLRenderTarget
    curr: WebGLRenderTarget
    blurred: WebGLRenderTarget
}

const DEBUG_WIDTH = 500
const DEBUG_MARGIN = 16

/**
 * Cheap mouse fluid: ping-pong on low-res targets, the previous frame is blurred and its velocity advects the next one.
 * Output in `texture`: rg velocity (0.5 = still), b strength. Renders offscreen only, the group itself is empty.
 * Share `uniform` with the materials reading it (screen uv, y up): it always holds the current frame.
 */
export default class MouseFluid extends Group {
    uniform: IUniform<Texture | null> = { value: null }
    settings: MouseFluidSettings

    #store: Store
    #resolution: number
    #debug: boolean
    #quad: FullscreenQuad<ShaderMaterial>
    #blurPass: BlurPass
    #targets: Targets
    #prevMouse = new Vector2()
    #needsReset = true

    #debugViewer: BufferViewer | undefined = undefined
    #debugView: BufferView | undefined = undefined
    #offDebugRender: (() => void) | undefined = undefined

    constructor(props: MouseFluidProps) {
        super()
        this.#store = requireStore(props.store, new.target.name)

        const { resolution = 0.125, blur = {}, turbulence, debug = this.#store.isDebug } = props
        const { kernelSize = 71, iterations = 2 } = blur

        this.#resolution = resolution
        this.#debug = debug

        // the turbulence is sampled at high uv scales, so it has to tile; it's data, an sRGB decode
        // would move its 0.5 midpoint and make the whole trail drift
        if (turbulence) {
            turbulence.texture.wrapS = turbulence.texture.wrapT = RepeatWrapping
            turbulence.texture.colorSpace = NoColorSpace
            turbulence.texture.needsUpdate = true
        }

        const options = { colorSpace: NoColorSpace, minFilter: LinearFilter, magFilter: LinearFilter, type: HalfFloatType, depthBuffer: false }
        this.#targets = {
            prev: new WebGLRenderTarget(1, 1, options),
            curr: new WebGLRenderTarget(1, 1, options),
            blurred: new WebGLRenderTarget(1, 1, options),
        }

        this.#blurPass = new GaussianBlurPass({ kernelSize, iterations }) as BlurPass

        this.settings = {
            radius: { value: 0.035 },
            shapeVelocity: { value: 16 },
            shapeStrength: { value: 30 },
            paint: { value: 100 },
            advection: { value: 0.027 },
            velocityFade: { value: 0.96 },
            strengthFade: { value: 0.9 },
            turbulenceStrength: { value: turbulence?.strength ?? 1 },
            turbulenceJitter: { value: 0.02 },
            turbulenceJitterScale: { value: 0.15 },
            // the curl is small (~0.05 on a typical noise), hence the large factor
            turbulencePush: { value: 1.5 },
            turbulencePushScale: { value: 30 },
            turbulenceSpeed: { value: 0.05 },
            turbulenceCurlStep: { value: 0.01 },
        }
        const s = this.settings

        this.#quad = new FullscreenQuad(new ShaderMaterial({
            vertexShader,
            fragmentShader,
            uniforms: {
                uPrev: { value: null },
                uBlurred: { value: this.#targets.blurred.texture },
                uMouse: { value: new Vector2() },
                uSpeed: { value: new Vector2() },
                uNormalizedSpeed: { value: new Vector2() },
                uResolution: this.#store.uniforms.resolution,
                uReset: { value: false },
                uRadius: s.radius,
                uShapeVelocity: s.shapeVelocity,
                uShapeStrength: s.shapeStrength,
                uPaint: s.paint,
                uAdvection: s.advection,
                uVelocityFade: s.velocityFade,
                uStrengthFade: s.strengthFade,
                uTurbulence: { value: turbulence?.texture ?? null },
                uTurbulenceStrength: s.turbulenceStrength,
                uTurbulenceJitter: s.turbulenceJitter,
                uTurbulenceJitterScale: s.turbulenceJitterScale,
                uTurbulencePush: s.turbulencePush,
                uTurbulencePushScale: s.turbulencePushScale,
                uTurbulenceSpeed: s.turbulenceSpeed,
                uTurbulenceCurlStep: s.turbulenceCurlStep,
                uTime: this.#store.uniforms.time,
            },
            // compiled in only with a texture: no cost otherwise
            defines: turbulence ? { USE_TURBULENCE: '' } : {},
            blending: NoBlending,
            depthTest: false,
            depthWrite: false,
        }))

        this.#init()
    }

    get texture(): Texture {
        return this.#targets.curr.texture
    }

    // no effect without a turbulence texture
    get turbulenceStrength(): number {
        return this.settings.turbulenceStrength.value
    }

    set turbulenceStrength(v: number) {
        this.settings.turbulenceStrength.value = v
    }

    // fraction of the viewport size; resizing clears the fluid
    get resolution(): number {
        return this.#resolution
    }

    set resolution(v: number) {
        this.#resolution = v
        this.resize()
    }

    // odd, 3 to 1020
    get blurKernelSize(): number {
        return this.#blurPass.blurMaterial.kernelSize
    }

    set blurKernelSize(v: number) {
        this.#blurPass.blurMaterial.kernelSize = v
    }

    get blurIterations(): number {
        return this.#blurPass.iterations
    }

    set blurIterations(v: number) {
        this.#blurPass.iterations = v
    }

    #init() {
        this.#quad.frustumCulled = false
        this.#blurPass.initialize(this.#store.gl, false, HalfFloatType)

        if (this.#debug) this.#initDebug()

        this.resize()
    }

    update() {
        if (this.#needsReset) this.#reset()

        const { uMouse, uSpeed, uNormalizedSpeed, uPrev } = this.#quad.material.uniforms
        const { smooth } = this.#store.mouse

        // NDC to screen uv
        uMouse.value.set((smooth.x + 1) * 0.5, (smooth.y + 1) * 0.5)
        uSpeed.value.subVectors(smooth, this.#prevMouse)
        uNormalizedSpeed.value.copy(uSpeed.value).normalize()
        this.#prevMouse.copy(smooth)

        // SWAP: the old prev becomes the target rendered this frame
        const { curr, prev } = this.#targets
        this.#targets.curr = prev
        this.#targets.prev = curr
        uPrev.value = curr.texture
        this.uniform.value = prev.texture

        const { gl, camera } = this.#store

        // BLUR
        this.#blurPass.render(gl, this.#targets.prev, this.#targets.blurred)

        // RENDER
        gl.setRenderTarget(this.#targets.curr)
        gl.render(this.#quad, camera)
        gl.setRenderTarget(null)
    }

    resize() {
        const { width, height } = this.#store.viewport

        if (this.#debugView) this.#debugView.x = Math.max(0, width - DEBUG_WIDTH - DEBUG_MARGIN)

        const w = Math.max(1, Math.round(width * this.#resolution))
        const h = Math.max(1, Math.round(height * this.#resolution))
        const { prev, curr, blurred } = this.#targets

        if (curr.width === w && curr.height === h) return

        // resized targets lose their content, black would read as a strong velocity
        prev.setSize(w, h)
        curr.setSize(w, h)
        blurred.setSize(w, h)
        this.#blurPass.setSize(w, h)
        this.#needsReset = true
    }

    destroy() {
        this.#offDebugRender?.()
        this.#debugViewer?.destroy()
        Object.values(this.#targets).forEach((target: WebGLRenderTarget) => target.dispose())
        this.#blurPass.dispose()
        this.#quad.material.dispose()
    }

    #reset() {
        const { gl, camera } = this.#store
        const { uReset } = this.#quad.material.uniforms

        uReset.value = true
        for (const target of [this.#targets.prev, this.#targets.curr]) {
            gl.setRenderTarget(target)
            gl.render(this.#quad, camera)
        }
        gl.setRenderTarget(null)
        uReset.value = false

        this.#needsReset = false
    }

    #initDebug() {
        const viewer = new BufferViewer({ store: this.#store, width: DEBUG_WIDTH, y: DEBUG_MARGIN })
        const view = viewer.createView(this.texture)
        this.#debugViewer = viewer
        this.#debugView = view

        // unpacked velocity magnitude per axis (abs: negative directions would clamp to black) + strength, black = still
        // replaces the sRGB encoding too, values on screen are the real ones
        view.mesh.material.onBeforeCompile = (shader) => {
            shader.fragmentShader = shader.fragmentShader.replace('#include <colorspace_fragment>', 'gl_FragColor.rg = abs(gl_FragColor.rg - 0.5) * 2.0;')
        }

        // no viewer.resize(): it sets the camera to the viewport aspect, which squeezes the view inside its own viewport
        this.#offDebugRender = this.#store.events.on(EVENTS.WEBGL_AFTER_RENDER, () => {
            view.mesh.material.map = this.texture
            viewer.render()
        })
    }
}
