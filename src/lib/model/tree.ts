/*
 * Object tree: devices.<id>.* and summary.*. Objects are written once, states only when their value changes.
 * Object IDs come from the API id, never from names or MAC addresses.
 */

import type { RestartInfo } from './restarts';
import type { DeviceStatus, NetworkSummary } from './status';
import type { Topology, TopologyNode } from './topology';

/** What the tree needs from the adapter */
export interface TreeHost {
    /** Creates or updates an object */
    writeObject(id: string, object: ioBroker.SettableObject): Promise<unknown>;
    /** Writes a state with ack: true */
    writeState(id: string, value: ioBroker.StateValue): Promise<unknown>;
}

interface StateDef {
    key: string;
    name: string;
    type: ioBroker.CommonType;
    role: string;
    unit?: string;
    states?: Record<string, string>;
    get: (device: DeviceStatus, restarts: RestartInfo, node: TopologyNode) => ioBroker.StateValue;
}

/** States of one device */
export const DEVICE_STATES: StateDef[] = [
    { key: 'name', name: 'Name', type: 'string', role: 'info.name', get: d => d.name },
    { key: 'model', name: 'Model', type: 'string', role: 'info.model', get: d => d.model },
    {
        key: 'role',
        name: 'Role in the network',
        type: 'string',
        role: 'text',
        states: { gateway: 'console', switch: 'switch', accessPoint: 'access point', other: 'other' },
        get: d => d.role,
    },
    { key: 'state', name: 'State reported by the console', type: 'string', role: 'info.status', get: d => d.state },
    { key: 'online', name: 'Online', type: 'boolean', role: 'indicator.reachable', get: d => d.online },
    { key: 'ip', name: 'IP address', type: 'string', role: 'info.ip', get: d => d.ip },
    { key: 'firmware', name: 'Firmware', type: 'string', role: 'info.firmware', get: d => d.firmware },
    { key: 'updatable', name: 'Firmware update available', type: 'boolean', role: 'indicator', get: d => d.updatable },
    { key: 'uptime', name: 'Uptime', type: 'number', role: 'value', unit: 's', get: d => d.uptimeSec ?? null },
    {
        key: 'lastRestart',
        name: 'Time of the last start',
        type: 'number',
        role: 'value.time',
        get: (_d, r) => r.lastRestart,
    },
    {
        key: 'restartCount7d',
        name: 'Restarts in the last 7 days',
        type: 'number',
        role: 'value',
        get: (_d, r) => r.restartCount7d,
    },
    { key: 'uplinkId', name: 'Device it is connected to', type: 'string', role: 'text', get: d => d.uplinkId },
    {
        key: 'uplinkType',
        name: 'Connection to that device',
        type: 'string',
        role: 'text',
        states: { wired: 'cable', wireless: 'wireless (mesh)', '': 'unknown' },
        get: d => d.uplinkType,
    },
    {
        key: 'linkSpeed',
        name: 'Link speed (mesh: transmit rate)',
        type: 'number',
        role: 'value',
        unit: 'Mbit/s',
        get: d => d.linkSpeed ?? null,
    },
    {
        key: 'linkMaxSpeed',
        name: 'Highest link speed (cable)',
        type: 'number',
        role: 'value',
        unit: 'Mbit/s',
        get: d => d.linkMaxSpeed ?? null,
    },
    {
        key: 'signal',
        name: 'Signal of the mesh link',
        type: 'number',
        role: 'value',
        unit: 'dBm',
        get: d => d.signalDbm ?? null,
    },
    {
        key: 'degraded',
        name: 'Uplink below its maximum',
        type: 'boolean',
        role: 'indicator.alarm',
        get: d => d.degraded,
    },
    {
        key: 'degradedReason',
        name: 'Why the device is shown yellow',
        type: 'string',
        role: 'text',
        get: d => d.degradedReason,
    },
    { key: 'clients', name: 'Connected clients', type: 'number', role: 'value', get: d => d.clients ?? null },
    {
        key: 'consequence',
        name: 'Unreachable only because a device before it failed',
        type: 'boolean',
        role: 'indicator',
        get: (_d, _r, n) => n.state === 'consequence',
    },
    {
        key: 'causeId',
        name: 'Failed device that cuts it off',
        type: 'string',
        role: 'text',
        get: (_d, _r, n) => n.causeId,
    },
];

