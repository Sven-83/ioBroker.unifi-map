/*
 * Topology (pure, no ioBroker): who is connected to whom, and which failures are only a consequence.
 *
 * Devices can move: a mesh access point connects to another access point when its parent fails or the signal
 * gets worse, and the devices on its cable move with it. So a device only counts as a consequence when it has
 * failed itself AND an ancestor on its last known way to the console has failed. A device that found another way
 * is simply online with a new uplink.
 *
 * Failed devices often report no uplink any more, so the last known uplink is kept.
 *
 * Devices that point at each other in a circle are connected through a section that is not UniFi (a simple switch or
 * powerline adapters): it passes the discovery packets (LLDP) on, so two access points behind it see each other as
 * parent. They are put below a placeholder. The placeholder hangs below the UniFi device that all members of the
 * circle see as LLDP neighbour (that is where the section is plugged in), otherwise below the console.
 */

import type { DeviceStatus } from './status';

/** Longest chain followed, so a broken answer with a loop cannot hang the adapter */
const MAX_DEPTH = 32;
/** ID prefix of placeholders */
const PLACEHOLDER = 'unknown-switch-';

/** Node of the map */
export interface TopologyNode {
    /** Device ID */
    id: string;
    /** Name */
    name: string;
    /** Model */
    model: string;
    /** Role; unknownSwitch for the placeholder of a section that is not UniFi (simple switch, powerline) */
    role: DeviceStatus['role'] | 'unknownSwitch';
    /** Placeholder, not a device of the console */
    virtual: boolean;
    /** What the map shows */
    state: 'ok' | 'degraded' | 'offline' | 'consequence' | 'busy';
    /** Parent, empty for the console or if unknown */
    uplinkId: string;
    /** Distance from the console (console 0), -1 if not connected to it */
    depth: number;
    /** For a consequence: the failed device that cuts it off */
    causeId: string;
    /** Firmware update available */
    updatable: boolean;
}

/** Edge of the map: parent -> child */
export interface TopologyEdge {
    /** Parent device */
    from: string;
    /** Child device */
    to: string;
    /** Cable or mesh, empty if unknown */
    type: DeviceStatus['uplinkType'];
    /** Speed (cable) or transmit rate (mesh) in Mbit/s */
    speed: number | null;
    /** Highest speed (cable) */
    maxSpeed: number | null;
    /** Signal of a mesh link in dBm */
    signal: number | null;
    /** The link is below its maximum */
    degraded: boolean;
    /** The uplink is the last known one, the device reports none at the moment */
    remembered: boolean;
    /** Port of the parent device, if known */
    port: number | null;
}

/** The whole map */
export interface Topology {
    /** Console, empty if none was found */
    rootId: string;
    /** Devices */
    nodes: TopologyNode[];
    /** Links */
    edges: TopologyEdge[];
}

/**
 * Builds the topology.
 *
 * @param devices - Status of all devices
 * @param lastUplinks - Last known parent per device (from earlier polls)
 */
