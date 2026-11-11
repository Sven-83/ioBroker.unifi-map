import { expect } from 'chai';
import type { DeviceStatus } from './status';
import { buildTopology, rememberUplinks, uplinksFromStored } from './topology';

function dev(
    id: string,
    role: DeviceStatus['role'],
    uplinkId: string,
    overrides: Partial<DeviceStatus> = {},
): DeviceStatus {
    const failed = overrides.state === 'OFFLINE';
    return {
        id,
        name: `Device ${id}`,
        model: 'M',
        role,
        state: 'ONLINE',
        online: !failed,
        failed,
        ip: '',
        firmware: '1',
        updatable: false,
        uptimeSec: 100,
        uplinkId,
        uplinkType: 'wired',
        linkSpeed: 1000,
        linkMaxSpeed: 1000,
        signalDbm: undefined,
        degraded: false,
        degradedReason: '',
        clients: 0,
        uplinkPort: undefined,
        neighbors: [],
        ...overrides,
    };
}
const off = { state: 'OFFLINE', uplinkId: '' } as const;

/**
 * console -> switchA -> apCable; console ~mesh~ apMesh -> switchB
 *
 * @param changes - Overrides per device
 */
function network(changes: Record<string, Partial<DeviceStatus>> = {}): DeviceStatus[] {
    return [
        dev('console', 'gateway', '', changes.console),
        dev('switchA', 'switch', 'console', changes.switchA),
        dev('apCable', 'accessPoint', 'switchA', changes.apCable),
        dev('apMesh', 'accessPoint', 'console', {
            uplinkType: 'wireless',
            linkMaxSpeed: undefined,
            signalDbm: -60,
            ...changes.apMesh,
        }),
        dev('switchB', 'switch', 'apMesh', changes.switchB),
    ];
}
const lastUplinks = new Map([
    ['switchA', 'console'],
    ['apCable', 'switchA'],
    ['apMesh', 'console'],
    ['switchB', 'apMesh'],
]);
const node = (t: ReturnType<typeof buildTopology>, id: string): ReturnType<typeof buildTopology>['nodes'][number] =>
    t.nodes.find(n => n.id === id)!;

