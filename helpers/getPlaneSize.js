import { MathUtils } from "three"

// this gives the "visible" plane sizes that is visible from the camera at a certain distance
export default function getPlaneSize(camera, distance) {
    const vFOV = MathUtils.degToRad(camera.fov)
    const height = 2 * Math.tan(vFOV / 2) * distance
    const width = height * camera.aspect

    return { width, height }
}
