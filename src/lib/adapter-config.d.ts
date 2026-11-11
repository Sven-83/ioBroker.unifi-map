// Types of the instance config, taken from io-package.json

import { native } from '../../io-package.json';

type _AdapterConfig = typeof native;

declare global {
    namespace ioBroker {
        interface AdapterConfig extends _AdapterConfig {
            // Do not enter anything here!
        }
    }
}

export {};
