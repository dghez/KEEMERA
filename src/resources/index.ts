import { REVISION, TextureLoader, EquirectangularReflectionMapping, SRGBColorSpace } from 'three'
import type { DataTexture, Mesh, Texture, WebGLRenderer } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'

import { EVENTS } from '../events'
import { GLTFCurveExtension } from './GLTFCurveExtension.js'
import type { Store, ResourceProgress } from '../types'

// Local shape of @monogrid/gainmap-js (optional peer), so the emitted types don't depend on it
interface GainmapLoader {
    load(url: string, onLoad: (result: { renderTarget: { texture: Texture } }) => void, onProgress?: undefined, onError?: (err: unknown) => void): unknown
    setRenderTargetOptions(options: { mapping?: number }): GainmapLoader
    dispose?(): void
}
type HDRJPGLoader = new (renderer: WebGLRenderer) => GainmapLoader

const CDN = `https://cdn.jsdelivr.net/npm/three@0.${REVISION}/examples/jsm/libs`

const DEFAULT_DECODERS = {
    draco: `${CDN}/draco/gltf/`,
    ktx: `${CDN}/basis/`,
}

const SUPPORT_TYPES = ['ktx', 'draco', 'gainmap', 'envmap', 'curves'] as const

export type SupportType = typeof SUPPORT_TYPES[number]
export type SupportOptions = Partial<Record<SupportType, boolean>>
export type AssetType = 'gltf' | 'texture' | 'envmap' | 'gainmap' | 'fbo'

export interface Asset {
    key: string
    type: AssetType
    path: string
    colorSpace?: 'SRGBColorSpace' | (string & {})
    flipY?: boolean
    // textures only: load `<path>.ktx2`, or `-desktop.ktx2` / `-mobile.ktx2` when responsive
    compress?: boolean | { responsive?: boolean }
    preventInit?: boolean
    [extra: string]: unknown
}

export interface FboData {
    image: CanvasImageSource & { width: number, height: number }
    ctx: CanvasRenderingContext2D
    allData: Uint8ClampedArray
    pickPixel: (x: number, y: number) => [number, number, number, number]
}

export type LoadedGLTF = GLTF & { config: Asset }
export type LoadedTexture = Texture & { config: Asset }
export type LoadedAsset = LoadedGLTF | LoadedTexture

export interface ResourcesOptions {
    support?: SupportOptions
    decoders?: { draco?: string, ktx?: string }
}

export interface LoadOptions {
    onProgress?: (progress: ResourceProgress) => void
    save?: boolean
}

interface Loaders {
    gltf: GLTFLoader
    texture: TextureLoader
    ktx: KTX2Loader | undefined
    draco: DRACOLoader | undefined
    envmap: HDRLoader | undefined
    gainmap: { HDRJPGLoader: HDRJPGLoader, instance: GainmapLoader | undefined } | undefined
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyLoader = { load(url: string, onLoad: (data: any) => void, onProgress?: undefined, onError?: (err: unknown) => void): unknown }

export default class Resources {
    #store: Store | undefined
    #resources: Map<string, LoadedAsset>
    #support: Record<SupportType, boolean>
    #decoders: { draco: string, ktx: string }
    #loaders: Loaders
    #pending: Promise<unknown>[]
    #responsiveType: string
    #compileQueue: Texture[]
    #isCompileQueueRunning: boolean
    #isDisposed: boolean

    gl: WebGLRenderer | undefined

    constructor({ store, support = {}, decoders = {} }: ResourcesOptions & { store?: Store } = {}) {
        this.#store = store
        this.gl = undefined // set by addContext, loaders that compile/upload need the same context

        this.#resources = new Map()
        this.#support = Object.fromEntries(SUPPORT_TYPES.map(type => [type, false])) as Record<SupportType, boolean>
        this.#decoders = { ...DEFAULT_DECODERS, ...decoders }
        this.#pending = []
        this.#compileQueue = []
        this.#isCompileQueueRunning = false
        this.#isDisposed = false
        this.#responsiveType = 'desktop'

        this.#loaders = {
            gltf: new GLTFLoader(),
            texture: new TextureLoader(),
            ktx: undefined,
            draco: undefined,
            envmap: undefined,
            gainmap: undefined,
        }

        this.addSupport(support).catch(e => console.error(e))
    }

    get loaders() {
        return this.#loaders
    }

