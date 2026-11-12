// ioBroker eslint configuration for js and ts files
import config from '@iobroker/eslint-config';

export default [
    ...config,
    {
        // files excluded from linting
        ignores: ['.dev-server/', '.vscode/', '*.test.js', 'test/**/*.js', '*.config.mjs', 'build', '**/adapter-config.d.ts'],
    },
    {
        // admin tab: plain browser scripts, types in JSDoc for the type check of the tests
        files: ['admin/**/*.js'],
        languageOptions: {
            globals: {
                window: 'readonly',
                document: 'readonly',
                location: 'readonly',
                navigator: 'readonly',
                console: 'readonly',
                setTimeout: 'readonly',
                module: 'readonly',
            },
        },
        rules: { 'jsdoc/check-tag-names': ['warn', { typed: false }] },
    },
];
