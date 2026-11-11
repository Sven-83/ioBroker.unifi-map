// ioBroker eslint configuration for js and ts files
import config from '@iobroker/eslint-config';

export default [
    ...config,
    {
        // files excluded from linting
        ignores: ['.dev-server/', '.vscode/', '*.test.js', 'test/**/*.js', '*.config.mjs', 'build', '**/adapter-config.d.ts'],
    },
];
