const path = require('path');
const { tests } = require('@iobroker/testing');
const { expect } = require('chai');
const { startFakeConsole } = require('./lib/fake-console');

const NS = 'unifi-map.0';

/**
 * Waits until check() returns a truthy value.
 *
 * @param {() => Promise<unknown> | unknown} check
 * @param {string} what - Shown when the timeout is reached
 * @param {number} [timeoutMs]
 */
async function waitFor(check, what, timeoutMs = 20_000) {
    const end = Date.now() + timeoutMs;
    for (;;) {
        const result = await check();
        if (result) {
            return result;
        }
        if (Date.now() > end) {
            throw new Error(`Timeout waiting for ${what}`);
        }
        await new Promise(resolve => setTimeout(resolve, 250));
    }
}

/**
 * sendTo as a promise.
 *
 * @param {any} harness
 * @param {string} command
 * @param {unknown} message
 */
function sendTo(harness, command, message) {
    return new Promise(resolve => harness.sendTo(NS, command, message, resolve));
}

/**
 * Lets the harness start the adapter again: js-controller refuses a start while alive is still true.
 *
 * @param {any} harness
 */
async function markStopped(harness) {
    harness._adapterExit = undefined;
    await harness.states.setState(`system.adapter.${NS}.alive`, { val: false, ack: true });
}

/**
 * Restarts the adapter in the same harness, so states survive like on a real host.
 *
 * @param {any} harness
 */
async function restart(harness) {
    await harness.stopAdapter();
    await markStopped(harness);
    await harness.startAdapterAndWait();
}

/**
 * Config for a fake console.
 *
 * @param {any} fake
 */
function configOf(fake) {
    return {
        host: fake.host,
        port: fake.port,
        apiKey: fake.apiKey,
        certificate: fake.certificate,
        certFingerprint: fake.fingerprint,
        pollInterval: 3600,
        detailInterval: 3600,
    };
}

