import { expect } from 'chai';
import { apiKey, clamp, consoleHost, consolePort, delayMs, JITTER_MS, segmentName } from './config';

describe('util/config', () => {
    it('clamps numbers and falls back for nonsense', () => {
        expect(clamp(10, 60, 30, 3600)).to.equal(30);
        expect(clamp('120', 60, 30, 3600)).to.equal(120);
        expect(clamp(99_999, 60, 30, 3600)).to.equal(3600);
        expect(clamp('x', 60, 30, 3600)).to.equal(60);
        expect(clamp(0, 60, 30, 3600)).to.equal(60);
    });

    it('accepts IP addresses and host names only', () => {
        expect(consoleHost(' 192.0.2.1 ')).to.equal('192.0.2.1');
        expect(consoleHost('fe80::1')).to.equal('fe80::1');
        expect(consoleHost('unifi.local')).to.equal('unifi.local');
        expect(consoleHost('https://unifi.local')).to.equal(undefined);
        expect(consoleHost('unifi.local/path')).to.equal(undefined);
        expect(consoleHost('a b')).to.equal(undefined);
        expect(consoleHost(undefined)).to.equal(undefined);
    });

    it('uses 443 for an invalid port', () => {
        expect(consolePort('8443')).to.equal(8443);
        expect(consolePort(0)).to.equal(443);
        expect(consolePort('x')).to.equal(443);
    });

    it('accepts printable API keys only', () => {
        expect(apiKey(' abcdefgh12345 ')).to.equal('abcdefgh12345');
        expect(apiKey('short')).to.equal(undefined);
        expect(apiKey('with space inside')).to.equal(undefined);
        expect(apiKey('line\nbreak123')).to.equal(undefined);
    });

    it('adds a jitter below JITTER_MS', () => {
        expect(delayMs(60, () => 0)).to.equal(60_000);
        expect(delayMs(60, () => 0.999)).to.be.below(60_000 + JITTER_MS);
    });

    it('cleans the name of a section without UniFi', () => {
        expect(segmentName('  Powerline ')).to.equal('Powerline');
        expect(segmentName('a\nb\tc')).to.equal('abc');
        expect(segmentName('x'.repeat(40))).to.have.length(30);
        expect(segmentName(undefined)).to.equal('');
        expect(segmentName(42)).to.equal('');
    });
});
