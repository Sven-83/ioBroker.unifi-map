/*
 * Reads the UniFi Network application. The official Integration API (X-API-KEY, Network 9.3 and newer) is used
 * wherever it has the data. Only cable/mesh and the link speed of the uplink are missing there; they come from the
 * classic device list, which is unofficial and may change with updates (audit B.11.18). Everything here is read only.
 */

import { ApiError } from './errors';
import type { UnifiHttp } from './http';

/** Official Integration API (UniFi OS consoles) */
export const INTEGRATION_PATH = '/proxy/network/integration/v1';
/** UNOFFICIAL: classic API, used only for uplink type and speed */
export const CLASSIC_PATH = '/proxy/network/api/s';
/** Page size of lists */
export const PAGE_SIZE = 200;
/** Upper limit of list pages, so a broken answer cannot loop */
const MAX_PAGES = 20;

/** Device of the official list */
export interface UnifiDevice {
    /** ID of the API (uuid), also the object ID */
    id: string;
    /** Name in the UniFi application */
    name: string;
    /** Model */
    model: string;
    /** MAC address, only to join the classic list */
    mac: string;
    /** IP address */
    ip: string;
    /** ONLINE, OFFLINE, UPDATING, ... */
    state: string;
    /** Installed firmware */
    firmware: string;
    /** An update is available */
    updatable: boolean;
    /** Features, e.g. switching, accessPoint */
    features: string[];
}

/** Details of a device that the list does not have */
export interface DeviceDetails {
    /** ID of the device it is connected to; undefined for the console */
    uplinkDeviceId: string | undefined;
}

/** Latest statistics of a device */
export interface DeviceStatistics {
    /** Uptime in seconds */
    uptimeSec: number | undefined;
    /** CPU load in percent */
    cpuPct: number | undefined;
    /** Memory use in percent */
    memoryPct: number | undefined;
}

/** Uplink as the classic list reports it */
export interface ClassicUplink {
    /** wired or wireless (mesh) */
    type: 'wired' | 'wireless' | undefined;
    /** Link speed in Mbit/s (cable), transmit rate in Mbit/s (mesh) */
    speedMbps: number | undefined;
    /** Highest possible speed of the link in Mbit/s (cable only) */
    maxSpeedMbps: number | undefined;
    /** Signal in dBm (mesh only) */
    signalDbm: number | undefined;
    /** MAC of the parent device: the current one, otherwise the last known one (also for offline devices) */
    parentMac: string;
}

/** Site of the console */
export interface UnifiSite {
    /** ID for the Integration API */
    id: string;
    /** Short name for the classic API, usually "default" */
    reference: string;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const num = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const record = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/**
 * Entries of a list answer ({ data: [...] } or a plain array).
 *
 * @param body - Parsed answer
 */
export function listOf(body: unknown): unknown[] {
    if (Array.isArray(body)) {
        return body;
    }
    const data = record(body).data;
    return Array.isArray(data) ? data : [];
}

/**
 * One device of the official list; undefined if it has no usable ID.
 *
 * @param entry - Entry of the answer
 */
export function parseDevice(entry: unknown): UnifiDevice | undefined {
    const item = record(entry);
    const id = text(item.id);
    // object IDs come from the API id: letters, digits and hyphens only
    if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) {
        return undefined;
    }
    return {
        id,
        name: text(item.name).slice(0, 100),
        model: text(item.model).slice(0, 60),
        mac: text(item.macAddress).toLowerCase(),
        ip: text(item.ipAddress).slice(0, 45),
        state: text(item.state).toUpperCase() || 'UNKNOWN',
        firmware: text(item.firmwareVersion).slice(0, 40),
        updatable: item.firmwareUpdatable === true,
        features: Array.isArray(item.features) ? item.features.filter((f): f is string => typeof f === 'string') : [],
    };
}

/**
 * Uplink of one entry of the classic device list (UNOFFICIAL).
 *
 * @param entry - Entry of stat/device
 */
export function parseClassicUplink(entry: unknown): ClassicUplink {
    const uplink = record(record(entry).uplink);
    const last = record(record(entry).last_uplink);
    const parentMac = (text(uplink.uplink_mac) || text(last.uplink_mac)).toLowerCase();
    const type = uplink.type === 'wire' ? 'wired' : uplink.type === 'wireless' ? 'wireless' : undefined;
    if (type === 'wireless') {
        // tx_rate is reported in kbit/s
        const rate = num(uplink.tx_rate);
        return {
            type,
            speedMbps: rate === undefined ? undefined : Math.round(rate / 1000),
            maxSpeedMbps: undefined,
            signalDbm: num(uplink.signal),
            parentMac,
        };
    }
    return {
        type,
        speedMbps: num(uplink.speed),
        maxSpeedMbps: num(uplink.max_speed),
        signalDbm: undefined,
        parentMac,
    };
}

