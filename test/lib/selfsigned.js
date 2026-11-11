// @ts-nocheck -- plain JS test helper
'use strict';

// Creates a self-signed certificate at test time (like the one of a UniFi console), with Node's crypto only.
// No key is stored anywhere: each test run gets a new one.

const { generateKeyPairSync, randomBytes, sign } = require('node:crypto');

function length(n) {
    if (n < 0x80) return Buffer.from([n]);
    const bytes = [];
    while (n > 0) {
        bytes.unshift(n & 0xff);
        n >>= 8;
    }
    return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag, content) => Buffer.concat([Buffer.from([tag]), length(content.length), content]);
const seq = (...parts) => tlv(0x30, Buffer.concat(parts));
const set = (...parts) => tlv(0x31, Buffer.concat(parts));

function oid(text) {
    const parts = text.split('.').map(Number);
    const bytes = [40 * parts[0] + parts[1]];
    for (const part of parts.slice(2)) {
        const chunk = [];
        let n = part;
        do {
            chunk.unshift(n & 0x7f);
            n >>= 7;
        } while (n > 0);
        for (let i = 0; i < chunk.length - 1; i++) chunk[i] |= 0x80;
        bytes.push(...chunk);
    }
    return tlv(0x06, Buffer.from(bytes));
}

function utcTime(date) {
    const p = n => String(n).padStart(2, '0');
    const text = `${p(date.getUTCFullYear() % 100)}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`;
    return tlv(0x17, Buffer.from(text));
}

/**
 * @param {string} commonName - Subject and issuer
 * @returns {{ key: string, cert: string }} PEM of key and certificate
 */
function selfSigned(commonName = 'unifi.test') {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const ecdsaSha256 = seq(oid('1.2.840.10045.4.3.2'));
    const name = seq(set(seq(oid('2.5.4.3'), tlv(0x0c, Buffer.from(commonName)))));
    const serial = randomBytes(8);
    // positive and without a leading zero byte: DER forbids that padding, OpenSSL then rejects the certificate
    serial[0] = (serial[0] & 0x3f) | 0x40;
    const now = Date.now();
    const tbs = seq(
        tlv(0xa0, tlv(0x02, Buffer.from([2]))), // version 3
        tlv(0x02, serial),
        ecdsaSha256,
        name,
        seq(utcTime(new Date(now - 86_400_000)), utcTime(new Date(now + 365 * 86_400_000))),
        name,
        publicKey.export({ type: 'spki', format: 'der' }),
        // extensions: basicConstraints CA:TRUE, so OpenSSL accepts it as its own trust anchor
        tlv(0xa3, seq(seq(oid('2.5.29.19'), tlv(0x01, Buffer.from([0xff])), tlv(0x04, seq(tlv(0x01, Buffer.from([0xff]))))))),
    );
    const signature = sign('sha256', tbs, privateKey);
    const der = seq(tbs, ecdsaSha256, tlv(0x03, Buffer.concat([Buffer.from([0]), signature])));
    const b64 = der.toString('base64').match(/.{1,64}/g).join('\n');
    return {
        key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
        cert: `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`,
    };
}

module.exports = { selfSigned };
