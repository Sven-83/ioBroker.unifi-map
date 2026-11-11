/*
 * State logic (pure, no ioBroker): what each device and the whole network show.
 *
 * - offline (red):    a device is not online and not busy with an update or start
 * - degraded (yellow): all reachable, but a cable uplink runs below its maximum (e.g. 100 of 1000 Mbit/s);
 *                      only uplinks count - endpoints on 10/100 Mbit at switch ports are normal
 * - stale (grey):     the data is too old; the tile never shows green from old values
 * - ok (green):       everything else
 */

import type { ClassicUplink, DeviceDetails, DeviceStatistics, UnifiDevice } from '../api/client';

/** States that mean "busy", not "failed" */
export const BUSY_STATES = new Set(['UPDATING', 'GETTING_READY', 'ADOPTING', 'PENDING_ADOPTION']);
/** Data counts as stale after this many polling intervals */
export const STALE_INTERVALS = 3;

/** Role in the network */
export type DeviceRole = 'gateway' | 'switch' | 'accessPoint' | 'other';
/** State of the network */
export type NetworkState = 'ok' | 'degraded' | 'offline' | 'stale';

/** What is shown for one device */
export interface DeviceStatus {
    /** ID of the API, also the object ID */
    id: string;
    /** Name in the UniFi application */
    name: string;
    /** Model */
    model: string;
    /** Role in the network */
    role: DeviceRole;
    /** State reported by the console */
    state: string;
    /** State is ONLINE */
    online: boolean;
    /** Not online and not busy */
    failed: boolean;
    /** IP address */
    ip: string;
    /** Installed firmware */
    firmware: string;
    /** A firmware update is available */
    updatable: boolean;
    /** Uptime in seconds, undefined if not online or unknown */
    uptimeSec: number | undefined;
    /** ID of the device it is connected to, empty for the console */
    uplinkId: string;
    /** Connection to that device, empty if unknown */
    uplinkType: 'wired' | 'wireless' | '';
    /** Link speed (cable) or transmit rate (mesh) in Mbit/s */
    linkSpeed: number | undefined;
    /** Highest link speed in Mbit/s (cable) */
    linkMaxSpeed: number | undefined;
    /** Signal of a mesh link in dBm */
    signalDbm: number | undefined;
    /** Cable uplink below its maximum */
    degraded: boolean;
    /** Why the device is shown yellow */
    degradedReason: string;
    /** Connected clients */
    clients: number | undefined;
    /** Port of the parent device the cable ends in */
    uplinkPort: number | undefined;
    /** UniFi devices seen on the own cable ports (LLDP) */
    neighbors: { id: string; port: number | undefined }[];
}

/** Counts and state of the whole network */
export interface NetworkSummary {
    /** All devices */
    total: number;
    /** Devices online */
    online: number;
    /** Devices failed (not online and not busy) */
    offline: number;
    /** Devices with a slow cable uplink */
    degraded: number;
    /** Devices with a firmware update */
    updates: number;
    /** State of the network */
    state: NetworkState;
}

/** Everything known about one device after a poll */
export interface DeviceInput {
    /** Entry of the device list */
    device: UnifiDevice;
    /** Details, if read */
    details?: DeviceDetails;
    /** Statistics, if read */
    statistics?: DeviceStatistics;
    /** Uplink of the classic list, if read */
    uplink?: ClassicUplink;
    /** Number of clients */
    clients?: number;
    /** Parent found through the classic list, used when the details have none */
    classicParentId?: string;
    /** Last known parent of the classic list, used only while the device is not online */
    classicLastParentId?: string;
    /** UniFi devices seen through LLDP, joined to their IDs */
    neighbors?: { id: string; port: number | undefined }[];
}

/**
 * Role from the details: the console has no uplink, otherwise by feature.
 *
 * @param device - Device
 * @param details - Details, if read
 */
export function roleOf(device: UnifiDevice, details: DeviceDetails | undefined): DeviceRole {
    if (details && !details.uplinkDeviceId && device.features.includes('switching')) {
        return 'gateway';
    }
    if (device.features.includes('switching')) {
        return 'switch';
    }
    if (device.features.includes('accessPoint')) {
        return 'accessPoint';
    }
    return 'other';
}

/**
 * Status of one device.
 *
 * @param input - Data of the device
 */
export function deviceStatus(input: DeviceInput): DeviceStatus {
    const { device, details, statistics, uplink } = input;
    const online = device.state === 'ONLINE';
    const role = roleOf(device, details);
    const wired = uplink?.type === 'wired';
    // the console's own uplink is the internet line, not a link inside the network
    const slow =
        online &&
        role !== 'gateway' &&
        wired &&
        uplink.speedMbps !== undefined &&
        uplink.maxSpeedMbps !== undefined &&
        uplink.speedMbps > 0 &&
        uplink.speedMbps < uplink.maxSpeedMbps;
    return {
        id: device.id,
        name: device.name,
        model: device.model,
        role,
        state: device.state,
        online,
        failed: !online && !BUSY_STATES.has(device.state),
        ip: device.ip,
        firmware: device.firmware,
        updatable: device.updatable,
        uptimeSec: online ? statistics?.uptimeSec : undefined,
        // the console is the root: what the classic list reports as its uplink is the internet line or history
        uplinkId:
            role === 'gateway'
                ? ''
                : details?.uplinkDeviceId || input.classicParentId || (online ? '' : input.classicLastParentId) || '',
        uplinkType: uplink?.type ?? '',
        linkSpeed: uplink?.speedMbps,
        linkMaxSpeed: uplink?.maxSpeedMbps,
        signalDbm: uplink?.signalDbm,
        degraded: slow,
        degradedReason: slow ? `uplink ${uplink.speedMbps} of ${uplink.maxSpeedMbps} Mbit/s` : '',
        clients: input.clients,
        uplinkPort: uplink?.remotePort,
        neighbors: input.neighbors ?? [],
    };
}

/**
 * Counts and state of the network.
 *
 * @param devices - Status of all devices
 * @param stale - The data is too old
 */
export function summarize(devices: DeviceStatus[], stale: boolean): NetworkSummary {
    const offline = devices.filter(d => d.failed).length;
    const degraded = devices.filter(d => d.degraded).length;
    let state: NetworkState = 'ok';
    if (stale) {
        state = 'stale';
    } else if (offline > 0) {
        state = 'offline';
    } else if (degraded > 0) {
        state = 'degraded';
    }
    return {
        total: devices.length,
        online: devices.filter(d => d.online).length,
        offline,
        degraded,
        updates: devices.filter(d => d.updatable).length,
        state,
    };
}

/**
 * The last successful poll is older than STALE_INTERVALS intervals.
 *
 * @param lastUpdate - Time of the last successful poll, 0 if none
 * @param intervalMs - Polling interval
 * @param now - Current time
 */
export function isStale(lastUpdate: number, intervalMs: number, now = Date.now()): boolean {
    return !lastUpdate || now - lastUpdate > STALE_INTERVALS * intervalMs;
}
