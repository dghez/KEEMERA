import type { GLTFLoaderPlugin, GLTFParser } from 'three/addons/loaders/GLTFLoader.js'

export declare class GLTFCurveExtension implements GLTFLoaderPlugin {
    constructor(parser: GLTFParser)
    parser: GLTFParser
    name: string
}
