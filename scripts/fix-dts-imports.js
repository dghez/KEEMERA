// tsc keeps the extensionless imports from src; NodeNext consumers need explicit `.js` paths in .d.ts files
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const dist = resolve(import.meta.dirname, '../dist')

const walk = dir => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
})

const withExtension = (file, specifier) => {
    if (/\.js$/.test(specifier)) return specifier
    const target = resolve(dirname(file), specifier)
    if (existsSync(`${target}.d.ts`)) return `${specifier}.js`
    if (existsSync(join(target, 'index.d.ts'))) return `${specifier}/index.js`
    return specifier
}

walk(dist).filter(file => file.endsWith('.d.ts')).forEach((file) => {
    const source = readFileSync(file, 'utf8')
    const fixed = source.replace(/((?:from|import)\s*\(?\s*['"])(\.{1,2}(?:\/[^'"]*)?)(['"])/g, (_, start, specifier, end) => start + withExtension(file, specifier) + end)
    if (fixed !== source) { writeFileSync(file, fixed) }
})