/** States of the summary */
export const SUMMARY_STATES: { key: keyof NetworkSummary; name: string; type: ioBroker.CommonType; role: string }[] = [
    { key: 'total', name: 'Devices', type: 'number', role: 'value' },
    { key: 'online', name: 'Devices online', type: 'number', role: 'value' },
    { key: 'offline', name: 'Devices offline', type: 'number', role: 'value' },
    { key: 'degraded', name: 'Devices with a slow uplink', type: 'number', role: 'value' },
    { key: 'updates', name: 'Firmware updates available', type: 'number', role: 'value' },
    { key: 'state', name: 'State of the network', type: 'string', role: 'text' },
];

/** Keeps the tree in line with the console, with as few database writes as possible */
export class ObjectTree {
    private readonly objects = new Map<string, string>();
    private readonly values = new Map<string, ioBroker.StateValue>();

    /**
     * @param host - Adapter functions
     */
    public constructor(private readonly host: TreeHost) {}

    /**
     * Writes one device.
     *
     * @param device - Status
     * @param restarts - Restart information
     * @param node - Node of the topology
     */
    public async writeDevice(device: DeviceStatus, restarts: RestartInfo, node: TopologyNode): Promise<void> {
        const base = `devices.${device.id}`;
        await this.ensureObject('devices', { type: 'folder', common: { name: 'Devices' }, native: {} });
        await this.ensureObject(base, { type: 'device', common: { name: device.name || device.model }, native: {} });
        for (const def of DEVICE_STATES) {
            const id = `${base}.${def.key}`;
            await this.ensureObject(id, {
                type: 'state',
                common: {
                    name: def.name,
                    type: def.type,
                    role: def.role,
                    read: true,
                    write: false,
                    ...(def.unit ? { unit: def.unit } : {}),
                    ...(def.states ? { states: def.states } : {}),
                },
                native: {},
            });
            await this.setValue(id, def.get(device, restarts, node));
        }
    }

    /**
     * Writes the topology for the map.
     *
     * @param topology - Nodes and edges
     */
    public async writeTopology(topology: Topology): Promise<void> {
        await this.ensureObject('topology', { type: 'channel', common: { name: 'Topology' }, native: {} });
        await this.ensureObject('topology.json', {
            type: 'state',
            common: { name: 'Nodes and links for the map', type: 'string', role: 'json', read: true, write: false },
            native: {},
        });
        await this.setValue('topology.json', JSON.stringify(topology));
    }

    /**
     * Writes the summary.
     *
     * @param summary - Counts and state
     * @param details - Detail list for the widget
     */
    public async writeSummary(summary: NetworkSummary, details: unknown): Promise<void> {
        await this.ensureObject('summary', { type: 'channel', common: { name: 'Summary' }, native: {} });
        for (const def of SUMMARY_STATES) {
            const id = `summary.${def.key}`;
            await this.ensureObject(id, {
                type: 'state',
                common: {
                    name: def.name,
                    type: def.type,
                    role: def.role,
                    read: true,
                    write: false,
                    ...(def.key === 'state'
                        ? {
                              states: {
                                  ok: 'ok',
                                  degraded: 'slow uplink',
                                  offline: 'device offline',
                                  stale: 'data too old',
                              },
                          }
                        : {}),
                },
                native: {},
            });
            await this.setValue(id, summary[def.key]);
        }
        await this.ensureObject('summary.json', {
            type: 'state',
            common: { name: 'Detail list for the widget', type: 'string', role: 'json', read: true, write: false },
            native: {},
        });
        await this.setValue('summary.json', JSON.stringify(details));
    }

    /**
     * Writes a state with ack: true if its value has changed.
     *
     * @param id - Relative state ID
     * @param value - New value
     * @returns The value was written
     */
    public async setValue(id: string, value: ioBroker.StateValue): Promise<boolean> {
        if (this.values.get(id) === value) {
            return false;
        }
        await this.host.writeState(id, value);
        this.values.set(id, value);
        return true;
    }

    /**
     * Last value written to a state.
     *
     * @param id - Relative state ID
     */
    public value(id: string): ioBroker.StateValue | undefined {
        return this.values.get(id);
    }

    private async ensureObject(id: string, object: ioBroker.SettableObject): Promise<void> {
        const signature = JSON.stringify(object);
        if (this.objects.get(id) !== signature) {
            await this.host.writeObject(id, object);
            this.objects.set(id, signature);
        }
    }
}
