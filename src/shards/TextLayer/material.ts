import { GLSL3, MathUtils } from 'three'
import type { IUniform, Material, ShaderMaterial, WebGLProgramParametersWithUniforms, WebGLRenderer } from 'three'

import { fragmentDefs, fragmentMain, vertexDefs, vertexMain } from './shaders'

export interface TextMaterial extends Material {
    readonly isKeemeraTextMaterial: true
    readonly baseMaterial: Material
    // debug: glyph boxes instead of glyphs. Not `wireframe`: built-in materials already use that name
    keemeraWireframe: boolean
}

// ids above three's own counter: the renderer skips uploading uniforms when two draws share an id
let nextId = 2 ** 30

const MAIN = /\bvoid\s+main\s*\(\s*(?:void\s*)?\)/

const wrap = (source: string, defs: string, main: string, stage: string) => {
    if (!MAIN.test(source)) throw new Error(`[Keemera] TextLayer: the material's ${stage} shader has no \`void main()\` to wrap`)
    return `${defs}\n${source.replace(MAIN, 'void keemeraBaseMain()')}\n${main}`
}

// throws where the material is handed over, not later inside the frame loop
export function assertTextMaterial(material: Material | undefined) {
    if (!material) return
    if (!(material as Material & { isMaterial?: boolean }).isMaterial) {
        throw new Error('[Keemera] TextLayer: `material` must be a three.js Material')
    }
    if ((material as Material & { isRawShaderMaterial?: boolean }).isRawShaderMaterial) {
        throw new Error('[Keemera] TextLayer: RawShaderMaterial has no three.js prefix to inject into. Use a ShaderMaterial')
    }
    if ((material as ShaderMaterial).isShaderMaterial && (material as ShaderMaterial).glslVersion === GLSL3) {
        throw new Error('[Keemera] TextLayer: a ShaderMaterial with glslVersion GLSL3 declares its own output. Drop glslVersion and write gl_FragColor (three still compiles GLSL 3.00)')
    }
}

// The text version of any material, troika style: the derived material has `base` as its prototype, so later
// changes to the base (color, opacity, uniform values, needsUpdate) show through. Slug is injected at compile time
export default function deriveTextMaterial(base: Material, uniforms: Record<string, IUniform>): TextMaterial {
    const shaderBase = base as ShaderMaterial

    let wireframe = false
    let version = 0

    const derived = Object.create(base) as TextMaterial
    Object.defineProperties(derived, {
        id: { value: nextId++ },
        uuid: { value: MathUtils.generateUUID() },
        // the renderer's dispose listener belongs to this material, not to the base
        _listeners: { value: undefined, writable: true },
        // the base's needsUpdate recompiles this one too; this one's own needsUpdate stays its own
        version: {
            get: () => base.version + version,
            set: (value: number) => { version = value - base.version },
        },
        // glyph edges blend
        transparent: { value: true, writable: true },
        isKeemeraTextMaterial: { value: true },
        baseMaterial: { value: base },
        keemeraWireframe: {
            get: () => wireframe,
            set: (value: boolean) => {
                if (value === wireframe) return
                wireframe = value
                derived.needsUpdate = true
            },
        },
    })

    // a ShaderMaterial compiles with its own uniforms object: copy it so each font pack keeps its textures,
    // the values stay shared so animating base.uniforms.x.value still works
    if (shaderBase.isShaderMaterial) {
        Object.defineProperty(derived, 'uniforms', { value: { ...shaderBase.uniforms, ...uniforms }, writable: true })
    }

    derived.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer: WebGLRenderer) => {
        base.onBeforeCompile.call(derived, shader, renderer)
        Object.assign(shader.uniforms, uniforms)

        const define = wireframe ? '#define KEEMERA_TEXT_WIREFRAME\n' : ''
        // built-in materials: the DOM color through diffuseColor, so `material.color` tints it
        const fragment = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n\tdiffuseColor *= keemeraColor;')

        shader.vertexShader = wrap(shader.vertexShader, define + vertexDefs, vertexMain, 'vertex')
        shader.fragmentShader = wrap(fragment, define + fragmentDefs, fragmentMain, 'fragment')
    }

    derived.customProgramCacheKey = () => `${base.customProgramCacheKey()}|keemera-text${wireframe ? '-wireframe' : ''}`

    return derived
}
