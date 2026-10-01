export const qs = (selector, root = document) => root.querySelector(selector)

export const rect = (el) => {
    const { width, height, left, top } = el.getBoundingClientRect()
    return { width, height, left, top }
}

export const clamp = (min, max, value) => Math.min(Math.max(value, min), max)
