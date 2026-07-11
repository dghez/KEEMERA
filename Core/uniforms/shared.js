import { Vector3, Vector4, Vector2, Color } from 'three'

const V2 = new Vector2()
const V3 = new Vector3()
const V4 = new Vector4()
const COLOR = new Color()

export default {
    time: { value: 0 },
    timeScale: { value: 1 },
    resolution: { value: V3.clone() },
    camera: {
        side: { value: V3.clone() },
    },
    mouse: {
        smooth: { value: V2.clone() },
        smoother: { value: V2.clone() },
    }
}
