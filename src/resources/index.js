import { REVISION, TextureLoader, EquirectangularReflectionMapping, SRGBColorSpace } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'

import { EVENTS } from '../events'
import { GLTFCurveExtension } from './GLTFCurveExtension.js'

const CDN = `https://cdn.jsdelivr.net/npm/three@0.${REVISION}/examples/jsm/libs`

const DEFAULT_DECODERS = {
    draco: `${CDN}/draco/gltf/`,
    ktx: `${CDN}/basis/`,
}

const SUPPORT_TYPES = ['ktx', 'draco', 'gainmap', 'envmap', 'curves']

export default class Resources {
    #store
    #resources
    #support
    #decoders
    #loaders
    #pending
    #responsiveType
    #compileQueue
    #isCompileQueueRunning
    #isDisposed

    constructor({ store, support = {}, decoders = {} } = {}) {
        this.#store = store
        this.gl = undefined // set by addContext, loaders that compile/upload need the same context

        this.#resources = new Map()
        this.#support = Object.fromEntries(SUPPORT_TYPES.map(type => [type, false]))
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

    get(key) {
        return this.#resources.get(key)
    }

    getAll() {
        return this.#resources
    }

    has(key) {
        return this.#resources.has(key)
    }

    setResponsiveType(v) {
        this.#responsiveType = v
    }

    addContext(renderer) {
        this.gl = renderer
        this.#loaders.ktx?.detectSupport(renderer)
    }

    /**
     * Enable optional loaders: resources.addSupport({ ktx: true, draco: true, gainmap: true, envmap: true, curves: true })
     * Resolves once every requested loader is ready (gainmap is loaded lazily).
     */
    addSupport(options = {}) {
        const requested = []

        Object.entries(options).forEach(([type, enabled]) => {
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

    #enable(type) {
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
                    loaders.gainmap = { HDRJPGLoader, instance: undefined }
                })
                .catch((e) => {
                    this.#support.gainmap = false
                    throw new Error(`[Keemera] gainmap support requires "@monogrid/gainmap-js" to be installed. ${e.message}`)
                })
        }
    }

    #requireSupport(type, key) {
        if (!this.#support[type]) {
            throw new Error(`[Keemera] Asset "${key}" needs "${type}" support. Enable it with resources.addSupport({ ${type}: true }).`)
        }
    }

    #getGainmapLoader() {
        const gainmap = this.#loaders.gainmap
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

            const texture = this.#compileQueue.shift()
            const isCompiled = !!this.gl.properties.get(texture).__webglTexture

            if (!isCompiled) { this.gl.initTexture(texture) }
            if (typeof requestIdleCallback === 'function') {
                requestIdleCallback(compile, { timeout })
            } else {
                setTimeout(compile, interval)
            }
        }

        compile()
    }

    #addToCompileQueue(texture) {
        this.#compileQueue.push(texture)
        this.#processCompileQueue()
    }

    #applyTextureConfig(texture, el) {
        texture.config = el
        if (el.colorSpace === 'SRGBColorSpace') { texture.colorSpace = SRGBColorSpace }
        if ('flipY' in el) { texture.flipY = el.flipY }
    }

    #loadAsset(el) {
        const { type, key } = el
        const loaders = this.#loaders

        const fetch = (loader, path = el.path) => new Promise((res, rej) => {
            loader.load(path, res, undefined, (err) => {
                rej(new Error(`[Keemera] Failed to load "${key}" (${path}): ${err?.message || err}`))
            })
        })

        if (type === 'gltf') {
            return fetch(loaders.gltf).then((model) => {
                model.config = el
                return model
            })
        }

        if (type === 'envmap') {
            this.#requireSupport('envmap', key)
            return fetch(loaders.envmap).then((texture) => {
                texture.mapping = EquirectangularReflectionMapping
                this.#applyTextureConfig(texture, el)
                return texture
            })
        }

        if (type === 'gainmap') {
            this.#requireSupport('gainmap', key)
            return fetch(this.#getGainmapLoader()).then((result) => {
                const texture = result.renderTarget.texture
                texture.config = el
                return texture
            })
        }

        if (type === 'texture') {
            let loader = loaders.texture
            let path = el.path

            if (el.compress) {
                this.#requireSupport('ktx', key)
                loader = loaders.ktx
                const suffix = el.compress?.responsive
                    ? (this.#responsiveType === 'desktop' ? '-desktop.ktx2' : '-mobile.ktx2')
                    : '.ktx2'
                path = path.replace(/\.(png|jpe?g)$/, suffix)
            }

            return fetch(loader, path).then((texture) => {
                this.#applyTextureConfig(texture, el)
                if (!el.preventInit && this.gl) { this.#addToCompileQueue(texture) }
                return texture
            })
        }

        if (type === 'fbo') {
            return fetch(loaders.texture).then((texture) => {
                texture.config = el
                if (!el.preventInit && this.gl) { this.gl.initTexture(texture) }

                const { image } = texture
                const imageW = image.width
                const imageH = image.height
                const off = document.createElement('canvas')
                off.width = imageW
                off.height = imageH
                const ctx = off.getContext('2d')
                ctx.drawImage(image, 0, 0)

                const allData = ctx.getImageData(0, 0, imageW, imageH).data

                const pickPixel = (x, y) => {
                    const i = (y * imageW + x) * 4
                    return [allData[i], allData[i + 1], allData[i + 2], allData[i + 3]]
                }

                texture.userData.fbo = { image, ctx, allData, pickPixel }
                return texture
            })
        }

        throw new Error(`[Keemera] Unknown asset type "${type}" for "${key}"`)
    }

    /**
     * Load a list of assets: [{ key, type, path, ...config }]
     * Resolves with the loaded assets in the same order. Rejects if any asset fails.
     */
    async load(assets = [], { onProgress, save = true } = {}) {
        await Promise.all(this.#pending)

        const total = assets.length
        let loaded = 0
        const { events, isDebug } = this.#store || {}

        const onLoaded = (el, asset, isCached) => {
            if (save && !isCached) { this.#resources.set(el.key, asset) }
            loaded += 1

            if (isDebug) {
                const label = `${el.type}${el.compress ? '-ktx' : ''}`
                console.log(`LOADED:[${label}][${el.key}]${isCached ? ':CACHED' : ''}`)
            }

            const progress = { loaded, total, key: el.key, progress: total ? loaded / total : 1 }
            onProgress?.(progress)
            events?.emit(EVENTS.RESOURCES_PROGRESS, progress)

            return asset
        }

        return Promise.all(assets.map((el) => {
            if (this.#resources.has(el.key)) {
                return Promise.resolve(onLoaded(el, this.#resources.get(el.key), true))
            }

            try {
                return this.#loadAsset(el).then(asset => onLoaded(el, asset, false))
            } catch (e) {
                return Promise.reject(e)
            }
        }))
    }

    #disposeAsset(asset) {
        if (!asset) return

        if (asset.isTexture) {
            asset.dispose()
            return
        }

        asset.scene?.traverse?.((child) => {
            child.geometry?.dispose?.()
            const materials = Array.isArray(child.material) ? child.material : [child.material]
            materials.forEach((material) => {
                if (!material) return
                Object.values(material).forEach(value => value?.isTexture && value.dispose())
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
