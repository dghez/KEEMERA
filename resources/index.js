import { REVISION, TextureLoader, EquirectangularReflectionMapping, SRGBColorSpace } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
// import { HDRJPGLoader } from '@monogrid/gainmap-js'
// import { GLTFCurveExtension } from './GLTFCurveExtension.js'
// import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
// import {preloadFont} from 'troika-three-text'

import globalData from './data.yml'

class Resources {
    #resources

    #responsiveType
    #compileQueue
    #isCompileQueueRunning
    #deferredResources
    #loaders

    constructor() {
        this.gl = false // don't create, needs to use the same context to support compiles

        this.#resources = new Map()
        this.#compileQueue = []
        this.#isCompileQueueRunning = false
        this.#responsiveType = 'desktop'

        this.#loaders = {
            gltf: new GLTFLoader(),
            tl: new TextureLoader(),
            gainmap: undefined, // created after, needs to be the same context
            ktx: new KTX2Loader(),
            // rgbe: new RGBELoader(),
        }

        // this.#loaders.gltf.register(parser => new GLTFCurveExtension(parser))

        // DRACO
        const dl = new DRACOLoader()
        dl.setDecoderPath(`https://cdn.jsdelivr.net/npm/three@0.${REVISION}/examples/jsm/libs/draco/gltf/`)
        this.#loaders.gltf.setDRACOLoader(dl)

