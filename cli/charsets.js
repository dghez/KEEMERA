// Codepoint ranges for --ranges. Inclusive [lo, hi] pairs
export const RANGES = Object.freeze({
    ascii: [[0x20, 0x7e]],
    latin: [
        [0x20, 0x7e], // ASCII
        [0xa0, 0xff], // Latin-1 Supplement
        [0x100, 0x17f], // Latin Extended-A
        [0x2010, 0x2027], // dashes, quotes, bullets, ellipsis
        [0x2030, 0x203a], // per mille, primes, angle quotes
        [0x2044, 0x2044], // fraction slash
        [0x20ac, 0x20ac], // euro
        [0x2122, 0x2122], // trade mark
        [0x2190, 0x2193], // arrows
        [0x2212, 0x2212], // minus
    ],
})

export function codepointsFromRanges(names) {
    const out = new Set()

    for (const name of names) {
        const ranges = RANGES[name]
        if (!ranges) {
            throw new Error(`[Keemera] Unknown range "${name}". Available: ${Object.keys(RANGES).join(', ')}, all`)
        }
        for (const [lo, hi] of ranges) {
            for (let cp = lo; cp <= hi; cp++) out.add(cp)
        }
    }

    return out
}

export function codepointsFromText(text) {
    const out = new Set()
    for (const char of text) out.add(char.codePointAt(0))
    return out
}
