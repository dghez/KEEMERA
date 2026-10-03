import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

const root = import.meta.dirname
const src = resolve(root, '../../src')

export default defineConfig({
    root,
    // shared by every example, served from /
    publicDir: resolve(root, '../assets'),
    plugins: [tailwindcss()],
    resolve: {
        alias: [
            { find: /^keemera$/, replacement: resolve(src, 'index.js') },
            { find: /^keemera\/(shards|helpers|shaders)$/, replacement: `${src}/$1/index.js` },
        ],
    },
})
