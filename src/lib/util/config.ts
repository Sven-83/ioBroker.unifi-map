/*
 * Validation of the instance config.
 */

import { isIP } from 'node:net';

/** Polling interval of the device list in seconds */
export const POLL_DEFAULT_S = 60;
export const POLL_MIN_S = 30;
export const POLL_MAX_S = 3600;
/** Interval of details, statistics, clients and uplinks in seconds */
export const DETAIL_DEFAULT_S = 300;
export const DETAIL_MIN_S = 60;
export const DETAIL_MAX_S = 3600;
/** Largest random addition to each interval (audit B.11.1) */
export const JITTER_MS = 5_000;

/**
 * Number from the config, clamped to a range.
 *
 * @param value - Value from the config
 * @param fallback - Default
 * @param min - Smallest value
 * @param max - Largest value
 */
export function clamp(value: unknown, fallback: number, min: number, max: number): number {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n) || n <= 0) {
        return fallback;
    }
    return Math.min(Math.max(n, min), max);
}

/**
 * Address of the console: an IP address or a host name, without scheme, port or path.
 *
 * @param value - Value from the config
 * @returns The address, undefined if it is not usable
 */
export function consoleHost(value: unknown): string | undefined {
    const host = typeof value === 'string' ? value.trim() : '';
    if (isIP(host)) {
        return host;
    }
    return /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/.test(
        host,
    )
        ? host
        : undefined;
}

/**
 * Port of the console.
 *
 * @param value - Value from the config
 */
export function consolePort(value: unknown): number {
    const port = Math.round(Number(value));
    return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 443;
}

/**
 * API key: printable characters only (it goes into an HTTP header).
 *
 * @param value - Value from the config
 * @returns The key, undefined if it is empty or not usable
 */
export function apiKey(value: unknown): string | undefined {
    const key = typeof value === 'string' ? value.trim() : '';
    return /^[\x21-\x7e]{8,256}$/.test(key) ? key : undefined;
}

/**
 * Delay until the next run: the interval plus a random jitter.
 *
 * @param seconds - Interval
 * @param random - Random source, 0 to below 1
 */
export function delayMs(seconds: number, random: () => number = Math.random): number {
    return seconds * 1000 + Math.floor(random() * JITTER_MS);
}
