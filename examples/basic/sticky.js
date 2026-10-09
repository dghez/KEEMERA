import { gsap } from 'gsap'
import { Color } from 'three'
import Lenis from 'lenis'
import Keemera, { EVENTS, PRIORITY, Shepherd } from '@dghez/keemera'
import { PlaneBackground } from '@dghez/keemera/shards'

// Sticky Tracker test page: case A is compared against a CSS `position: sticky` twin every frame
const lenis = new Lenis({
    lerp: 0.12,
    wheelMultiplier: 1.1,
    autoResize: false,
})

const wrapper = document.querySelector('[data-gl]')
const app = new Keemera({
    wrapper,
    canvas: wrapper.querySelector('canvas'),
    autoRun: false,
    clearAlpha: 0,
    camera: { useDomSize: true },
})

lenis.on('scroll', ({ scroll }) => app.setScroll(scroll))
app.setScroll(lenis.scroll)
app.events.on(EVENTS.APP_RESIZE, () => lenis.resize(), PRIORITY.first)

await app.ready

const plane = (tracker, sticky) => {
    const p = new PlaneBackground({ store: app.store, tracker, sticky, preventUpdateScale: false })
    p.material.color.set(0xa3392a)
    p.material.transparent = true
    p.material.opacity = 0.75
    app.scene.add(p)
    return p
}

// the box scales with the page width, so the release point is read from its current height on every resize
const boxA = document.querySelector('#box-a')
const a = plane(boxA, {
    container: '.case-a',
    end: () => `bottom top+=${40 + boxA.getBoundingClientRect().height}`,
})
const b = plane('#box-b', '.case-b')

const shepherd = new Shepherd()
shepherd.add(a, b)

const twin = document.querySelector('.case-a .twin')
const hud = document.querySelector('[data-hud]')
const bars = { a: document.querySelector('[data-bar="a"]'), b: document.querySelector('[data-bar="b"]') }

// stickyProgress drives the plane tint (rubric at 0, ink-blue at 1) and the HUD bars
const FROM = new Color(0xa3392a)
const TO = new Color(0x2a4fa3)
const showProgress = (p, bar) => {
    p.material.color.lerpColors(FROM, TO, p.stickyProgress)
    bar.style.transform = `scaleX(${p.stickyProgress})`
}

// the plane's top edge in viewport px, from its world position
const screenTop = (p, height) => height * 0.5 - p.position.y - p.trackSize.h * 0.5

let maxDelta = 0

app.events.on(EVENTS.APP_RESIZE, state => shepherd.resize(state))
app.events.on(EVENTS.APP_TICK, (state) => {
    shepherd.update(state)
    showProgress(a, bars.a)
    showProgress(b, bars.b)

    const { height, scroll } = state
    const delta = screenTop(a, height) - twin.getBoundingClientRect().top
    maxDelta = Math.max(maxDelta, Math.abs(delta))

    hud.textContent = [
        `scroll        ${Math.round(scroll)}`,
        `A top         ${screenTop(a, height).toFixed(1)}`,
        `A − twin      ${delta.toFixed(2)} px`,
        `max |A − twin| ${maxDelta.toFixed(2)} px`,
        `A isActive    ${a.isActive}`,
        `A progress    ${a.stickyProgress.toFixed(3)}`,
        `B top         ${screenTop(b, height).toFixed(1)}`,
        `B isActive    ${b.isActive}`,
        `B progress    ${b.stickyProgress.toFixed(3)}`,
    ].join('\n')
})

// one clock: Lenis scrolls, then the frame renders with that same scroll
gsap.ticker.add((time) => {
    lenis.raf(time * 1000)
    app.tick()
})
gsap.ticker.lagSmoothing(0)

window.sticky = { app, lenis, a, b, twin, screenTop, resetMax: () => { maxDelta = 0 } }
