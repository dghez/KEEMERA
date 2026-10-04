import { gsap } from 'gsap'
import Lenis from 'lenis'
import Keemera, { EVENTS, PRIORITY, Shepherd } from 'keemera'

import './style.css'
import Scene from './Scene'
import Post from './Post'
import { ease } from './ink'

const params = new URLSearchParams(window.location.search)
const debug = params.has('debug')
const smear = !params.has('nosmear')

const lenis = new Lenis({
    lerp: 0.12,
    wheelMultiplier: 1.1,
    autoResize: false,
})

const wrapper = document.querySelector('[data-keemera-canvas]')
const app = new Keemera({
    wrapper,
    canvas: wrapper.querySelector('canvas'),
    debug,
    autoRun: false,
    renderer: { antialias: false },
    clearColor: 0x000000,
    clearAlpha: 0,
    camera: { fov: 45, useDomSize: true },
    // from examples/assets (vite publicDir)
    preload: [
        { key: 'plate', type: 'texture', path: '/keemera-plate.png' },
        { key: 'beast', type: 'texture', path: '/keemera-2.jpeg' },
        { key: 'medusa', type: 'texture', path: '/keemera-3.jpeg' },
    ],
})

lenis.on('scroll', ({ scroll }) => app.setScroll(scroll))
app.setScroll(lenis.scroll)
app.events.on(EVENTS.APP_RESIZE, () => lenis.resize(), PRIORITY.first)

await app.ready

// shared uniforms: velocity is written by Scene, lens radius (css px) by the hero
app.store.uniforms.scrollVelocity = { value: 0 }
app.store.uniforms.lensRadius = { value: 120 }

const shepherd = new Shepherd()
const scene = new Scene({ store: app.store, texture: app.resources.get('plate') })
app.scene.add(scene)
shepherd.add(scene)

const post = new Post({ store: app.store, smear })
app.setRenderFunction(post.render)

app.events.on(EVENTS.APP_TICK, state => shepherd.update(state))
app.events.on(EVENTS.APP_RESIZE, state => shepherd.resize(state))
app.events.on(EVENTS.APP_DESTROY, () => shepherd.destroy())
app.resize()

// web fonts shift the layout, so trackers measure again once they're in
document.fonts.ready.then(() => app.resize())

// intro: the plate is engraved line by line
if (scene.hero) gsap.to(scene.hero.intro, { value: 1, duration: 3.2, ease: 'power1.inOut', delay: 0.2 })

// title: name -> pronunciation -> name, on loop. The word breaks into rubric ink grain and bleeds away,
// then, once it's gone, the next gathers out of the grain and settles to solid ink
const swap = document.querySelector('[data-ink-swap]')
if (swap && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const [name, ipa] = swap.children
    const grain = id => ({
        threshold: document.querySelector(`#${id} feFuncA`),
        bleed: document.querySelector(`#${id} feDisplacementMap`),
    })
    const filters = new Map([[name, grain('ink-a')], [ipa, grain('ink-b')]])
    const root = getComputedStyle(document.documentElement)
    const ink = root.getPropertyValue('--color-ink').trim()
    const rubric = root.getPropertyValue('--color-rubric').trim()

    gsap.set(ipa, { color: rubric })
    gsap.set(filters.get(ipa).threshold, { attr: { intercept: -30 } })

    const dissolve = (tl, from, to) => {
        const a = filters.get(from)
        const b = filters.get(to)
        tl.to(from, { color: rubric, duration: 0.5, ease: 'power1.in' })
            .to(a.threshold, { attr: { intercept: -30 }, duration: 1.1, ease: 'power2.in' }, '<0.2')
            .to(a.bleed, { attr: { scale: 10 }, duration: 1.1, ease: 'power2.in' }, '<')
            // the old word is fully gone before the new one starts to gather
            .set(a.bleed, { attr: { scale: 0 } })
            .fromTo(b.bleed, { attr: { scale: 10 } }, { attr: { scale: 0 }, duration: 1.2, ease: 'power2.out' }, '+=0.1')
            .to(b.threshold, { attr: { intercept: 1 }, duration: 1.2, ease: 'power2.out' }, '<')
            .to(to, { color: ink, duration: 0.6, ease: 'power1.out' }, '-=0.4')
    }

    const tl = gsap.timeline({ repeat: -1, delay: 3.6, repeatDelay: 3 })
    dissolve(tl, name, ipa)
    tl.to({}, { duration: 2.6 })
    dissolve(tl, ipa, name)
}

// live store readout
const hud = Object.fromEntries([...document.querySelectorAll('[data-hud]')].map(el => [el.dataset.hud, el]))
const meter = document.querySelector('[data-scroll-meter]')
const sign = n => (n < 0 ? '−' : '+') + Math.abs(n).toFixed(2)
let fps = 60

// reading scrollHeight forces a layout, so only do it on resize
let scrollRange = 1
const measureScroll = () => { scrollRange = Math.max(document.documentElement.scrollHeight - app.viewport.height, 1) }
measureScroll()
app.events.on(EVENTS.APP_RESIZE, measureScroll)

app.events.on(EVENTS.APP_TICK, ({ delta, frame, scroll, width, height }) => {
    if (delta > 0) fps = ease(fps, 1 / delta, 1, 0.08)
    if (frame % 4) return

    const m = app.mouse.smooth
    if (hud.frame) hud.frame.textContent = String(frame).padStart(6, '0')
    if (hud.fps) hud.fps.textContent = Math.round(fps)
    if (hud.scroll) hud.scroll.textContent = Math.round(scroll)
    if (hud.velocity) hud.velocity.textContent = sign(app.store.uniforms.scrollVelocity.value)
    if (hud.mouse) hud.mouse.textContent = `${sign(m.x)} ${sign(m.y)}`
    if (hud.size) hud.size.textContent = `${width}×${height}`

    if (meter) meter.textContent = String(Math.round((scroll / scrollRange) * 100)).padStart(3, '0')
})

gsap.ticker.add((time) => {
    lenis.raf(time * 1000)
    app.tick()
})
gsap.ticker.lagSmoothing(0)

if (debug) {
    console.log('events', app.events.getEvents())
}

window.keemera = { app, lenis, post }
