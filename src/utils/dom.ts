export const qs = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document) => root.querySelector<T>(selector)

export const rect = (el: Element) => {
    const { width, height, left, top } = el.getBoundingClientRect()
    return { width, height, left, top }
}

export const clamp = (min: number, max: number, value: number) => Math.min(Math.max(value, min), max)
