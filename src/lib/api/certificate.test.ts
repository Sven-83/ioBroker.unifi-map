import { expect } from 'chai';
import { RENEWAL_WINDOW_MS, parseCertificate, renewalProblem } from './certificate';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- plain JS test helper shared with the integration test
const { selfSigned } = require('../../../test/lib/selfsigned.js');

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 22, 12, 0, 0);

/**
 * Certificate valid from `fromDays` to `toDays` relative to NOW.
 *
 * @param fromDays - Start, days from NOW
 * @param toDays - End, days from NOW
 * @param options - Other name or issuer
 * @param options.name - Common name
 * @param options.issuer - Issuer name (not self-signed)
 */
function cert(fromDays: number, toDays: number, options: { name?: string; issuer?: string } = {}): string {
    return selfSigned(options.name ?? 'unifi.local', {
        notBefore: NOW + fromDays * DAY,
        notAfter: NOW + toDays * DAY,
        issuer: options.issuer,
    }).cert;
}

describe('api/certificate', () => {
    it('stores the end of validity in ms', () => {
        const parsed = parseCertificate(cert(-10, 6));
        // UTCTime has seconds only
        expect(Math.abs((parsed?.validToMs ?? 0) - (NOW + 6 * DAY))).to.be.lessThan(1000);
    });

    describe('renewalProblem', () => {
        // the case of 22.11.2026: old one runs out in 6 days, new one issued just now, new key
        it('accepts the usual renewal shortly before the end', () => {
            expect(renewalProblem(cert(-800, 6), cert(-0.5, 820), NOW)).to.equal('');
        });

        it('accepts a renewal after the old one ran out', () => {
            expect(renewalProblem(cert(-800, -2), cert(-1, 820), NOW)).to.equal('');
        });

        it('refuses when the confirmed certificate still runs long', () => {
            expect(renewalProblem(cert(-100, 200), cert(-0.5, 820), NOW)).to.match(/not run out soon/);
            const edge = RENEWAL_WINDOW_MS / DAY;
            expect(renewalProblem(cert(-800, edge + 1), cert(-0.5, 820), NOW)).to.match(/not run out soon/);
            expect(renewalProblem(cert(-800, edge - 0.01), cert(-0.5, 820), NOW)).to.equal('');
        });

        it('refuses another name', () => {
            expect(renewalProblem(cert(-800, 6), cert(-0.5, 820, { name: 'evil.local' }), NOW)).to.match(
                /another name/,
            );
        });

        it('refuses a certificate that is not self-signed', () => {
            expect(
                renewalProblem(cert(-800, 6), cert(-0.5, 820, { name: 'unifi.local', issuer: 'Some CA' }), NOW),
            ).to.match(/not self-signed/);
        });

        it('refuses one that is older or not valid yet', () => {
            expect(renewalProblem(cert(-800, 6), cert(-900, 820), NOW)).to.match(/not newer/);
            expect(renewalProblem(cert(-800, 6), cert(1, 820), NOW)).to.match(/not valid now/);
            expect(renewalProblem(cert(-800, 6), cert(-10, -1), NOW)).to.match(/not valid now/);
        });

        it('refuses the same certificate and unreadable text', () => {
            const same = cert(-800, 6);
            expect(renewalProblem(same, same, NOW)).to.equal('same certificate');
            expect(renewalProblem('nonsense', same, NOW)).to.match(/cannot be read/);
        });
    });
});
