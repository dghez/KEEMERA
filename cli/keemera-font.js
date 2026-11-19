#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { bake, DEFAULT_TOLERANCE, encode } from './bake.js'
import { codepointsFromRanges, codepointsFromText } from './charsets.js'

const USAGE = `Bake fonts into a .kfont pack for keemera's TextLayer

Usage
  keemera-font <font...> -o <out.kfont> [options]

Inputs are TTF, OTF, WOFF or WOFF2. Bake the same files your CSS @font-face serves.
Several inputs go into one pack: one texture, one draw call for all of its faces.

Options
  -o, --out <file>      output .kfont file (required)
  -r, --ranges <names>  comma separated: ascii, latin (default), all
  -c, --chars <text>    extra characters to include
  -f, --family <name>   family name to match in CSS (default: the font's own)
  -a, --axes <values>   variable font instance, e.g. wght=500,opsz=14
  -t, --tolerance <em>  refit outlines with fewer curves within this distance, em (default ${DEFAULT_TOLERANCE}, 0 = off)
  -h, --help            show this message
`

const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
        out: { type: 'string', short: 'o' },
        ranges: { type: 'string', short: 'r', default: 'latin' },
        chars: { type: 'string', short: 'c', default: '' },
        family: { type: 'string', short: 'f' },
        axes: { type: 'string', short: 'a' },
        tolerance: { type: 'string', short: 't' },
        help: { type: 'boolean', short: 'h' },
    },
})

if (values.help || !positionals.length || !values.out) {
    console.log(USAGE)
    process.exit(values.help ? 0 : 1)
}

let fontkit
try {
    fontkit = await import('fontkit')
} catch {
    console.error('[Keemera] keemera-font needs "fontkit". Install it with: npm i -D fontkit')
    process.exit(1)
}

const parseAxes = (text) => {
    if (!text) return null
    return Object.fromEntries(text.split(',').map((pair) => {
        const [tag, value] = pair.split('=')
        if (!tag || value === undefined || Number.isNaN(Number(value))) {
            throw new Error(`[Keemera] Invalid --axes "${text}". Use tag=value pairs, e.g. wght=500,opsz=14`)
        }
        return [tag.trim(), Number(value)]
    }))
}

const ranges = values.ranges.split(',').map(s => s.trim()).filter(Boolean)
const codepoints = ranges.includes('all')
    ? 'all'
    : new Set([...codepointsFromRanges(ranges), ...codepointsFromText(values.chars)])
const axes = parseAxes(values.axes)

const faces = positionals.map((path) => {
    let font = fontkit.openSync(resolve(path))
    // a collection (.ttc): take its first face
    if (font.fonts) font = font.fonts[0]
    if (axes) {
        if (!Object.keys(font.variationAxes ?? {}).length) {
            throw new Error(`[Keemera] ${path} is not a variable font, remove --axes`)
        }
        font = font.getVariation(axes)
    }

    const os2 = font['OS/2'] ?? {}
    const italic = !!os2.fsSelection?.italic || !!os2.fsSelection?.oblique || font.italicAngle !== 0

    return {
        font,
        // the typographic family (name ID 16) is what groups weights, e.g. "Geist" rather than "Geist Medium"
        family: values.family ?? font.getName('preferredFamily') ?? font.familyName,
        weight: axes?.wght ?? os2.usWeightClass ?? 400,
        style: italic ? 'italic' : 'normal',
    }
})

const tolerance = values.tolerance === undefined ? DEFAULT_TOLERANCE : Number(values.tolerance)
if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error(`[Keemera] Invalid --tolerance "${values.tolerance}". Use a distance in em, e.g. 0.0005, or 0 to keep every curve`)
}

const baked = bake(faces, codepoints, { tolerance })
const file = encode(baked)
const out = resolve(values.out)

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, file)

for (const face of baked.stats.faces) {
    console.log(`  ${face.family} ${face.weight} ${face.style}: ${face.glyphs} glyphs, ${face.codepoints} codepoints`)
}
console.log(`[Keemera] ${values.out}: ${baked.stats.curves} curves, ${(file.byteLength / 1024).toFixed(0)} KB`)
console.log('  note: this is the faces\' outline data, served publicly. Fine for OFL fonts, check the licence of commercial ones')
