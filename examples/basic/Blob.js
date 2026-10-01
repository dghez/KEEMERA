import { Mesh, IcosahedronGeometry, ShaderMaterial } from 'three'
import { noise3d, map } from 'keemera/shaders'

const vertexShader = /* glsl */ `
    ${noise3d}
    ${map}

    uniform float uTime;
    uniform vec2 uMouse;
    varying float vNoise;

    void main() {
        float n = snoise(position * 0.04 + vec3(uMouse, uTime * 0.4));
        vNoise = map(n, -1.0, 1.0, 0.0, 1.0);
        vec3 p = position + normal * n * 6.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }
`

const fragmentShader = /* glsl */ `
    varying float vNoise;

    void main() {
        gl_FragColor = vec4(mix(vec3(0.95, 0.35, 0.1), vec3(0.2, 0.4, 1.0), vNoise), 1.0);
    }
`

export default class Blob extends Mesh {
    constructor({ store }) {
        const { uniforms } = store

        super(
            new IcosahedronGeometry(30, 32),
            new ShaderMaterial({
                vertexShader,
                fragmentShader,
                uniforms: {
                    uTime: uniforms.time,
                    uMouse: uniforms.mouse.smooth,
                },
            }),
        )
    }

    update({ delta }) {
        this.rotation.y += delta * 0.3
    }

    destroy() {
        this.geometry.dispose()
        this.material.dispose()
    }
}
