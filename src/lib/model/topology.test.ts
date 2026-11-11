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
        ...overrides,
    };
}
const off = { state: 'OFFLINE', uplinkId: '' } as const;

/**
 * console -> switchA -> apCable; console ~mesh~ apMesh -> switchB
 *
 * @param changes
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

    it('does not hang on a loop in broken data', () => {
        const t = buildTopology(
            [dev('console', 'gateway', ''), dev('a', 'switch', 'b'), dev('b', 'switch', 'a')],
            new Map(),
        );
        expect(node(t, 'a').depth).to.equal(-1);
        expect(node(t, 'b').depth).to.equal(-1);
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