    get support() {
        return { ...this.#support }
    }

    get<T extends LoadedAsset = LoadedAsset>(key: string) {
        return this.#resources.get(key) as T | undefined
    }

    getAll() {
        return this.#resources
    }

    has(key: string) {
        return this.#resources.has(key)
    }

    setResponsiveType(v: string) {
        this.#responsiveType = v
    }

    addContext(renderer: WebGLRenderer) {
        this.gl = renderer
        this.#loaders.ktx?.detectSupport(renderer)
    }

    /**
     * Enable optional loaders: resources.addSupport({ ktx: true, draco: true, gainmap: true, envmap: true, curves: true })
     * Resolves once every requested loader is ready (gainmap is loaded lazily).
     */
    addSupport(options: SupportOptions = {}) {
        const requested: Promise<void>[] = []

        Object.entries(options).forEach(([name, enabled]) => {
            const type = name as SupportType
            if (!SUPPORT_TYPES.includes(type)) {
                console.warn(`[Keemera] Unknown resource support "${type}". Available: ${SUPPORT_TYPES.join(', ')}`)
                return
            }
            if (!enabled || this.#support[type]) return

            this.#support[type] = true
            const pending = this.#enable(type)
            if (pending) {
                requested.push(pending)
                // load() waits for it, but a failed optional loader must not block other assets
                this.#pending.push(pending.catch(() => {}))
            }
        })

        return Promise.all(requested)
    }

    #enable(type: SupportType): Promise<void> | undefined {
        const loaders = this.#loaders

        if (type === 'draco') {
            loaders.draco = new DRACOLoader().setDecoderPath(this.#decoders.draco)
            loaders.gltf.setDRACOLoader(loaders.draco)
        }

        else if (type === 'ktx') {
            loaders.ktx = new KTX2Loader().setTranscoderPath(this.#decoders.ktx)
            if (this.gl) { loaders.ktx.detectSupport(this.gl) }
            loaders.gltf.setKTX2Loader(loaders.ktx)
        }

        else if (type === 'envmap') {
            loaders.envmap = new HDRLoader()
        }

        else if (type === 'curves') {
            loaders.gltf.register(parser => new GLTFCurveExtension(parser))
        }

        else if (type === 'gainmap') {
            return import('@monogrid/gainmap-js')
                .then(({ HDRJPGLoader }) => {
                    loaders.gainmap = { HDRJPGLoader: HDRJPGLoader as unknown as HDRJPGLoader, instance: undefined }
                })
                .catch((e) => {
                    this.#support.gainmap = false
                    throw new Error(`[Keemera] gainmap support requires "@monogrid/gainmap-js" to be installed. ${e.message}`)
                })
        }
    }

    #requireSupport(type: SupportType, key: string) {
        if (!this.#support[type]) {
            throw new Error(`[Keemera] Asset "${key}" needs "${type}" support. Enable it with resources.addSupport({ ${type}: true }).`)
        }
    }

    #getGainmapLoader() {
        const gainmap = this.#loaders.gainmap!
        if (!gainmap.instance) {
            if (!this.gl) throw new Error('[Keemera] gainmap assets need a renderer context')
            gainmap.instance = new gainmap.HDRJPGLoader(this.gl).setRenderTargetOptions({ mapping: EquirectangularReflectionMapping })
        }
        return gainmap.instance
    }

    #processCompileQueue() {
        const interval = 10 // ms
        const timeout = 50

        if (this.#isCompileQueueRunning) return
        this.#isCompileQueueRunning = true

        const compile = () => {
            if (this.#isDisposed || this.#compileQueue.length === 0) {
                this.#isCompileQueueRunning = false
                return
            }

            const gl = this.gl!
            const texture = this.#compileQueue.shift()!
            const isCompiled = !!(gl.properties.get(texture) as { __webglTexture?: unknown }).__webglTexture

            if (!isCompiled) { gl.initTexture(texture) }
            if (typeof requestIdleCallback === 'function') {
                requestIdleCallback(compile, { timeout })
            } else {
                setTimeout(compile, interval)
            }
        }

        compile()
    }

    #addToCompileQueue(texture: Texture) {
        this.#compileQueue.push(texture)
        this.#processCompileQueue()
    }

