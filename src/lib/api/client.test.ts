import { expect } from 'chai';
import { fetchCertificate, parseCertificate } from './certificate';
import { UnifiClient, parseClassicUplink, parseDevice } from './client';
import { AbortedError, ApiError, CertificateChangedError, KeyRejectedError, RateLimitedError } from './errors';
import { UnifiHttp, retryAfterMs } from './http';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- plain JS test helper shared with the integration test
const { startFakeConsole, mac } = require('../../../test/lib/fake-console.js');

type FakeConsole = {
    host: string;
    port: number;
    apiKey: string;
    certificate: string;
    fingerprint: string;
    config: { devices: { state: string; uplink: unknown }[]; classicStatus: number; rateLimit: boolean };
    stats: { requests: number; keys: Set<string>; paths: string[] };
    id: (n: number) => string;
    close: () => Promise<void>;
};

describe('api/client', () => {
    describe('parsers', () => {
        it('reads a device and rejects unusable IDs', () => {
            const d = parseDevice({
                id: 'abc-1',
                name: 'N',
                model: 'M',
                macAddress: 'AA:BB',
                ipAddress: '1.2.3.4',
                state: 'online',
                firmwareVersion: '1',
                firmwareUpdatable: true,
                features: ['switching', 3],
            });
            expect(d).to.deep.include({
                id: 'abc-1',
                mac: 'aa:bb',
                state: 'ONLINE',
                updatable: true,
                features: ['switching'],
            });
            expect(parseDevice({ id: '../x' })).to.equal(undefined);
            expect(parseDevice({ id: 'a.b' })).to.equal(undefined);
            expect(parseDevice(null)).to.equal(undefined);
        });

        it('reads cable and mesh uplinks of the classic list', () => {
            expect(parseClassicUplink({ uplink: { type: 'wire', speed: 100, max_speed: 1000 } })).to.deep.equal({
                type: 'wired',
                speedMbps: 100,
                maxSpeedMbps: 1000,
                signalDbm: undefined,
                parentMac: '',
            });
            expect(
                parseClassicUplink({
                    uplink: { type: 'wireless', tx_rate: 344100, signal: -62, uplink_mac: mac(1).toUpperCase() },
                }),
            ).to.deep.equal({
                type: 'wireless',
                speedMbps: 344,
                maxSpeedMbps: undefined,
                signalDbm: -62,
                parentMac: mac(1),
            });
            expect(parseClassicUplink({}).type).to.equal(undefined);
        });

        it('takes the last known parent of a device that reports no uplink', () => {
            expect(parseClassicUplink({ uplink: {}, last_uplink: { uplink_mac: mac(2) } }).parentMac).to.equal(mac(2));
            expect(
                parseClassicUplink({ uplink: { uplink_mac: mac(3) }, last_uplink: { uplink_mac: mac(2) } }).parentMac,
            ).to.equal(mac(3));
        });

        it('reads Retry-After as seconds or date', () => {
            expect(retryAfterMs('120')).to.equal(120_000);
            expect(retryAfterMs(new Date(10_000 + 30_000).toUTCString(), 10_000)).to.be.within(29_000, 30_000);
            expect(retryAfterMs(undefined)).to.equal(60_000);
            expect(retryAfterMs('999999')).to.equal(3_600_000);
        });

        it('rejects text that is not a certificate', () => {
            expect(parseCertificate('nope')).to.equal(undefined);
            expect(parseCertificate('-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----')).to.equal(
                undefined,
            );
        });
    });

    describe('against a fake console', () => {
        let fake: FakeConsole;
        let other: FakeConsole;

        before(async () => {
            fake = await startFakeConsole();
            other = await startFakeConsole();
        });

        after(async () => {
            await fake.close();
            await other.close();
        });

        const client = (
            options: Partial<{ apiKey: string; certificatePem: string; fingerprint: string; signal: AbortSignal }> = {},
        ): UnifiClient =>
            new UnifiClient(
                new UnifiHttp({
                    host: fake.host,
                    port: fake.port,
                    apiKey: fake.apiKey,
                    certificatePem: fake.certificate,
                    fingerprint: fake.fingerprint,
                    ...options,
                }),
            );

        it('fetches the certificate without sending a key', async () => {
            const before = fake.stats.requests;
            const cert = await fetchCertificate(fake.host, fake.port);
            expect(cert.fingerprint).to.equal(fake.fingerprint);
            expect(cert.subject).to.equal('unifi.test');
            expect(fake.stats.requests).to.equal(before);
        });

        it('reads a stored certificate also without line breaks or with spaces (admin text field)', () => {
            const flat = fake.certificate.replace(/\n/g, '');
            const spaced = fake.certificate.replace(/\n/g, ' ');
            const crlf = fake.certificate.replace(/\n/g, '\r\n');
            for (const text of [fake.certificate, flat, spaced, crlf]) {
                expect(parseCertificate(text)?.fingerprint).to.equal(fake.fingerprint);
            }
        });

        it('reads version, site, devices, details, statistics, clients and uplinks', async () => {
            const c = client();
            expect(await c.networkVersion()).to.equal('10.6.109');
            const site = await c.site();
            expect(site.reference).to.equal('default');
            const devices = await c.devices(site);
            expect(devices.map(d => d.model)).to.deep.equal([
                'UDR',
                'USW-Lite-8-PoE',
                'U6 LR',
                'U7 Lite',
                'USW-Lite-8-PoE',
            ]);
            expect((await c.details(site, fake.id(1))).uplinkDeviceId).to.equal(undefined);
            expect((await c.details(site, fake.id(5))).uplinkDeviceId).to.equal(fake.id(4));
            expect((await c.statistics(site, fake.id(3))).uptimeSec).to.equal(100_003);
            const counts = await c.clientCounts(site);
            expect(counts.get(fake.id(3))).to.equal(5);
            const uplinks = await c.classicUplinks(site);
            expect(uplinks.get(mac(5))).to.deep.include({
                type: 'wired',
                speedMbps: 100,
                maxSpeedMbps: 1000,
            });
            expect(uplinks.get(mac(4))?.type).to.equal('wireless');
        });

        it('refuses another certificate before the key is sent', async () => {
            const keysBefore = other.stats.requests;
            const c = new UnifiClient(
                new UnifiHttp({
                    host: other.host,
                    port: other.port,
                    apiKey: other.apiKey,
                    certificatePem: fake.certificate,
                    fingerprint: fake.fingerprint,
                }),
            );
            let error: unknown;
            await c.networkVersion().catch(err => (error = err));
            expect(error).to.be.instanceOf(CertificateChangedError);
            expect(other.stats.requests, 'no request reached the other server').to.equal(keysBefore);
        });

        it('refuses the right certificate with another pinned fingerprint', async () => {
            let error: unknown;
            await client({ fingerprint: other.fingerprint, certificatePem: fake.certificate })
                .networkVersion()
                .catch(err => (error = err));
            expect(error).to.be.instanceOf(CertificateChangedError);
        });

        it('reports a rejected key', async () => {
            let error: unknown;
            await client({ apiKey: 'wrong-key-123456' })
                .networkVersion()
                .catch(err => (error = err));
            expect(error).to.be.instanceOf(KeyRejectedError);
            expect(String((error as Error).message)).not.to.include('wrong-key');
        });

        it('reports a rate limit with its wait time', async () => {
            fake.config.rateLimit = true;
            let error: unknown;
            await client()
                .networkVersion()
                .catch(err => (error = err));
            fake.config.rateLimit = false;
            expect(error).to.be.instanceOf(RateLimitedError);
            expect((error as RateLimitedError).retryAfterMs).to.equal(120_000);
        });

        it('reports other answers with their status', async () => {
            fake.config.classicStatus = 404;
            let error: unknown;
            const c = client();
            await c.classicUplinks(await c.site()).catch(err => (error = err));
            fake.config.classicStatus = 200;
            expect(error).to.be.instanceOf(ApiError);
            expect((error as ApiError).status).to.equal(404);
        });

        it('stops when the adapter shuts down', async () => {
            const abort = new AbortController();
            abort.abort();
            let error: unknown;
            await client({ signal: abort.signal })
                .networkVersion()
                .catch(err => (error = err));
            expect(error).to.be.instanceOf(AbortedError);
        });

        it('sends only GET requests with the key', () => {
            expect([...fake.stats.keys].filter(k => k !== fake.apiKey)).to.deep.equal(['wrong-key-123456']);
        });
    });
});