        // KTX
        this.#loaders.ktx.setTranscoderPath(`https://cdn.jsdelivr.net/npm/three@0.${REVISION}/examples/jsm/libs/basis/`)
        // DEFERRED
        this.#deferredResources = []
    }

    get(v) {
        return v === 'all' ? this.#resources : this.#resources.get(v)
    }

    get loaders() {
        return this.#loaders
    }

    addContext(context) {
        this.gl = context
        this.#loaders?.ktx?.detectSupport(context)
        //this.#loaders.gainmap = new HDRJPGLoader(context).setRenderTargetOptions({ mapping: EquirectangularReflectionMapping })
    }

    setResponsiveType(v) {
        this.#responsiveType = v
    }

    #processCompileQueue() {
        const interval = 10 // ms
        const timeout = 50

        if (this.#isCompileQueueRunning) return
        this.#isCompileQueueRunning = true

        const compile = () => {
            if (this.#compileQueue.length === 0) {
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

    async loadDeferredResources() {
        const onLoaded = () => this.#deferredResources = []
        return this.load({ data: this.#deferredResources, isDeferCall: true }).then(() => onLoaded())
    }

    load({ data = [], isDeferCall = false, preventSave = false } = {}) {
        let all = preventSave ? [...data] : [...data, ...globalData || []]

        const onLoadFeedback = (el, res, asset = false, isCached = false, preventSave = false) => {
            if (asset && !preventSave) { this.#resources.set(el.key, asset) }

            let string = isCached ? `LOADED:[${el.type}${el.compress ? '-ktx' : ''}][${el.key}]:CACHED` : `LOADED:[${el.type}${el.compress ? '-ktx' : ''}][${el.key}]`
            if (isDeferCall) { string = `DEFERRED || ${string}` }
            console.log(string)

            res(asset)
        }

        // LOAD
        const proms = all.map((el) => {
            let p

            if (this.#resources.has(el.key)) {
                return new Promise(res =>
                    onLoadFeedback(el, res, false, true, preventSave)
                )
            }

            /**
            * GLB
            */
            if (el.type === 'gltf') {
                p = new Promise((res) => {
                    this.#loaders.gltf.load(el.path, (model) => {
                        model.config = el
                        onLoadFeedback(el, res, model, false, preventSave)
                    })
                })
            }

            /**
             * ENVMAP
             */
            else if (el.type === 'envmap') {
                p = new Promise((res) => {
                    this.#loaders.rgbe.load(el.path, (texture) => {
                        texture.config = el

                        if (el.colorSpace === 'SRGBColorSpace') {
                            texture.colorSpace = SRGBColorSpace
                        }

                        onLoadFeedback(el, res, texture, false, preventSave)
                    })
                })
            }

            /**
             * GAINMAP
             */
            else if (el.type === 'gainmap') {
                p = new Promise((res) => {
                    this.#loaders.gainmap.load(el.path, (texture) => {
                        const asset = texture.renderTarget.texture
                        asset.config = el

                        onLoadFeedback(el, res, asset, false, preventSave)
                    })
                })
            }

            /**
             * TEXTURE KTX && REGULAR
             */
            else if (el.type === 'texture') {

                const isCompressed = el?.compress
                let loader = this.#loaders.tl

                if (isCompressed) {
                    loader = this.#loaders.ktx
                    if (el.compress?.responsive) {
                        const final = this.#responsiveType === 'desktop' ? '-desktop.ktx2' : '-mobile.ktx2'
                        el.path = el.path.replace(/\.(png|jpg)/, final)
                    } else {
                        el.path = el.path.replace(/\.(png|jpg)/, '.ktx2')
                    }
                }

                p = new Promise((res) => {
                    loader.load(el.path, (texture) => {
                        texture.config = el

                        if (el.colorSpace === 'SRGBColorSpace') {
                            texture.colorSpace = SRGBColorSpace
                        }

                        if ('flipY' in el) {
                            texture.flipY = el.flipY
                        }

                        if (!el.preventInit && this.gl) {
                            this.#addToCompileQueue(texture)
                        }

                        onLoadFeedback(el, res, texture, false, preventSave)
                    })
                })
            }

            /**
             * FBO // DATA
             */
            else if (el.type === 'fbo') {
                p = new Promise((res) => {
                    this.#loaders.tl.load(el.path, (texture) => {
                        texture.config = el

                        if (!el.preventInit) {
                            this.gl.initTexture(texture)
                        }

                        // HANDLE DATA READ
                        const { image } = texture // HTMLImageElement
                        const imageW = image.width
                        const imageH = image.height
                        const off = document.createElement('canvas')
                        off.width = imageW
                        off.height = imageH
                        const ctx = off.getContext('2d')
                        ctx.drawImage(image, 0, 0)

                        const allData = ctx.getImageData(0, 0, imageW, imageH).data // Uint8ClampedArray

                        const pickPixel = (x, y) =>{
                            const i = (y * imageW + x) * 4
                            return [ allData[i], allData[i + 1], allData[i + 2], allData[i + 3], ]
                        }

                        // TRIED TO PICK UVS BASED ON COLORS. Leave it here if necessary in the future
                        // const validUvs = {
                        //     r: [],
                        //     g: []
                        // }

                        // // PRE-COMPUTE UVS
                        // const pixels = allData // RGBA array
                        // const p = performance.now()
                        // const t = 128
                        // const getCoords = (i) => {
                        //     const pixelIndex = i / 4
                        //     const x = pixelIndex % imageW
                        //     const y = Math.floor(pixelIndex / imageW)
                        //     return { u: x / imageW, v: y / imageH }
                        // }

                        // for (let i = 0; i < pixels.length; i += 4) {
                        //     const r = pixels[i + 0]
                        //     const g = pixels[i + 1]

                        //     if (r > t){ validUvs.r.push(getCoords(i)) }
                        //     if (g > t){ validUvs.g.push(getCoords(i)) }
                        // }

                        // console.log(`%c[🤖 PRE COMPUTE UVS 🤖]: ${Math.floor((performance.now() - p))}ms %c`, 'background: #0f0f0f; color: white; padding: 6px 4px;', '')

                        // SAVE DATA
                        texture.userData.fbo = { image, ctx, allData, pickPixel }

                        onLoadFeedback(el, res, texture, false, preventSave)
                    })
                })
            }

            return p
        })

        return Promise.all(proms)
    }
}

const resources = new Resources() // client-side only

const getResource = (key) => {
    return resources.get(key)
}

export default resources
export { getResource }
