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
}

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
 * Reads a stored PEM. Returns undefined if it is not a certificate.
 *
 * @param pem - Stored text
 */
export function parseCertificate(pem: unknown): ConsoleCertificate | undefined {
    if (typeof pem !== 'string' || !pem.includes('BEGIN CERTIFICATE')) {
        return undefined;
    }
    try {
        const cert = new X509Certificate(pem);
        return {
            pem,
            fingerprint: cert.fingerprint256,
            subject: /CN=([^\n,]+)/.exec(cert.subject)?.[1] ?? '',
            validTo: cert.validTo,
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
