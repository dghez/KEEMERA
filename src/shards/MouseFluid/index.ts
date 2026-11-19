import { Group, HalfFloatType, LinearFilter, NoBlending, NoColorSpace, RepeatWrapping, ShaderMaterial, Vector2, Vector3, WebGLRenderTarget } from 'three'
import type { IUniform, Texture } from 'three'
import { GaussianBlurPass } from 'postprocessing'

import BufferViewer from '../BufferViewer'
import type { BufferView } from '../BufferViewer'
import FullscreenQuad from '../FullscreenQuad'
import { EVENTS } from '../../events'
import requireStore from '../../utils/requireStore'
import type { Store } from '../../types'

import { fragmentShader, vertexShader } from './shaders'
import { distortionShader } from './distortion'

export interface MouseFluidProps {
    store: Store
    resolution?: number
    blur?: { kernelSize?: number, iterations?: number }
    turbulence?: { texture: Texture, strength?: number }
    // overrides of MouseFluid.distortionPreset
    distortion?: Partial<MouseFluidDistortionPreset>
    debug?: boolean
}

// look of MouseFluid.distortionShader, live: change `.value`
export interface MouseFluidDistortionSettings {
    rgbShift: IUniform<Vector3> // per channel frequency of the color bands
    rgbShiftFact: IUniform<number> // phase of the color bands
    shade: IUniform<number>
    colorMultiplier: IUniform<number>
    colorMin: IUniform<number> // lowest color shift (negative darkens)
    weight: IUniform<number> // fluid strength (b) that fades the color shift out
    offset: IUniform<number> // uv offset per unit of velocity
    offsetStrength: IUniform<number> // offset scaled by the color shift length
    colorAmount: IUniform<number> // visible color shift: 0 = distortion only
    softness: IUniform<number> // fluid read spread, in fluid texels
    cursorMask: IUniform<number> // 0 = off, 1 = the fresh brush disc under the cursor is hidden
    cursorRadius: IUniform<number> // uv, inner radius fully masked
    cursorFeather: IUniform<number> // uv, fade width outside the radius
    cursorSpeed: IUniform<number> // mouse speed (ndc per frame) at which the mask reaches full size
    boost: IUniform<number> // velocity response curve: 1 = linear, < 1 lifts slow moves
}

export type MouseFluidDistortionPreset = { [K in keyof MouseFluidDistortionSettings]: MouseFluidDistortionSettings[K]['value'] }

// NDC per frame under which the mouse counts as still (about half a pixel on a 1000px screen)
const STILL_SPEED = 0.001

const DISTORTION_PRESET: Readonly<MouseFluidDistortionPreset> = Object.freeze({
    rgbShift: new Vector3(2.1, 2.2, 2.3),
    rgbShiftFact: 0.5,
    shade: 1.25,
    colorMultiplier: 1,
    colorMin: -0.2,
    weight: 0.01,
    offset: 0.12,
    offsetStrength: 5,
    colorAmount: 1,
    softness: 1.1,
    cursorMask: 1,
    cursorRadius: 0.03,
    cursorFeather: 0.12,
    cursorSpeed: 0.03,
    boost: 0.6,
})

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
    // GLSL snippet for any shader, bind `distortionUniforms` with it
    static readonly distortionShader = distortionShader
    // defaults of `distortion`, override them with the `distortion` prop
    static readonly distortionPreset = DISTORTION_PRESET

    uniform: IUniform<Texture | null> = { value: null }
    settings: MouseFluidSettings
    distortion: MouseFluidDistortionSettings
    // bind to any material that includes MouseFluid.distortionShader; runtime ones are kept up to date by update()
    distortionUniforms: Record<string, IUniform>

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

        const { resolution = 0.125, blur = {}, turbulence, distortion = {}, debug = this.#store.isDebug } = props
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

        // DISTORTION: preset + overrides, Vector3 cloned so the frozen preset is never shared
        const preset = { ...DISTORTION_PRESET, ...distortion }
        const d = Object.fromEntries(
            Object.entries(preset).map(([key, value]) => [key, { value: value instanceof Vector3 ? value.clone() : value }]),
        ) as unknown as MouseFluidDistortionSettings
        this.distortion = d
        this.distortionUniforms = {
            uMouseFluid: this.uniform,
            uMouseFluidRgbShift: d.rgbShift,
            uMouseFluidRgbShiftFact: d.rgbShiftFact,
            uMouseFluidShade: d.shade,
            uMouseFluidColorMultiplier: d.colorMultiplier,
            uMouseFluidColorMin: d.colorMin,
            uMouseFluidWeight: d.weight,
            uMouseFluidOffset: d.offset,
            uMouseFluidOffsetStrength: d.offsetStrength,
            uMouseFluidColorAmount: d.colorAmount,
            uMouseFluidSoftness: d.softness,
            uMouseFluidCursorMask: d.cursorMask,
            uMouseFluidCursorRadius: d.cursorRadius,
            uMouseFluidCursorFeather: d.cursorFeather,
            uMouseFluidCursorSpeed: d.cursorSpeed,
            uMouseFluidBoost: d.boost,
            uMouseFluidMouse: { value: new Vector2() },
            uMouseFluidMouseSpeed: { value: 0 },
            uMouseFluidAspect: { value: 1 },
            uMouseFluidTexel: { value: new Vector2() },
        }

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
        // the eased mouse creeps toward the pointer for seconds after it stops: below a crawl the brush rests,
        // or the normalized speed keeps painting full velocity under a still cursor
        if (uSpeed.value.lengthSq() < STILL_SPEED * STILL_SPEED) uSpeed.value.set(0, 0)
        uNormalizedSpeed.value.copy(uSpeed.value).normalize()
        this.#prevMouse.copy(smooth)

        // distortion runtime: same mouse as the brush; speed eased so the cursor mask doesn't pop
        const du = this.distortionUniforms
        du.uMouseFluidMouse.value.copy(uMouse.value)
        du.uMouseFluidMouseSpeed.value += (uSpeed.value.length() - du.uMouseFluidMouseSpeed.value) * 0.2

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

        this.distortionUniforms.uMouseFluidAspect.value = width / Math.max(1, height)
        this.distortionUniforms.uMouseFluidTexel.value.set(1 / w, 1 / h)

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
