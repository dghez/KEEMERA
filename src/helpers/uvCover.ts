import { RepeatWrapping } from 'three'
import type { Texture } from 'three'

export default function uvCover(map: Texture, sizes: [number, number] = [1, 1]) {
    const planeAspect = sizes[0] / sizes[1]
    const imageAspect = map.width / map.height

    let repeatX = 1, repeatY = 1, offsetX = 0, offsetY = 0

    if (imageAspect > planeAspect) {
        repeatX = planeAspect / imageAspect
        offsetX = (1 - repeatX) / 2
    } else {
        repeatY = imageAspect / planeAspect
        offsetY = (1 - repeatY) / 2
    }

    map.repeat.set(repeatX, repeatY)
    map.offset.set(offsetX, offsetY)
    map.wrapS = map.wrapT = RepeatWrapping
    map.needsUpdate = true
}
