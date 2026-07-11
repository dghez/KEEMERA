import stylisticJs from '@stylistic/eslint-plugin-js'
import globals from "globals"
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt([
    {
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.node,
            }
        },
        plugins: {
            '@stylistic/js': stylisticJs
        },
        rules: {
            "camelcase": "off",
            "max-len": ["error", { "code": 30000000 }],
            "quote-props": "off",
            "semi": ["error", "never"],
            "object-curly-newline": "off",
            "arrow-body-style": "off",
            "consistent-return": "off",
            "prefer-arrow-callback": "off",
            "react/prop-types": "off",
            "global-require": "off",
            "no-nested-ternary": "off",
            "no-unused-expressions": "off",
            "no-unused-vars": "warn",
            "no-underscore-dangle": "off",
            "no-shadow": "off",
            "no-param-reassign": "off",
            "no-restricted-syntax": "off",
            "no-plusplus": "off",
            "default-case": "off",
            "import/prefer-default-export": "off",
            "import/no-unresolved": "off",
            "import/extensions": "off",
            "import/order": "off",
            "import/no-named-as-default": "off",
            "spaced-comment": "off",
            "vue/multi-word-component-names": "off",
            "class-methods-use-this": "off",
            "promise/param-names": "off",
            "brace-style": "off",
            "no-undef": "error",
            "@stylistic/js/indent": ["error", 4, { "SwitchCase": 1 }],
            "@stylistic/js/object-curly-spacing": ["error", "always"],
            "@stylistic/js/block-spacing": ["error", "always"],
            "@stylistic/js/no-multiple-empty-lines": ["error", { "max": 1 }],
            "@stylistic/js/no-multi-spaces": "error",
            "@stylistic/js/func-call-spacing": ["error", "never"],
            "@stylistic/js/space-in-parens": ["error", "never"],
            "@stylistic/js/space-before-blocks": ["error", "always"],
            "@stylistic/js/comma-spacing": ["error", { "before": false, "after": true }],
            "@stylistic/js/function-call-argument-newline": ["error", "never"],
            "@stylistic/js/keyword-spacing": ["error", { "before": true, "after": true }],
            "@stylistic/js/space-infix-ops": "error",
        }
    }
]
)