export function buildTopology(devices: DeviceStatus[], lastUplinks: ReadonlyMap<string, string>): Topology {
    const byId = new Map(devices.map(d => [d.id, d]));
    const parentOf = (d: DeviceStatus): { id: string; remembered: boolean } => {
        if (d.uplinkId && byId.has(d.uplinkId)) {
            return { id: d.uplinkId, remembered: false };
        }
        const last = lastUplinks.get(d.id);
        // the console never gets a remembered parent: it is the root
        if (last && byId.has(last) && d.role !== 'gateway') {
            return { id: last, remembered: true };
        }
        return { id: '', remembered: false };
    };
    const parents = new Map(devices.map(d => [d.id, parentOf(d)]));
    const root = devices.find(d => d.role === 'gateway')?.id ?? '';
    const placeholders = placeUnknownSwitches(devices, parents, root, byId);

    // walks up to the console; returns depth and the nearest failed ancestor
    const walk = (id: string): { depth: number; cause: string } => {
        let depth = 0;
        let cause = '';
        let current = id;
        const seen = new Set<string>([id]);
        while (current !== root) {
            const parent = parents.get(current)?.id ?? '';
            if (!parent || seen.has(parent) || depth >= MAX_DEPTH) {
                return { depth: -1, cause };
            }
            depth++;
            if (!cause && byId.get(parent)?.failed) {
                cause = parent;
            }
            seen.add(parent);
            current = parent;
        }
        return { depth, cause };
    };

    const nodes: TopologyNode[] = placeholders.map(p => ({
        id: p.id,
        name: '',
        model: '',
        role: 'unknownSwitch' as const,
        state: 'ok' as const,
        uplinkId: p.parent,
        depth: walk(p.id).depth,
        causeId: '',
        updatable: false,
        virtual: true,
    }));
    nodes.push(
        ...devices.map(d => {
            const { depth, cause } = walk(d.id);
            const consequence = d.failed && cause !== '';
            let state: TopologyNode['state'] = 'ok';
            if (consequence) {
                state = 'consequence';
            } else if (d.failed) {
                state = 'offline';
            } else if (!d.online) {
                state = 'busy';
            } else if (d.degraded) {
                state = 'degraded';
            }
            return {
                id: d.id,
                name: d.name,
                model: d.model,
                role: d.role,
                state,
                uplinkId: parents.get(d.id)?.id ?? '',
                depth: d.id === root ? 0 : depth,
                causeId: consequence ? rootCause(cause, parents, byId) : '',
                updatable: d.updatable,
                virtual: false,
            };
        }),
    );

    const edges: TopologyEdge[] = placeholders
        .filter(p => p.parent)
        .map(p => ({
            from: p.parent,
            to: p.id,
            type: '' as const,
            speed: null,
            maxSpeed: null,
            signal: null,
            degraded: false,
            remembered: false,
            port: p.port ?? null,
        }));
    for (const d of devices) {
        const parent = parents.get(d.id)!;
        if (!parent.id) {
            continue;
        }
        edges.push({
            from: parent.id,
            to: d.id,
            type: d.uplinkType,
            speed: d.linkSpeed ?? null,
            maxSpeed: d.linkMaxSpeed ?? null,
            signal: d.signalDbm ?? null,
            degraded: d.degraded,
            remembered: parent.remembered,
            // behind a placeholder the reported port belongs to the other member, not to the section
            port: d.uplinkType === 'wired' && !parent.id.startsWith(PLACEHOLDER) ? (d.uplinkPort ?? null) : null,
        });
    }
    return { rootId: root, nodes, edges };
}

/** Placeholder for a section that is not UniFi */
interface Placeholder {
    /** ID, unknown-switch-<n> */
    id: string;
    /** Device the section is plugged into, the console if none was found */
    parent: string;
    /** Port of that device, if LLDP names it */
    port: number | undefined;
}

/**
 * Finds devices that point at each other in a circle and puts each circle below a placeholder for a section that
 * is not UniFi. The placeholder hangs below the device found through LLDP, otherwise below the console.
 * Changes `parents` in place.
 *
 * @param devices - All devices
 * @param parents - Parent per device
 * @param root - Console
 * @param byId - Devices by ID
 * @returns The placeholders
 */
function placeUnknownSwitches(
    devices: DeviceStatus[],
    parents: Map<string, { id: string; remembered: boolean }>,
    root: string,
    byId: ReadonlyMap<string, DeviceStatus>,
): Placeholder[] {
    const circles: { id: string; members: string[] }[] = [];
    const done = new Set<string>();
    for (const device of devices) {
        const path: string[] = [];
        const onPath = new Set<string>();
        let current = device.id;
        while (current && current !== root && !done.has(current) && !onPath.has(current)) {
            path.push(current);
            onPath.add(current);
            current = parents.get(current)?.id ?? '';
        }
        if (current && onPath.has(current)) {
            const id = `${PLACEHOLDER}${circles.length + 1}`;
            const members = path.slice(path.indexOf(current));
            for (const member of members) {
                parents.set(member, { id, remembered: parents.get(member)?.remembered ?? false });
            }
            parents.set(id, { id: root, remembered: false });
            circles.push({ id, members });
        }
        for (const id of path) {
            done.add(id);
        }
    }
    // only after all circles are resolved: the device found through LLDP may itself sit behind a placeholder
    return circles.map(({ id, members }) => {
        const found = attachPoint(members, devices, byId);
        if (found && !leadsThrough(found.id, id, parents)) {
            parents.set(id, { id: found.id, remembered: false });
            return { id, parent: found.id, port: found.port };
        }
        return { id, parent: root, port: undefined };
    });
}