/** Read access to one console */
export class UnifiClient {
    /**
     * @param http - HTTPS layer
     */
    public constructor(private readonly http: UnifiHttp) {}

    /** Version of the Network application */
    public async networkVersion(): Promise<string> {
        return text(record(await this.http.get(`${INTEGRATION_PATH}/info`, 'info')).applicationVersion);
    }

    /** First site of the console (home networks have one) */
    public async site(): Promise<UnifiSite> {
        const first = record(listOf(await this.http.get(`${INTEGRATION_PATH}/sites`, 'sites'))[0]);
        const id = text(first.id);
        if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) {
            throw new ApiError('sites: no site in the answer - check the role of the key', 0);
        }
        const reference = text(first.internalReference);
        return { id, reference: /^[A-Za-z0-9_-]{1,64}$/.test(reference) ? reference : 'default' };
    }

    /**
     * All adopted devices.
     *
     * @param site - Site
     */
    public async devices(site: UnifiSite): Promise<UnifiDevice[]> {
        const devices: UnifiDevice[] = [];
        for (let page = 0; page < MAX_PAGES; page++) {
            const body = await this.http.get(
                `${INTEGRATION_PATH}/sites/${site.id}/devices?offset=${page * PAGE_SIZE}&limit=${PAGE_SIZE}`,
                'devices',
            );
            const entries = listOf(body);
            devices.push(...entries.map(parseDevice).filter((d): d is UnifiDevice => d !== undefined));
            const total = num(record(body).totalCount);
            if (entries.length < PAGE_SIZE || (total !== undefined && devices.length >= total)) {
                break;
            }
        }
        return devices;
    }

    /**
     * Details of one device.
     *
     * @param site - Site
     * @param deviceId - Device
     */
    public async details(site: UnifiSite, deviceId: string): Promise<DeviceDetails> {
        const body = record(await this.http.get(`${INTEGRATION_PATH}/sites/${site.id}/devices/${deviceId}`, 'details'));
        const uplink = text(record(body.uplink).deviceId);
        return { uplinkDeviceId: uplink || undefined };
    }

    /**
     * Latest statistics of one device.
     *
     * @param site - Site
     * @param deviceId - Device
     */
    public async statistics(site: UnifiSite, deviceId: string): Promise<DeviceStatistics> {
        const body = record(
            await this.http.get(
                `${INTEGRATION_PATH}/sites/${site.id}/devices/${deviceId}/statistics/latest`,
                'statistics',
            ),
        );
        return {
            uptimeSec: num(body.uptimeSec),
            cpuPct: num(body.cpuUtilizationPct),
            memoryPct: num(body.memoryUtilizationPct),
        };
    }

    /**
     * Number of clients per device they are connected to. Names and addresses of clients are not kept.
     *
     * @param site - Site
     */
    public async clientCounts(site: UnifiSite): Promise<Map<string, number>> {
        const counts = new Map<string, number>();
        for (let page = 0; page < MAX_PAGES; page++) {
            const body = await this.http.get(
                `${INTEGRATION_PATH}/sites/${site.id}/clients?offset=${page * PAGE_SIZE}&limit=${PAGE_SIZE}`,
                'clients',
            );
            const entries = listOf(body);
            for (const entry of entries) {
                const parent = text(record(entry).uplinkDeviceId);
                if (parent) {
                    counts.set(parent, (counts.get(parent) ?? 0) + 1);
                }
            }
            if (entries.length < PAGE_SIZE) {
                break;
            }
        }
        return counts;
    }

    /**
     * UNOFFICIAL: uplink type and speed per MAC address from the classic device list.
     *
     * @param site - Site
     */
    public async classicUplinks(site: UnifiSite): Promise<Map<string, ClassicUplink>> {
        const uplinks = new Map<string, ClassicUplink>();
        for (const entry of listOf(
            await this.http.get(`${CLASSIC_PATH}/${site.reference}/stat/device`, 'classic devices'),
        )) {
            const mac = text(record(entry).mac).toLowerCase();
            if (mac) {
                uplinks.set(mac, parseClassicUplink(entry));
            }
        }
        return uplinks;
    }
}
