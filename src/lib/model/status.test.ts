import { expect } from 'chai';
import type { ClassicUplink, UnifiDevice } from '../api/client';
import { deviceStatus, isStale, roleOf, summarize, type DeviceInput } from './status';

function device(overrides: Partial<UnifiDevice> = {}): UnifiDevice {
    return {
        id: 'dev-1',
        name: 'Device',
        model: 'U6 LR',
        mac: ['02', '00', '00', '00', '00', '01'].join(':'),
        ip: '192.0.2.1',
        state: 'ONLINE',
        firmware: '1.0.0',
        updatable: false,
        features: ['accessPoint'],
        ...overrides,
    };
}
const wired = (speed: number, max: number): ClassicUplink => ({
    type: 'wired',
    speedMbps: speed,
    maxSpeedMbps: max,
    signalDbm: undefined,
    parentMac: '',
    lastParentMac: '',
    remotePort: undefined,
    neighbors: [],
});
const mesh: ClassicUplink = {
    type: 'wireless',
    speedMbps: 344,
    maxSpeedMbps: undefined,
    signalDbm: -62,
    parentMac: '',
    lastParentMac: '',
    remotePort: undefined,
    neighbors: [],
};
const input = (overrides: Partial<DeviceInput> = {}): DeviceInput => ({
    device: device(),
    details: { uplinkDeviceId: 'parent' },
    statistics: { uptimeSec: 1000, cpuPct: 1, memoryPct: 2 },
    uplink: wired(1000, 1000),
    clients: 3,
    ...overrides,
});

describe('model/status', () => {
    describe('roleOf', () => {
        it('takes the switching device without an uplink as the console', () => {
            const console = device({ features: ['switching', 'accessPoint'] });
            expect(roleOf(console, { uplinkDeviceId: undefined })).to.equal('gateway');
            expect(roleOf(console, { uplinkDeviceId: 'x' })).to.equal('switch');
            expect(roleOf(device({ features: ['switching'] }), { uplinkDeviceId: 'x' })).to.equal('switch');
            expect(roleOf(device(), { uplinkDeviceId: 'x' })).to.equal('accessPoint');
            expect(roleOf(device({ features: [] }), undefined)).to.equal('other');
        });

        it('does not call a device without details the console', () => {
            expect(roleOf(device({ features: ['switching'] }), undefined)).to.equal('switch');
        });
    });

    describe('deviceStatus', () => {
        it('marks a cable uplink slower than usual as degraded', () => {
            const status = deviceStatus(input({ uplink: wired(100, 1000), usualSpeedMbps: 1000 }));
            expect(status.degraded).to.equal(true);
            expect(status.degradedReason).to.equal('uplink 100 instead of the usual 1000 Mbit/s');
            expect(status.linkUsualSpeed).to.equal(1000);
            expect(status.uplinkType).to.equal('wired');
            expect(status.linkSpeed).to.equal(100);
        });

        it('accepts a link that has always been below its maximum (e.g. powerline with 100 Mbit/s)', () => {
            expect(deviceStatus(input({ uplink: wired(100, 1000), usualSpeedMbps: 100 })).degraded).to.equal(false);
            expect(deviceStatus(input({ uplink: wired(100, 1000) })).degraded, 'usual speed unknown').to.equal(false);
        });

        it('does not mark a mesh uplink, a full speed link or the internet line of the console', () => {
            expect(deviceStatus(input({ uplink: mesh })).degraded).to.equal(false);
            expect(deviceStatus(input({ uplink: wired(1000, 1000) })).degraded).to.equal(false);
            const console = input({
                device: device({ features: ['switching', 'accessPoint'] }),
                details: { uplinkDeviceId: undefined },
                uplink: wired(100, 1000),
                usualSpeedMbps: 1000,
            });
            expect(deviceStatus(console).degraded).to.equal(false);
        });

        it('keeps the signal and the rate of a mesh link', () => {
            const status = deviceStatus(input({ uplink: mesh }));
            expect(status.uplinkType).to.equal('wireless');
            expect(status.linkSpeed).to.equal(344);
            expect(status.signalDbm).to.equal(-62);
            expect(status.linkMaxSpeed).to.equal(undefined);
        });

        it('counts offline as failed, but not an update or a start', () => {
            expect(deviceStatus(input({ device: device({ state: 'OFFLINE' }) })).failed).to.equal(true);
            expect(deviceStatus(input({ device: device({ state: 'CONNECTION_INTERRUPTED' }) })).failed).to.equal(true);
            expect(deviceStatus(input({ device: device({ state: 'UPDATING' }) })).failed).to.equal(false);
            expect(deviceStatus(input({ device: device({ state: 'GETTING_READY' }) })).failed).to.equal(false);
        });

        it('shows no uptime and no slow link for a device that is not online', () => {
            const status = deviceStatus(
                input({ device: device({ state: 'OFFLINE' }), uplink: wired(100, 1000), usualSpeedMbps: 1000 }),
            );
            expect(status.uptimeSec).to.equal(undefined);
            expect(status.degraded).to.equal(false);
        });

        it('never gives the console a parent, whatever the classic list reports', () => {
            const console = input({
                device: device({ features: ['switching', 'accessPoint'] }),
                details: { uplinkDeviceId: undefined },
                classicParentId: 'switch',
                classicLastParentId: 'switch',
            });
            expect(deviceStatus(console).uplinkId).to.equal('');
        });

        it('uses the last known parent of the classic list only while the device is not online', () => {
            const base = { details: { uplinkDeviceId: undefined }, classicLastParentId: 'old' };
            expect(deviceStatus(input(base)).uplinkId, 'online: history is ignored').to.equal('');
            expect(deviceStatus(input({ ...base, device: device({ state: 'OFFLINE' }) })).uplinkId).to.equal('old');
            expect(deviceStatus(input({ ...base, classicParentId: 'now' })).uplinkId).to.equal('now');
        });

        it('works without details, statistics and uplink', () => {
            const status = deviceStatus({ device: device() });
            expect(status.uplinkType).to.equal('');
            expect(status.uplinkId).to.equal('');
            expect(status.uptimeSec).to.equal(undefined);
            expect(status.degraded).to.equal(false);
        });
    });

    describe('summarize', () => {
        const ok = deviceStatus(input());
        const slow = deviceStatus(input({ uplink: wired(100, 1000), usualSpeedMbps: 1000 }));
        const off = deviceStatus(input({ device: device({ state: 'OFFLINE' }) }));
        const busy = deviceStatus(input({ device: device({ state: 'UPDATING', updatable: true }) }));

        it('orders the states: stale before offline before degraded before ok', () => {
            expect(summarize([ok], false).state).to.equal('ok');
            expect(summarize([ok, slow], false).state).to.equal('degraded');
            expect(summarize([ok, slow, off], false).state).to.equal('offline');
            expect(summarize([ok, slow, off], true).state).to.equal('stale');
        });

        it('counts devices', () => {
            expect(summarize([ok, slow, off, busy], false)).to.deep.equal({
                total: 4,
                online: 2,
                offline: 1,
                degraded: 1,
                updates: 1,
                state: 'offline',
            });
        });

        it('does not count an update as a failure', () => {
            expect(summarize([ok, busy], false).state).to.equal('ok');
        });
    });

    it('isStale after more than three intervals or without any data', () => {
        expect(isStale(0, 60_000, 1_000_000)).to.equal(true);
        expect(isStale(1_000_000, 60_000, 1_000_000 + 180_000)).to.equal(false);
        expect(isStale(1_000_000, 60_000, 1_000_000 + 180_001)).to.equal(true);
    });
});
