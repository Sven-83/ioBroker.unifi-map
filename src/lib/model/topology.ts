/*
 * Topology (pure, no ioBroker): who is connected to whom, and which failures are only a consequence.
 *
 * Devices can move: a mesh access point connects to another access point when its parent fails or the signal
 * gets worse, and the devices on its cable move with it. So a device only counts as a consequence when it has
 * failed itself AND an ancestor on its last known way to the console has failed. A device that found another way
 * is simply online with a new uplink.
 *
 * Failed devices often report no uplink any more, so the last known uplink is kept.
 */

import type { DeviceStatus } from './status';

/** Longest chain followed, so a broken answer with a loop cannot hang the adapter */
const MAX_DEPTH = 32;

/** Node of the map */
export interface TopologyNode {
    /** Device ID */
    id: string;
    /** Name */
    name: string;
    /** Model */
    model: string;
    /** Role */
    role: DeviceStatus['role'];
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

    const nodes: TopologyNode[] = devices.map(d => {
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
        };
    });

    const edges: TopologyEdge[] = [];
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
        });
    }
    return { rootId: root, nodes, edges };
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
