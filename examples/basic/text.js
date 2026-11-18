import { gsap } from 'gsap'
import Lenis from 'lenis'
import Keemera, { EVENTS, PRIORITY, Shepherd } from '@dghez/keemera'
import { TextLayer } from '@dghez/keemera/shards'

/* ───────── Options: ?compare, ?wireframe, ?debug ───────── */

const params = new URLSearchParams(window.location.search)

/* ───────── Stress copy: deterministic, about 10k glyphs ───────── */

const WORDS = 'outline curve band glyph pixel winding coverage quadratic browser layout kerning baseline ray texel instance shader scroll measure range font face ink edge sample'.split(' ')
let seed = 7
const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647

const stress = document.querySelector('[data-stress]')
for (let p = 0; p < 24; p++) {
    const words = Array.from({ length: 62 }, () => WORDS[Math.floor(random() * WORDS.length)])
    words[0] = words[0][0].toUpperCase() + words[0].slice(1)
    const el = document.createElement('p')
    el.dataset.text = ''
    el.textContent = `${words.join(' ')}.`
    stress.append(el)
}

/* ───────── App ───────── */

const lenis = new Lenis({ lerp: 0.12, wheelMultiplier: 1.1, autoResize: false })

const wrapper = document.querySelector('[data-gl]')
const app = new Keemera({
    wrapper,
    canvas: wrapper.querySelector('canvas'),
    debug: params.has('debug'),
    autoRun: false,
    // Slug antialiases every glyph itself
    renderer: { antialias: false },
    clearAlpha: 0,
    camera: { useDomSize: true },
    // baked from examples/assets/fonts with `npm run fonts`
    preload: [{ key: 'geist', type: 'font', path: '/fonts/geist.kfont' }],
})

lenis.on('scroll', ({ scroll }) => app.setScroll(scroll))
app.setScroll(lenis.scroll)
app.events.on(EVENTS.APP_RESIZE, () => lenis.resize(), PRIORITY.first)

await app.ready

/* ───────── Text layer ───────── */

const text = new TextLayer({ store: app.store, compare: params.has('compare'), wireframe: params.has('wireframe') })

// W toggles the glyph boxes
window.addEventListener('keydown', (e) => {
    if (e.key === 'w' && !e.metaKey && !e.ctrlKey && !e.target.isContentEditable) text.wireframe = !text.wireframe
})
app.scene.add(text)

document.querySelectorAll('[data-text]').forEach((el) => {
    text.track(el, { live: el.dataset.text === 'live' })
})

const shepherd = new Shepherd()
shepherd.add(text)

app.events.on(EVENTS.APP_TICK, state => shepherd.update(state))
app.events.on(EVENTS.APP_RESIZE, state => shepherd.resize(state))
app.events.on(EVENTS.APP_DESTROY, () => shepherd.destroy())

/* ───────── HUD ───────── */

const hud = document.querySelector('[data-hud]')
let fps = 60

app.events.on(EVENTS.WEBGL_AFTER_RENDER, ({ delta, frame }) => {
    if (delta > 0) fps += (1 / delta - fps) * 0.08
    if (frame % 10) return

    const blocks = text.blocks
    const drawn = blocks.filter(b => b.isDrawn)
    const glyphs = drawn.reduce((sum, b) => sum + b.glyphCount, 0)
    hud.textContent = [
        `fps     ${Math.round(fps)}`,
        `calls   ${app.gl.info.render.calls}`,
        `blocks  ${drawn.length} / ${blocks.length}`,
        `glyphs  ${glyphs}`,
        `W       ${text.wireframe ? 'wireframe' : 'glyphs'}`,
    ].join('\n')
})

/* ───────── Loop: Lenis first, then Keemera, on the gsap ticker ───────── */

gsap.ticker.add((time) => {
    lenis.raf(time * 1000)
    app.tick()
})
gsap.ticker.lagSmoothing(0)

window.keemera = { app, lenis, text }
