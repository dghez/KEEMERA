import { BufferGeometry, BufferAttribute, Mesh } from 'three'

const GEO = new BufferGeometry()
const vertices = new Float32Array([
    -1.0, -1.0, 0.0,
    3.0, -1.0, 0.0,
    -1.0, 3.0, 0.0,
])
const uvs = new Float32Array([0, 0, 2, 0, 0, 2])

GEO.setAttribute('uv', new BufferAttribute(uvs, 2))
GEO.setAttribute('position', new BufferAttribute(vertices, 3))

const vertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    gl_FragColor = vec4(vUv, 0.0, 1.0);
  }
`

export { vertexShader, fragmentShader }

export default class FullScreenQuad extends Mesh {
    constructor(material) {
        super(GEO, material)
    }
}