/**
 * The UniFi device a section that is not UniFi is plugged into: the one that every member of the circle sees as
 * LLDP neighbour. If several qualify, the one that also sees a member on one of its own ports wins. Undefined if
 * no single device is found.
 *
 * @param members - Devices of the circle
 * @param devices - All devices
 * @param byId - Devices by ID
 */
function attachPoint(
    members: string[],
    devices: DeviceStatus[],
    byId: ReadonlyMap<string, DeviceStatus>,
): { id: string; port: number | undefined } | undefined {
    const inCircle = new Set(members);
    const seenByAll = devices
        .filter(d => !inCircle.has(d.id))
        .filter(d => members.every(m => byId.get(m)?.neighbors.some(n => n.id === d.id)))
        .map(d => d.id);
    // the device's own entry for a member, if it sees one
    const towards = (id: string): { port: number | undefined } | undefined =>
        byId.get(id)?.neighbors.find(n => inCircle.has(n.id));
    const confirmed = seenByAll.filter(id => towards(id));
    const pick = confirmed.length === 1 ? confirmed[0] : seenByAll.length === 1 ? seenByAll[0] : undefined;
    return pick ? { id: pick, port: towards(pick)?.port } : undefined;
}

/**
 * The way from a device up to the console passes the given node.
 *
 * @param from - Start
 * @param target - Node looked for
 * @param parents - Parent per device
 */
function leadsThrough(from: string, target: string, parents: ReadonlyMap<string, { id: string }>): boolean {
    let current = from;
    for (let i = 0; i < MAX_DEPTH && current; i++) {
        if (current === target) {
            return true;
        }
        current = parents.get(current)?.id ?? '';
    }
    return false;
}

/**
 * The topmost failed device above a failed one: if a switch and the access point on it are both down,
 * the switch is the cause.
 *
 * @param start - Nearest failed ancestor
 * @param parents - Parent per device
 * @param byId - Devices
 */
function rootCause(
    start: string,
    parents: ReadonlyMap<string, { id: string }>,
    byId: ReadonlyMap<string, DeviceStatus>,
): string {
    let cause = start;
    let current = start;
    for (let i = 0; i < MAX_DEPTH; i++) {
        const parent = parents.get(current)?.id ?? '';
        if (!parent) {
            break;
        }
        if (byId.get(parent)?.failed) {
            cause = parent;
        }
        current = parent;
    }
    return cause;
}

/**
 * Parents to remember for the next poll: the current uplink of every device that reports one.
 *
 * @param devices - Status of all devices
 * @param previous - Remembered so far
 */
export function rememberUplinks(devices: DeviceStatus[], previous: ReadonlyMap<string, string>): Map<string, string> {
    const known = new Set(devices.map(d => d.id));
    const next = new Map<string, string>();
    for (const [id, parent] of previous) {
        // devices that disappeared from the console are forgotten
        if (known.has(id)) {
            next.set(id, parent);
        }
    }
    for (const d of devices) {
        if (d.uplinkId) {
            next.set(d.id, d.uplinkId);
        }
    }
    return next;
}

/**
 * Reads the remembered parents from a stored topology.json.
 *
 * @param stored - Value of topology.json
 */
export function uplinksFromStored(stored: unknown): Map<string, string> {
    const result = new Map<string, string>();
    try {
        const parsed = typeof stored === 'string' && stored ? (JSON.parse(stored) as Partial<Topology>) : {};
        for (const node of Array.isArray(parsed.nodes) ? parsed.nodes : []) {
            if (typeof node?.id === 'string' && typeof node.uplinkId === 'string' && node.uplinkId) {
                result.set(node.id, node.uplinkId);
            }
        }
    } catch {
        // damaged value: start without remembered uplinks
    }
    return result;
}