    #applyTextureConfig(texture: Texture, el: Asset) {
        const loaded = texture as LoadedTexture
        loaded.config = el
        if (el.colorSpace === 'SRGBColorSpace') { texture.colorSpace = SRGBColorSpace }
        if ('flipY' in el) { texture.flipY = el.flipY as boolean }
        return loaded
    }

    #loadAsset(el: Asset): Promise<LoadedAsset> {
        const { type, key } = el
        const loaders = this.#loaders

        const fetch = <T>(loader: AnyLoader, path = el.path) => new Promise<T>((res, rej) => {
            loader.load(path, res, undefined, (err) => {
                rej(new Error(`[Keemera] Failed to load "${key}" (${path}): ${(err as Error)?.message || err}`))
            })
        })

        if (type === 'gltf') {
            return fetch<GLTF>(loaders.gltf).then((model) => {
                const loaded = model as LoadedGLTF
                loaded.config = el
                return loaded
            })
        }

        if (type === 'envmap') {
            this.#requireSupport('envmap', key)
            return fetch<DataTexture>(loaders.envmap!).then((texture) => {
                texture.mapping = EquirectangularReflectionMapping
                return this.#applyTextureConfig(texture, el)
            })
        }

        if (type === 'gainmap') {
            this.#requireSupport('gainmap', key)
            return fetch<{ renderTarget: { texture: Texture } }>(this.#getGainmapLoader()).then((result) => {
                const texture = result.renderTarget.texture as LoadedTexture
                texture.config = el
                return texture
            })
        }

        if (type === 'texture') {
            let loader: AnyLoader = loaders.texture
            let path = el.path

            if (el.compress) {
                this.#requireSupport('ktx', key)
                loader = loaders.ktx!
                const suffix = typeof el.compress === 'object' && el.compress.responsive
                    ? (this.#responsiveType === 'desktop' ? '-desktop.ktx2' : '-mobile.ktx2')
                    : '.ktx2'
                path = path.replace(/\.(png|jpe?g)$/, suffix)
            }

            return fetch<Texture>(loader, path).then((texture) => {
                const loaded = this.#applyTextureConfig(texture, el)
                if (!el.preventInit && this.gl) { this.#addToCompileQueue(loaded) }
                return loaded
            })
        }

        if (type === 'fbo') {
            return fetch<Texture>(loaders.texture).then((loaded) => {
                const texture = loaded as LoadedTexture
                texture.config = el
                if (!el.preventInit && this.gl) { this.gl.initTexture(texture) }

                const image = texture.image as FboData['image']
                const imageW = image.width
                const imageH = image.height
                const off = document.createElement('canvas')
                off.width = imageW
                off.height = imageH
                const ctx = off.getContext('2d')!
                ctx.drawImage(image, 0, 0)

                const allData = ctx.getImageData(0, 0, imageW, imageH).data

                const pickPixel = (x: number, y: number): [number, number, number, number] => {
                    const i = (y * imageW + x) * 4
                    return [allData[i], allData[i + 1], allData[i + 2], allData[i + 3]]
                }

                texture.userData.fbo = { image, ctx, allData, pickPixel } satisfies FboData
                return texture
            })
        }

        throw new Error(`[Keemera] Unknown asset type "${type}" for "${key}"`)
    }

    /**
     * Load a list of assets: [{ key, type, path, ...config }]
     * Resolves with the loaded assets in the same order. Rejects if any asset fails.
     */
    async load(assets: Asset[] = [], { onProgress, save = true }: LoadOptions = {}): Promise<LoadedAsset[]> {
        await Promise.all(this.#pending)

        const total = assets.length
        let loaded = 0
        const { events } = this.#store || {}

        const onLoaded = (el: Asset, asset: LoadedAsset, isCached: boolean) => {
            if (save && !isCached) { this.#resources.set(el.key, asset) }
            loaded += 1

            const label = `${el.type}${el.compress ? '-ktx' : ''}`
            console.log(`LOADED:[${label}][${el.key}]${isCached ? ':CACHED' : ''}`)

            const progress: ResourceProgress = { loaded, total, key: el.key, progress: total ? loaded / total : 1 }
            onProgress?.(progress)
            events?.emit(EVENTS.RESOURCES_PROGRESS, progress)

            return asset
        }

        return Promise.all(assets.map((el) => {
            if (this.#resources.has(el.key)) {
                return Promise.resolve(onLoaded(el, this.#resources.get(el.key)!, true))
            }

            try {
                return this.#loadAsset(el).then(asset => onLoaded(el, asset, false))
            } catch (e) {
                return Promise.reject(e)
            }
        }))
    }

    #disposeAsset(asset: LoadedAsset) {
        if (!asset) return

        if ('isTexture' in asset) {
            asset.dispose()
            return
        }

        asset.scene?.traverse?.((child) => {
            const { geometry, material } = child as Partial<Mesh>
            geometry?.dispose?.()
            const materials = Array.isArray(material) ? material : [material]
            materials.forEach((material) => {
                if (!material) return
                Object.values(material).forEach(value => (value as Texture)?.isTexture && (value as Texture).dispose())
                material.dispose()
            })
        })
    }

    dispose() {
        this.#isDisposed = true
        this.#compileQueue = []
        this.#resources.forEach(asset => this.#disposeAsset(asset))
        this.#resources.clear()

        this.#loaders.ktx?.dispose()
        this.#loaders.draco?.dispose()
        this.#loaders.gainmap?.instance?.dispose?.()
    }
}