describe('model/topology', () => {
    it('builds the tree with depth, cable and mesh links', () => {
        const t = buildTopology(network(), new Map());
        expect(t.rootId).to.equal('console');
        expect(t.nodes.map(n => [n.id, n.depth])).to.deep.equal([
            ['console', 0],
            ['switchA', 1],
            ['apCable', 2],
            ['apMesh', 1],
            ['switchB', 2],
        ]);
        expect(t.edges.find(e => e.to === 'apMesh')).to.include({
            from: 'console',
            type: 'wireless',
            signal: -60,
            remembered: false,
        });
        expect(t.edges.find(e => e.to === 'switchB')).to.include({ from: 'apMesh', type: 'wired', speed: 1000 });
        expect(t.nodes.every(n => n.state === 'ok')).to.equal(true);
    });

    it('marks the devices behind a failed switch as consequence, using their last known uplink', () => {
        const t = buildTopology(network({ switchA: off, apCable: off }), lastUplinks);
        expect(node(t, 'switchA')).to.include({ state: 'offline', causeId: '', uplinkId: 'console' });
        expect(node(t, 'apCable')).to.include({ state: 'consequence', causeId: 'switchA', uplinkId: 'switchA' });
        expect(t.edges.find(e => e.to === 'apCable')?.remembered).to.equal(true);
    });

    it('does not mark a device that found another way (mesh access point moved)', () => {
        // apCable is gone; apMesh now connects to it no more but to switchA's neighbour - here: still online via console
        const t = buildTopology(network({ switchA: off, apMesh: { uplinkId: 'console' } }), lastUplinks);
        expect(node(t, 'apMesh').state).to.equal('ok');
        const moved = buildTopology(network({ apCable: off, apMesh: { uplinkId: 'switchA' } }), lastUplinks);
        expect(node(moved, 'apMesh')).to.include({ state: 'ok', uplinkId: 'switchA', depth: 2 });
        expect(node(moved, 'switchB')).to.include({ state: 'ok', depth: 3 });
    });

    it('does not mark a device online behind a failed parent: it is reachable, so it is not cut off', () => {
        const t = buildTopology(network({ apMesh: { state: 'OFFLINE' } }), lastUplinks);
        expect(node(t, 'apMesh').state).to.equal('offline');
        expect(node(t, 'switchB').state).to.equal('ok');
    });

    it('names the topmost failed device as the cause', () => {
        const t = buildTopology(network({ apMesh: off, switchB: off }), lastUplinks);
        expect(node(t, 'switchB')).to.include({ state: 'consequence', causeId: 'apMesh' });
        const deep = buildTopology(
            [...network({ switchA: off, apCable: off }), dev('behind', 'accessPoint', '', { state: 'OFFLINE' })],
            new Map([...lastUplinks, ['behind', 'apCable']]),
        );
        expect(node(deep, 'behind')).to.include({ state: 'consequence', causeId: 'switchA', depth: 3 });
    });

    it('shows busy, degraded and failed devices without a known parent', () => {
        const t = buildTopology(
            network({
                apCable: { state: 'UPDATING', online: false, failed: false },
                switchB: { degraded: true },
                apMesh: off,
            }),
            new Map(),
        );
        expect(node(t, 'apCable').state).to.equal('busy');
        expect(node(t, 'switchB').state).to.equal('degraded');
        expect(node(t, 'apMesh')).to.include({ state: 'offline', depth: -1, uplinkId: '' });
    });

    it('resolves a circle of three and keeps a device that only points into it', () => {
        const t = buildTopology(
            [
                dev('console', 'gateway', ''),
                dev('a', 'switch', 'b'),
                dev('b', 'switch', 'c'),
                dev('c', 'switch', 'a'),
                dev('d', 'accessPoint', 'a'),
            ],
            new Map(),
        );
        expect(['a', 'b', 'c'].map(id => node(t, id).uplinkId)).to.deep.equal(Array(3).fill('unknown-switch-1'));
        expect(node(t, 'd')).to.include({ uplinkId: 'a', depth: 3 });
        expect(t.nodes.filter(n => n.virtual)).to.have.length(1);
    });

    it('leaves a device without any known parent unconnected', () => {
        const t = buildTopology([dev('console', 'gateway', ''), dev('lost', 'switch', 'nobody')], new Map());
        expect(node(t, 'lost')).to.include({ depth: -1, uplinkId: '' });
    });

    it('puts devices that point at each other below a placeholder for a switch that is not UniFi', () => {
        // two access points on a simple switch see each other as parent (LLDP passes the simple switch)
        const t = buildTopology(
            [...network(), dev('apX', 'accessPoint', 'apY', { linkSpeed: 100 }), dev('apY', 'accessPoint', 'apX')],
            new Map(),
        );
        const placeholder = t.nodes.find(n => n.virtual)!;
        expect(placeholder).to.include({
            id: 'unknown-switch-1',
            role: 'unknownSwitch',
            uplinkId: 'console',
            depth: 1,
            state: 'ok',
        });
        expect(node(t, 'apX')).to.include({ uplinkId: 'unknown-switch-1', depth: 2, state: 'ok' });
        expect(node(t, 'apY')).to.include({ uplinkId: 'unknown-switch-1', depth: 2 });
        expect(t.edges.find(e => e.to === 'unknown-switch-1')).to.include({ from: 'console', type: '' });
        expect(t.edges.find(e => e.to === 'apX')).to.include({ from: 'unknown-switch-1', speed: 100 });
        expect(t.nodes.filter(n => !n.virtual)).to.have.length(7);
    });

    it('hangs the placeholder below the device that all members see through LLDP (powerline)', () => {
        // like the real network: two access points on powerline adapters, plugged into port 4 of switchB,
        // which sits behind a mesh access point; LLDP passes the adapters, so each sees the other and switchB
        const seen = (...ids: string[]): Partial<DeviceStatus> => ({
            neighbors: ids.map(id => ({ id, port: 1 })),
        });
        const devices = [
            ...network({
                switchB: {
                    neighbors: [
                        { id: 'apMesh', port: 1 },
                        { id: 'apY', port: 4 },
                    ],
                },
            }),
            dev('apX', 'accessPoint', 'apY', { linkSpeed: 100, uplinkPort: 1, ...seen('apY', 'switchB') }),
            dev('apY', 'accessPoint', 'apX', { uplinkPort: 1, ...seen('apX', 'switchB') }),
        ];
        const t = buildTopology(devices, new Map());
        expect(node(t, 'unknown-switch-1')).to.include({ uplinkId: 'switchB', depth: 3, virtual: true });
        expect(node(t, 'apX')).to.include({ uplinkId: 'unknown-switch-1', depth: 4 });
        expect(t.edges.find(e => e.to === 'unknown-switch-1')).to.include({ from: 'switchB', port: 4, type: '' });
        // the port reported behind the section belongs to the other member, so it is not shown
        expect(t.edges.find(e => e.to === 'apX')).to.include({ port: null, speed: 100 });
        expect(t.edges.find(e => e.to === 'switchB')?.port).to.equal(null);
    });

    it('keeps the placeholder below the console when LLDP gives no single answer', () => {
        const both = {
            neighbors: [
                { id: 'switchA', port: 1 },
                { id: 'switchB', port: 1 },
            ],
        };
        const t = buildTopology(
            [...network(), dev('apX', 'accessPoint', 'apY', both), dev('apY', 'accessPoint', 'apX', both)],
            new Map(),
        );
        expect(node(t, 'unknown-switch-1')).to.include({ uplinkId: 'console', depth: 1 });
        expect(t.edges.find(e => e.to === 'unknown-switch-1')?.port).to.equal(null);
    });

    it('never hangs a placeholder below a device behind itself', () => {
        const t = buildTopology(
            [
                dev('console', 'gateway', ''),
                dev('apX', 'accessPoint', 'apY', { neighbors: [{ id: 'sw', port: 1 }] }),
                dev('apY', 'accessPoint', 'apX', { neighbors: [{ id: 'sw', port: 1 }] }),
                dev('sw', 'switch', 'apX'),
            ],
            new Map(),
        );
        expect(node(t, 'unknown-switch-1')).to.include({ uplinkId: 'console', depth: 1 });
        expect(node(t, 'sw')).to.include({ uplinkId: 'apX', depth: 3 });
    });

    it('shows the parent port of cable links', () => {
        const t = buildTopology(network({ apCable: { uplinkPort: 3 } }), new Map());
        expect(t.edges.find(e => e.to === 'apCable')?.port).to.equal(3);
    });

    it('marks a device behind a failed member of such a group as consequence of that member', () => {
        const t = buildTopology(
            [
                ...network(),
                dev('apX', 'accessPoint', 'apY', { state: 'OFFLINE' }),
                dev('apY', 'accessPoint', 'apX'),
                dev('behindX', 'switch', '', { state: 'OFFLINE' }),
            ],
            new Map([['behindX', 'apX']]),
        );
        expect(node(t, 'apX').state).to.equal('offline');
        expect(node(t, 'behindX')).to.include({ state: 'consequence', causeId: 'apX', depth: 3 });
    });

    it('never gives the console a remembered parent', () => {
        const t = buildTopology(network(), new Map([['console', 'switchA']]));
        expect(node(t, 'console')).to.include({ uplinkId: '', depth: 0 });
    });

    it('remembers current uplinks and forgets devices that are gone', () => {
        const next = rememberUplinks(network({ apCable: off }), new Map([...lastUplinks, ['gone', 'console']]));
        expect(next.get('apCable')).to.equal('switchA');
        expect(next.has('gone')).to.equal(false);
        expect(next.get('apMesh')).to.equal('console');
    });

    it('reads remembered uplinks from a stored topology', () => {
        const stored = JSON.stringify(buildTopology(network(), new Map()));
        expect(uplinksFromStored(stored).get('switchB')).to.equal('apMesh');
        expect(uplinksFromStored('{broken').size).to.equal(0);
        expect(uplinksFromStored(undefined).size).to.equal(0);
    });
});
