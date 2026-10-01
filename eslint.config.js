import js from '@eslint/js'
import stylistic from '@stylistic/eslint-plugin'
import globals from 'globals'

export default [
    {
        ignores: ['dist/**', 'node_modules/**', 'src/resources/GLTFCurveExtension.js'],
    },
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.browser,
            },
        },
        plugins: {
            '@stylistic': stylistic,
        },
        rules: {
            'camelcase': 'off',
            'semi': ['error', 'never'],
            'no-unused-vars': 'warn',
            'no-undef': 'error',
            '@stylistic/indent': ['error', 4, { SwitchCase: 1 }],
            '@stylistic/object-curly-spacing': ['error', 'always'],
            '@stylistic/block-spacing': ['error', 'always'],
            '@stylistic/no-multiple-empty-lines': ['error', { max: 1 }],
            '@stylistic/no-multi-spaces': 'error',
            '@stylistic/function-call-spacing': ['error', 'never'],
            '@stylistic/space-in-parens': ['error', 'never'],
            '@stylistic/space-before-blocks': ['error', 'always'],
            '@stylistic/comma-spacing': ['error', { before: false, after: true }],
            '@stylistic/function-call-argument-newline': ['error', 'consistent'],
            '@stylistic/keyword-spacing': ['error', { before: true, after: true }],
            '@stylistic/space-infix-ops': 'error',
        },
    },
    {
        files: ['vite.config.js', 'eslint.config.js', 'examples/*/vite.config.js'],
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
    },
]
