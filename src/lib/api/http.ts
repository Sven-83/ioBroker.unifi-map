/*
 * HTTPS layer: GET requests to the console with the API key, accepted only over a connection to the confirmed
 * certificate (audit B.10.4). Time limit per request, size limit per answer, no key in errors or log.
 */

import { request } from 'node:https';
import { AbortedError, ApiError, CertificateChangedError, KeyRejectedError, RateLimitedError } from './errors';

/** Time limit of a request (audit B.10.15) */
export const REQUEST_TIMEOUT_MS = 10_000;
/** Largest accepted answer; the classic device list of a home network is below 1 MB */
export const MAX_ANSWER_BYTES = 10 * 1024 * 1024;
/** Wait time after HTTP 429 without Retry-After */
export const RATE_LIMIT_FALLBACK_MS = 60_000;

/** Connection settings */
export interface HttpOptions {
    /** Address of the console */
    host: string;
    /** Port */
    port: number;
    /** API key */
    apiKey: string;
    /** PEM of the confirmed certificate */
    certificatePem: string;
    /** SHA-256 fingerprint of the confirmed certificate */
    fingerprint: string;
    /** Aborts all requests when the adapter shuts down */
    signal?: AbortSignal;
    /** Time limit per request */
    timeoutMs?: number;
    /** Debug line per request, without values */
    trace?: (line: string) => void;
}

/**
 * Wait time of a 429 answer.
 *
 * @param header - Retry-After header (seconds or HTTP date)
 * @param now - Current time
 */
export function retryAfterMs(header: string | string[] | undefined, now = Date.now()): number {
    const value = Array.isArray(header) ? header[0] : header;
    if (!value) {
        return RATE_LIMIT_FALLBACK_MS;
    }
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.min(seconds * 1000, 3_600_000);
    }
    const date = Date.parse(value);
    return Number.isFinite(date) ? Math.min(Math.max(date - now, 0), 3_600_000) : RATE_LIMIT_FALLBACK_MS;
}

/** GET requests with the API key to the console */
export class UnifiHttp {
    /**
     * @param options - Connection settings
     */
    public constructor(private readonly options: HttpOptions) {}

    /**
     * Requests a path and returns the parsed JSON.
     *
     * @param path - Path starting with /
     * @param what - Short description for errors
     */
    public get(path: string, what: string): Promise<unknown> {
        const { host, port, apiKey, certificatePem, fingerprint, signal } = this.options;
        if (signal?.aborted) {
            return Promise.reject(new AbortedError());
        }
        const started = Date.now();
        return new Promise((resolve, reject) => {
            let certificateChanged = false;
            const req = request(
                {
                    host,
                    port,
                    path,
                    method: 'GET',
                    headers: { 'X-API-KEY': apiKey, Accept: 'application/json' },
                    // the confirmed certificate is the only trust anchor, and only its fingerprint is accepted;
                    // the name check is replaced because consoles issue the certificate for a name, not the address
                    ca: certificatePem,
                    rejectUnauthorized: true,
                    checkServerIdentity: (_name, cert) => {
                        if (cert.fingerprint256 === fingerprint) {
                            return undefined;
                        }
                        certificateChanged = true;
                        return new CertificateChangedError();
                    },
                    timeout: this.options.timeoutMs ?? REQUEST_TIMEOUT_MS,
                    signal,
                    agent: false,
                },
                res => {
                    const chunks: Buffer[] = [];
                    let size = 0;
                    res.on('data', (chunk: Buffer) => {
                        size += chunk.length;
                        if (size > MAX_ANSWER_BYTES) {
                            req.destroy(new ApiError(`${what}: answer too large`, 0));
                            return;
                        }
                        chunks.push(chunk);
                    });
                    res.on('end', () => {
                        const status = res.statusCode ?? 0;
                        this.options.trace?.(`GET ${what} -> ${status} in ${Date.now() - started} ms, ${size} bytes`);
                        if (status === 401 || status === 403) {
                            return reject(new KeyRejectedError(status));
                        }
                        if (status === 429) {
                            return reject(new RateLimitedError(retryAfterMs(res.headers['retry-after'])));
                        }
                        if (status < 200 || status >= 300) {
                            return reject(new ApiError(what, status));
                        }
                        try {
                            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
                        } catch {
                            reject(new ApiError(`${what}: answer is not JSON`, status));
                        }
                    });
                    res.on('error', err => reject(new ApiError(`${what}: ${err.message}`, 0)));
                },
            );
            req.on('timeout', () => req.destroy(new ApiError(`${what}: no answer within the time limit`, 0)));
            req.on('error', err => {
                if (signal?.aborted) {
                    return reject(new AbortedError());
                }
                if (certificateChanged || err instanceof CertificateChangedError) {
                    return reject(new CertificateChangedError());
                }
                if (/self[- ]signed|unable to verify|certificate/i.test(err.message)) {
                    return reject(new CertificateChangedError());
                }
                reject(err instanceof ApiError ? err : new ApiError(`${what}: ${err.message}`, 0));
            });
            req.end();
        });
    }
}
