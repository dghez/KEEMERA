import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const root = import.meta.dirname

const isExternal = id => /^(three|gsap|@use-gesture\/vanilla|@monogrid\/gainmap-js)(\/|$)/.test(id)

export default defineConfig({
    build: {
        outDir: resolve(root, 'dist'),
        emptyOutDir: true,
        minify: false,
        sourcemap: true,
        lib: {
            entry: {
                index: resolve(root, 'src/index.js'),
                'shards/index': resolve(root, 'src/shards/index.js'),
                'helpers/index': resolve(root, 'src/helpers/index.js'),
                'shaders/index': resolve(root, 'src/shaders/index.js'),
            },
            formats: ['es'],
        },
        rollupOptions: {
            external: isExternal,
            output: {
                preserveModules: true,
                preserveModulesRoot: 'src',
                entryFileNames: '[name].js',
            },
        },
    },
})
