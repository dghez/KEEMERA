import { Vector3, Vector2 } from 'three'

export default function createUniforms() {
    return {
        time: { value: 0 },
        timeScale: { value: 1 },
        resolution: { value: new Vector3() },
        mouse: {
            smooth: { value: new Vector2() },
            smoother: { value: new Vector2() },
        },
    }
}
