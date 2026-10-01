import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const src = resolve(import.meta.dirname, '../../src')

export default defineConfig({
    resolve: {
        alias: [
            { find: /^keemera$/, replacement: resolve(src, 'index.js') },
            { find: /^keemera\/(shards|helpers|shaders)$/, replacement: `${src}/$1/index.js` },
        ],
    },
})