tests.integration(path.join(__dirname, '..'), {
    defineAdditionalTests({ suite }) {
        const stateVal = async (harness, id) => (await harness.states.getState(`${NS}.${id}`))?.val;

        suite('Without settings', getHarness => {
            it('waits for the settings and does not connect', async function () {
                this.timeout(30_000);
                const harness = getHarness();
                await harness.changeAdapterConfig('unifi-map', { native: { host: '', apiKey: '', certificate: '' } });
                await harness.startAdapterAndWait();
                await waitFor(() => harness.hasLog(/Not configured: address, API key, confirmed certificate missing/, 'warn'), 'warning');
                expect(await stateVal(harness, 'info.connection')).to.equal(false);
            });
        });

        suite('Status of a network', getHarness => {
            let harness;
            let fake;
            const dev = n => `devices.${fake.id(n)}`;

            before(async function () {
                this.timeout(60_000);
                harness = getHarness();
                fake = await startFakeConsole();
                await harness.changeAdapterConfig('unifi-map', { native: configOf(fake) });
                await harness.startAdapterAndWait();
                await harness.enableSendTo();
                await waitFor(async () => (await stateVal(harness, 'info.connection')) === true, 'connection');
                await waitFor(async () => (await stateVal(harness, 'summary.total')) === 5, 'summary');
            });

            after(async () => {
                await fake?.close();
            });

            it('writes version, devices and their roles', async () => {
                expect(await stateVal(harness, 'info.networkVersion')).to.equal('10.6.109');
                expect(await stateVal(harness, `${dev(1)}.role`)).to.equal('gateway');
                expect(await stateVal(harness, `${dev(2)}.role`)).to.equal('switch');
                expect(await stateVal(harness, `${dev(4)}.role`)).to.equal('accessPoint');
                expect(await stateVal(harness, `${dev(5)}.uplinkId`)).to.equal(fake.id(4));
                expect(await stateVal(harness, `${dev(3)}.clients`)).to.equal(5);
                expect(await stateVal(harness, `${dev(3)}.uptime`)).to.equal(100_003);
                expect(await stateVal(harness, 'info.dataStale')).to.equal(false);
            });

            it('tells cable from mesh and marks the slow cable uplink yellow', async () => {
                expect(await stateVal(harness, `${dev(4)}.uplinkType`)).to.equal('wireless');
                expect(await stateVal(harness, `${dev(4)}.signal`)).to.equal(-62);
                expect(await stateVal(harness, `${dev(4)}.degraded`)).to.equal(false);
                expect(await stateVal(harness, `${dev(5)}.uplinkType`)).to.equal('wired');
                expect(await stateVal(harness, `${dev(5)}.degraded`)).to.equal(true);
                expect(await stateVal(harness, `${dev(5)}.degradedReason`)).to.equal('uplink 100 of 1000 Mbit/s');
                expect(await stateVal(harness, 'summary.degraded')).to.equal(1);
                expect(await stateVal(harness, 'summary.state')).to.equal('degraded');
            });

            it('lists problems first in summary.json', async () => {
                const list = JSON.parse(await stateVal(harness, 'summary.json'));
                expect(list).to.have.length(5);
                expect(list[0]).to.include({ id: fake.id(5), state: 'degraded' });
                expect(list[0]).not.to.have.property('mac');
            });

            it('shows a failed device red after a refresh and reports the event', async function () {
                this.timeout(30_000);
                fake.config.devices[2].state = 'OFFLINE';
                await harness.states.setState(`${NS}.refresh`, { val: true, ack: false });
                await waitFor(async () => (await stateVal(harness, 'summary.state')) === 'offline', 'offline');
                expect(await stateVal(harness, `${dev(3)}.online`)).to.equal(false);
                expect(await stateVal(harness, 'summary.offline')).to.equal(1);
                const event = JSON.parse(await stateVal(harness, 'events.last'));
                expect(event).to.include({ event: 'offline', id: fake.id(3), model: 'U6 LR' });
            });

            it('reports a restart when the device is back', async function () {
                this.timeout(30_000);
                fake.config.devices[2].state = 'ONLINE';
                fake.config.devices[2].uptimeSec = 30;
                // a manual refresh is accepted at most every 10 s
                await new Promise(resolve => setTimeout(resolve, 10_500));
                await harness.states.setState(`${NS}.refresh`, { val: true, ack: false });
                await waitFor(async () => (await stateVal(harness, `${dev(3)}.restartCount7d`)) === 1, 'restart');
                expect(await stateVal(harness, 'summary.state')).to.equal('degraded');
                const event = JSON.parse(await stateVal(harness, 'events.last'));
                expect(['online', 'restart']).to.include(event.event);
            });

            it('fetches the certificate for the settings without sending the key', async function () {
                this.timeout(15_000);
                const before = fake.stats.requests;
                const answer = await sendTo(harness, 'fetchCertificate', { host: fake.host, port: fake.port });
                expect(answer.native).to.deep.equal({ certificate: fake.certificate, certFingerprint: fake.fingerprint });
                expect(fake.stats.requests).to.equal(before);
                expect((await sendTo(harness, 'fetchCertificate', { host: 'https://x' })).error).to.match(/address/);
            });

            it('keeps the key and device names out of info and warn messages', () => {
                const visible = harness
                    .getLogs()
                    .filter(entry => entry.level !== 'debug')
                    .map(entry => entry.message)
                    .join('\n');
                expect(visible).to.include('Connected to UniFi Network 10.6.109');
                expect(visible).not.to.include(fake.apiKey);
                for (const name of ['Switch Slow', 'AP Cable', 'AP Mesh']) {
                    expect(visible).not.to.include(name);
                }
            });

            it('sent only GET requests to known paths', () => {
                expect(fake.stats.paths.every(p => p.startsWith('/proxy/network/'))).to.equal(true);
            });
        });

        suite('Changed certificate', getHarness => {
            let harness;
            let fake;
            let other;

            before(async function () {
                this.timeout(60_000);
                harness = getHarness();
                fake = await startFakeConsole();
                other = await startFakeConsole();
                await harness.changeAdapterConfig('unifi-map', { native: configOf(fake) });
                await harness.startAdapterAndWait();
                await waitFor(async () => (await stateVal(harness, 'summary.state')) === 'degraded', 'first poll');
            });

            after(async () => {
                await fake?.close();
                await other?.close();
            });

            it('refuses another certificate, sends no key and shows the data as stale', async function () {
                this.timeout(60_000);
                // the console now answers with another certificate
                await harness.changeAdapterConfig('unifi-map', { native: { ...configOf(fake), port: other.port } });
                await restart(harness);
                await waitFor(() => harness.hasLog(/certificate of the console has changed/, 'error'), 'error');
                expect(other.stats.requests, 'the key never reached the other server').to.equal(0);
                expect(await stateVal(harness, 'info.connection')).to.equal(false);
                expect(await stateVal(harness, 'info.dataStale')).to.equal(true);
                expect(await stateVal(harness, 'summary.state')).to.equal('stale');
            });
        });

        suite('Unofficial device list fails', getHarness => {
            let harness;
            let fake;

            before(async function () {
                this.timeout(60_000);
                harness = getHarness();
                fake = await startFakeConsole();
                fake.config.classicStatus = 404;
                await harness.changeAdapterConfig('unifi-map', { native: configOf(fake) });
                await harness.startAdapterAndWait();
                await waitFor(async () => (await stateVal(harness, 'summary.total')) === 5, 'summary');
            });

            after(async () => {
                await fake?.close();
            });

            it('keeps the status working and warns once', async () => {
                expect(await stateVal(harness, 'info.connection')).to.equal(true);
                expect(await stateVal(harness, 'summary.state')).to.equal('ok');
                expect(await stateVal(harness, `devices.${fake.id(5)}.uplinkType`)).to.equal('');
                expect(harness.hasLog(/Uplink type and speed not read \(unofficial API\)/, 'warn')).to.equal(true);
            });
        });
    },
});
