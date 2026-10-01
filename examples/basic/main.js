import { gsap } from 'gsap'
import Lenis from 'lenis'
import Keemera, { EVENTS, PRIORITY } from 'keemera'

import Scene from './Scene'
import Blob from './Blob'

const debug = new URLSearchParams(window.location.search).has('debug')

// Lenis runs on the same gsap ticker as Keemera, so scroll and render stay in sync
const lenis = new Lenis()
gsap.ticker.add(time => lenis.raf(time * 1000))
gsap.ticker.lagSmoothing(0)

/**
 * INSTANCE A: full-screen, autoRun on gsap.ticker, Tracker planes driven by Lenis
 */
const mainEl = document.querySelector('.gl-main')
const a = new Keemera({
    wrapper: mainEl,
    canvas: mainEl.querySelector('canvas'),
    debug,
    clearColor: 0x0b0b0c,
    camera: { fov: 45 },
})

lenis.on('scroll', ({ scroll }) => a.setScroll(scroll))
a.setScroll(lenis.scroll)

await a.ready

const scene = new Scene({ store: a.store })
a.scene.add(scene)
a.shepherd.add(scene)
a.resize()

/**
 * INSTANCE B: lives in a card, autoRun off, ticked manually, no internal gestures
 */
const cardEl = document.querySelector('[data-card]')
const b = new Keemera({
    wrapper: cardEl,
    canvas: cardEl.querySelector('canvas'),
    debug,
    autoRun: false,
    gestures: false,
    renderer: { antialias: true },
    clearColor: 0x151517,
})

await b.ready

const blob = new Blob({ store: b.store })
b.scene.add(blob)
b.shepherd.add(blob)

// external gesture logic feeding the internal pointer, using the documented payload
cardEl.addEventListener('pointermove', (e) => {
    const r = cardEl.getBoundingClientRect()
    b.events.emit(EVENTS.APP_MOUSE_MOVE, { xy: [e.clientX - r.left, e.clientY - r.top] })
})

gsap.ticker.add(b.tick)

// custom events and priorities are per instance
b.events.addEvents({ BLOB_PULSE: 'BLOB:PULSE' })
b.events.addPriorities({ late: 40 })
b.events.on('BLOB:PULSE', () => gsap.fromTo(blob.scale, { x: 1.2, y: 1.2, z: 1.2 }, { x: 1, y: 1, z: 1, duration: 0.6 }))
b.events.on(EVENTS.WEBGL_AFTER_RENDER, () => {}, 'late')
a.events.on(EVENTS.APP_TICK, () => {}, PRIORITY.first)
cardEl.addEventListener('click', () => b.events.emit('BLOB:PULSE'))

if (debug) {
    console.log('A events', a.events.getEvents())
    console.log('B priorities', b.events.getPriorities())
}

window.keemera = { a, b, lenis }
