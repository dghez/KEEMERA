import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const root = import.meta.dirname

const isExternal = id => /^(three|gsap|@use-gesture\/vanilla|@monogrid\/gainmap-js)(\/|$)/.test(id)

export default defineConfig({
    build: {
        outDir: resolve(root, 'dist'),
        emptyOutDir: true,
        minify: true,
        sourcemap: false,
        lib: {
            entry: {
                index: resolve(root, 'src/index.ts'),
                'shards/index': resolve(root, 'src/shards/index.ts'),
                'helpers/index': resolve(root, 'src/helpers/index.ts'),
                'shaders/index': resolve(root, 'src/shaders/index.ts'),
            },
            formats: ['es'],
        },
        rollupOptions: {
            external: isExternal,
            output: {
                preserveModules: false,
                entryFileNames: '[name].js',
            },
        },
    },
})
