/*
 * Certificate of the console. UniFi consoles use a self-signed certificate, so the usual check cannot pass.
 * Instead of switching the check off, the certificate is fetched once in the settings, the user confirms its
 * fingerprint, and from then on only exactly this certificate is accepted (audit B.10.4). Fetching sends nothing.
 */

import { X509Certificate } from 'node:crypto';
import { isIP } from 'node:net';
import { connect } from 'node:tls';

/** What the settings show and store */
export interface ConsoleCertificate {
    /** PEM of the certificate, used as the only trust anchor */
    pem: string;
    /** SHA-256 fingerprint, as browsers show it */
    fingerprint: string;
    /** Subject common name */
    subject: string;
    /** Valid until (text of the certificate) */
    validTo: string;
    /** Valid until, ms since 1970 */
    validToMs: number;
}

/** A renewal is only accepted when the confirmed certificate runs out within this time */
export const RENEWAL_WINDOW_MS = 14 * 86_400_000;
/** Clocks of the console and of ioBroker may differ a little */
const CLOCK_SKEW_MS = 10 * 60_000;

/**
 * Builds a PEM from the DER bytes of a certificate.
 *
 * @param raw - DER bytes
 */
export function toPem(raw: Buffer): string {
    const lines = raw.toString('base64').match(/.{1,64}/g) ?? [];
    return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
}

/**
 * Reads a stored PEM. Text fields of the admin may drop the line breaks or add spaces, so only the base64 part
 * between the markers is used and the PEM is built again. Returns undefined if it is not a certificate.
 *
 * @param text - Stored text
 */
export function parseCertificate(text: unknown): ConsoleCertificate | undefined {
    if (typeof text !== 'string') {
        return undefined;
    }
    const body = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/.exec(text)?.[1].replace(/\s+/g, '');
    if (!body || !/^[A-Za-z0-9+/]+=*$/.test(body)) {
        return undefined;
    }
    const pem = toPem(Buffer.from(body, 'base64'));
    try {
        const cert = new X509Certificate(pem);
        return {
            pem,
            fingerprint: cert.fingerprint256,
            subject: /CN=([^\n,]+)/.exec(cert.subject)?.[1] ?? '',
            validTo: cert.validTo,
            validToMs: Date.parse(cert.validTo),
        };
    } catch {
        return undefined;
    }
}

/**
 * Fetches the certificate of the console without sending anything else.
 *
 * @param host - Address of the console
 * @param port - Port
 * @param timeoutMs - Time limit
 */
export function fetchCertificate(host: string, port: number, timeoutMs = 10_000): Promise<ConsoleCertificate> {
    return new Promise((resolve, reject) => {
        const socket = connect(
            // nothing but the TLS handshake happens on this connection
            { host, port, rejectUnauthorized: false, ...(isIP(host) ? {} : { servername: host }) },
            () => {
                const cert = socket.getPeerCertificate();
                socket.end();
                const parsed = cert?.raw ? parseCertificate(toPem(cert.raw)) : undefined;
                if (parsed) {
                    resolve(parsed);
                } else {
                    reject(new Error('the console sent no certificate'));
                }
            },
        );
        socket.setTimeout(timeoutMs, () => socket.destroy(new Error('no answer from the console')));
        socket.on('error', reject);
    });
}

/**
 * Decides whether a new certificate of the console is the usual renewal of the confirmed one. UniFi OS issues a
 * new self-signed certificate with a new key a few days before the old one runs out, without restart or
 * firmware update. Such a renewal may be taken over without the user (option, audit B.10.4); everything else
 * must be confirmed again. The decision only uses the two certificates, never data the unchecked server sends.
 *
 * @param confirmed - PEM of the confirmed certificate
 * @param next - PEM of the certificate the console presents now
 * @param now - Current time, ms
 * @param windowMs - The confirmed certificate must run out within this time
 * @returns Empty when it is a renewal, otherwise the reason why not
 */
export function renewalProblem(confirmed: string, next: string, now: number, windowMs = RENEWAL_WINDOW_MS): string {
    let old: X509Certificate;
    let fresh: X509Certificate;
    try {
        old = new X509Certificate(confirmed);
        fresh = new X509Certificate(next);
    } catch {
        return 'certificate cannot be read';
    }
    if (old.fingerprint256 === fresh.fingerprint256) {
        return 'same certificate';
    }
    const oldTo = Date.parse(old.validTo);
    const oldFrom = Date.parse(old.validFrom);
    const newFrom = Date.parse(fresh.validFrom);
    const newTo = Date.parse(fresh.validTo);
    if (!(oldTo - now <= windowMs)) {
        return 'the confirmed certificate does not run out soon';
    }
    if (fresh.subject !== old.subject || (fresh.subjectAltName ?? '') !== (old.subjectAltName ?? '')) {
        return 'the new certificate is issued for another name';
    }
    if (fresh.issuer !== fresh.subject || !fresh.verify(fresh.publicKey)) {
        return 'the new certificate is not self-signed';
    }
    if (!(newFrom > oldFrom)) {
        return 'the new certificate is not newer';
    }
    if (!(newFrom - CLOCK_SKEW_MS <= now && now < newTo)) {
        return 'the new certificate is not valid now';
    }
    return '';
}
