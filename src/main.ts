/*
 * ioBroker adapter for UniFi networks: device status, restarts and slow uplinks (phase 2).
 * Topology map and firmware updates follow in later phases.
 */

import * as utils from '@iobroker/adapter-core';
import { fetchCertificate, parseCertificate } from './lib/api/certificate';
import type { ClassicUplink, DeviceDetails, DeviceStatistics, UnifiDevice, UnifiSite } from './lib/api/client';
import { UnifiClient } from './lib/api/client';
import {
    AbortedError,
    CertificateChangedError,
    KeyRejectedError,
    RateLimitedError,
    describeError,
} from './lib/api/errors';
import { UnifiHttp } from './lib/api/http';
import { RestartTracker } from './lib/model/restarts';
import { deviceStatus, isStale, summarize, type DeviceStatus } from './lib/model/status';
import {
    buildTopology,
    rememberUplinks,
    uplinksFromStored,
    type Topology,
    type TopologyNode,
} from './lib/model/topology';
import { ObjectTree } from './lib/model/tree';
import {
    DETAIL_DEFAULT_S,
    DETAIL_MAX_S,
    DETAIL_MIN_S,
    POLL_DEFAULT_S,
    POLL_MAX_S,
    POLL_MIN_S,
    apiKey,
    clamp,
    consoleHost,
    consolePort,
    delayMs,
} from './lib/util/config';

/** First retry after an error, doubled up to RETRY_MAX_S (audit B.11.4) */
const RETRY_START_S = 30;
const RETRY_MAX_S = 1800;
/** Requests at the same time when reading details */
const PARALLEL_REQUESTS = 4;
/** Shortest time between two manual refreshes */
const REFRESH_MIN_MS = 10_000;
/** Internal state with the start times of the devices */
const RESTART_STATE = 'info.restarts';

/**
 * Runs a function for all items, at most `limit` at the same time.
 *
 * @param items - Items
 * @param limit - Parallel calls
 * @param run - Function per item
 */
async function forEachLimited<T>(items: T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const item = items[next++];
            await run(item);
        }
    });
    await Promise.all(workers);
}

class UnifiMap extends utils.Adapter {
    private readonly abort = new AbortController();
    private client: UnifiClient | undefined;
    private site: UnifiSite | undefined;
    private tree: ObjectTree | undefined;
    private restarts: RestartTracker | undefined;
    private timer: ioBroker.Timeout | undefined;
    private pollSeconds = POLL_DEFAULT_S;
    private detailSeconds = DETAIL_DEFAULT_S;
    private retrySeconds = RETRY_START_S;
    private running = false;
    private failing = false;
    private lastUpdate = 0;
    private lastDetails = 0;
    private lastRefresh = 0;
    private readonly details = new Map<string, DeviceDetails>();
    private readonly statistics = new Map<string, DeviceStatistics>();
    private uplinks = new Map<string, ClassicUplink>();
    private clients = new Map<string, number>();
    private previous = new Map<string, DeviceStatus>();
    private previousNodes = new Map<string, TopologyNode>();
    private lastUplinks = new Map<string, string>();
    private classicFailing = false;

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({ ...options, name: 'unifi-map' });
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    private async onReady(): Promise<void> {
        await this.setState('info.connection', false, true);
        this.pollSeconds = clamp(this.config.pollInterval, POLL_DEFAULT_S, POLL_MIN_S, POLL_MAX_S);
        this.detailSeconds = Math.max(
            clamp(this.config.detailInterval, DETAIL_DEFAULT_S, DETAIL_MIN_S, DETAIL_MAX_S),
            this.pollSeconds,
        );

        const host = consoleHost(this.config.host);
        const key = apiKey(this.config.apiKey);
        const certificate = parseCertificate(this.config.certificate);
        const shown = typeof this.config.certFingerprint === 'string' ? this.config.certFingerprint.trim() : '';
        let certificateProblem = '';
        if (!certificate) {
            certificateProblem = this.config.certificate
                ? 'the stored certificate cannot be read - fetch it again'
                : 'confirmed certificate missing - fetch it';
        } else if (shown && shown !== certificate.fingerprint) {
            // the user confirmed what the form showed: both must belong together
            certificateProblem =
                'the fingerprint in the settings does not match the stored certificate - fetch it again';
        }
        if (!host || !key || !certificate || certificateProblem) {
            const problems = [!host && 'address missing', !key && 'API key missing', certificateProblem]
                .filter(Boolean)
                .join(', ');
            this.log.warn(`Not configured: ${problems}. Fill in the instance settings and save.`);
            return;
        }

        const http = new UnifiHttp({
            host,
            port: consolePort(this.config.port),
            apiKey: key,
            certificatePem: certificate.pem,
            fingerprint: certificate.fingerprint,
            signal: this.abort.signal,
            trace: line => this.log.debug(line),
        });
        this.client = new UnifiClient(http);
        this.tree = new ObjectTree({
            writeObject: (id, object) => this.extendObject(id, object),
            writeState: (id, value) => this.setState(id, value, true),
        });
        this.restarts = new RestartTracker((await this.getStateAsync(RESTART_STATE))?.val);
        // after a restart of the adapter the summary still shows the old values: they must turn grey in time
        this.lastUpdate = Number((await this.getStateAsync('info.lastUpdate'))?.val) || 0;
        // last known uplinks survive a restart of the adapter: a device that is offline now keeps its place
        this.lastUplinks = uplinksFromStored((await this.getStateAsync('topology.json'))?.val);
        await this.subscribeStatesAsync('refresh');
        this.schedule(Math.floor(Math.random() * 5_000), () => this.poll(true));
    }

    /**
     * The only timer chain: polls never overlap (audit B.11.2).
     *
     * @param ms - Delay
     * @param task - Task
     */
    private schedule(ms: number, task: () => Promise<void>): void {
        this.clearTimeout(this.timer);
        if (this.abort.signal.aborted) {
            return;
        }
        this.timer = this.setTimeout(() => {
            this.timer = undefined;
            task().catch(err => {
                if (!this.abort.signal.aborted) {
                    this.log.error(`Unexpected error: ${describeError(err)}`);
                }
            });
        }, ms);
    }

    /**
     * One poll: the device list always, the rest when due or when a state changed.
     *
     * @param forceDetails - Read details now
     */
    private async poll(forceDetails = false): Promise<void> {
        if (this.running || !this.client) {
            return;
        }
        this.running = true;
        try {
            const client = this.client;
            if (!this.site) {
                const version = await client.networkVersion();
                this.site = await client.site();
                await this.setState('info.networkVersion', version, true);
                this.log.info(`Connected to UniFi Network ${version || '(version unknown)'}`);
            }
            const site = this.site;
            const devices = await client.devices(site);
            const changed = devices.some(d => this.previous.get(d.id)?.state !== d.state);
            const now = Date.now();
            if (forceDetails || changed || now - this.lastDetails >= this.detailSeconds * 1000) {
                await this.readDetails(site, devices);
                this.lastDetails = Date.now();
            }
            await this.publish(devices);
            this.retrySeconds = RETRY_START_S;
            if (this.failing) {
                this.failing = false;
                this.log.info('Console reachable again');
            }
            await this.setState('info.connection', true, true);
            this.schedule(delayMs(this.pollSeconds), () => this.poll());
        } catch (err) {
            await this.handleFailure(err);
        } finally {
            this.running = false;
        }
    }

    /**
     * Details and statistics per device, clients and (unofficial) uplinks. A failing part keeps its last values.
     *
     * @param site - Site
     * @param devices - Devices of this poll
     */
    private async readDetails(site: UnifiSite, devices: UnifiDevice[]): Promise<void> {
        const client = this.client!;
        await forEachLimited(devices, PARALLEL_REQUESTS, async device => {
            this.details.set(device.id, await client.details(site, device.id));
            if (device.state === 'ONLINE') {
                this.statistics.set(device.id, await client.statistics(site, device.id));
            }
        });
        this.clients = await client.clientCounts(site);
        try {
            this.uplinks = await client.classicUplinks(site);
            if (this.classicFailing) {
                this.classicFailing = false;
                this.log.info('Uplink type and speed can be read again');
            }
        } catch (err) {
            if (err instanceof AbortedError || err instanceof RateLimitedError) {
                throw err;
            }
            // unofficial path: the rest keeps working without it (audit B.11.18)
            const message = `Uplink type and speed not read (unofficial API): ${describeError(err)}`;
            if (this.classicFailing) {
                this.log.debug(message);
            } else {
                this.classicFailing = true;
                this.log.warn(message);
            }
        }
    }

    /**
     * Writes devices, summary and events.
     *
     * @param devices - Devices of this poll
     */
    private async publish(devices: UnifiDevice[]): Promise<void> {
        const tree = this.tree!;
        const restarts = this.restarts!;
        const now = Date.now();
        const idByMac = new Map(devices.map(d => [d.mac, d.id]));
        const statuses = devices.map(device => {
            const uplink = this.uplinks.get(device.mac);
            return deviceStatus({
                device,
                details: this.details.get(device.id),
                statistics: this.statistics.get(device.id),
                uplink,
                clients: this.clients.get(device.id) ?? 0,
                classicParentId: uplink?.parentMac ? idByMac.get(uplink.parentMac) : undefined,
                classicLastParentId: uplink?.lastParentMac ? idByMac.get(uplink.lastParentMac) : undefined,
            });
        });
        const topology = buildTopology(statuses, this.lastUplinks);
        const nodes = new Map(topology.nodes.map(n => [n.id, n]));
        for (const status of statuses) {
            const node = nodes.get(status.id)!;
            const info = restarts.check(status.id, status.uptimeSec, now);
            await tree.writeDevice(status, info, node);
            await this.reportEvents(status, node, topology, info.restarted, now);
        }
        await this.setState(RESTART_STATE, restarts.serialize(), true);
        await tree.writeTopology(topology);
        this.lastUplinks = rememberUplinks(statuses, this.lastUplinks);
        this.previous = new Map(statuses.map(s => [s.id, s]));
        this.previousNodes = nodes;
        this.lastUpdate = now;
        await this.setState('info.lastUpdate', now, true);
        await this.setState('info.dataStale', false, true);
        // problems first (causes before their consequences), so the widget shows what matters
        const rank: Record<string, number> = { offline: 0, consequence: 1, degraded: 2, busy: 3, ok: 4 };
        const list = [...statuses]
            .map(s => ({ s, node: nodes.get(s.id)! }))
            .sort((a, b) => rank[a.node.state] - rank[b.node.state] || a.s.name.localeCompare(b.s.name))
            .map(({ s, node }) => ({
                id: s.id,
                name: s.name,
                model: s.model,
                role: s.role,
                state: node.state,
                causeId: node.causeId,
                uplinkId: node.uplinkId,
                uplinkType: s.uplinkType,
                linkSpeed: s.linkSpeed ?? null,
                linkMaxSpeed: s.linkMaxSpeed ?? null,
                uptime: s.uptimeSec ?? null,
                firmware: s.firmware,
                updatable: s.updatable,
                clients: s.clients ?? null,
            }));
        await tree.writeSummary(summarize(statuses, false), list);
    }

    /**
     * Writes events.last. A failure is reported only for its cause, with the number of devices cut off behind it;
     * devices that are only a consequence get no event of their own. A device that found another way to the
     * console (e.g. a mesh access point) reports uplinkChanged.
     *
     * @param status - Current status
     * @param node - Node of the topology
     * @param topology - Whole topology
     * @param restarted - A restart was found
     * @param now - Time
     */
    private async reportEvents(
        status: DeviceStatus,
        node: TopologyNode,
        topology: Topology,
        restarted: boolean,
        now: number,
    ): Promise<void> {
        const before = this.previous.get(status.id);
        const beforeNode = this.previousNodes.get(status.id);
        const events: { event: string; extra?: Record<string, unknown> }[] = [];
        if (before && !before.failed && status.failed && node.state === 'offline') {
            const affected = topology.nodes.filter(n => n.causeId === status.id).length;
            events.push({ event: 'offline', extra: { affected } });
        }
        if (before?.failed && !status.failed && beforeNode?.state !== 'consequence') {
            events.push({ event: 'online' });
        }
        if (restarted) {
            events.push({ event: 'restart' });
        }
        if (before?.uplinkId && status.uplinkId && before.uplinkId !== status.uplinkId && status.online) {
            events.push({ event: 'uplinkChanged', extra: { from: before.uplinkId, to: status.uplinkId } });
        }
        if (before && !before.degraded && status.degraded) {
            events.push({ event: 'degraded' });
        }
        if (before?.degraded && !status.degraded && !status.failed) {
            events.push({ event: 'recovered' });
        }
        for (const { event, extra } of events) {
            // names only on debug (audit B.10.18)
            this.log.debug(`Device ${status.id} (${status.model}): ${event}`);
            const value = { time: now, event, id: status.id, name: status.name, model: status.model, ...extra };
            await this.setState('events.last', JSON.stringify(value), true);
        }
    }

    /**
     * Error handling without loops (audit B.11.5): a rejected key or a changed certificate waits long,
     * other errors retry with backoff. After STALE_INTERVALS intervals without data the summary turns grey.
     *
     * @param err - Caught error
     */
    private async handleFailure(err: unknown): Promise<void> {
        if (err instanceof AbortedError || this.abort.signal.aborted) {
            this.log.debug(`Stopped while busy: ${describeError(err)}`);
            return;
        }
        await this.setState('info.connection', false, true);
        // errors that last (key, certificate, rate limit) wait long: the data is stale at once
        const lasting =
            err instanceof KeyRejectedError ||
            err instanceof CertificateChangedError ||
            err instanceof RateLimitedError;
        await this.markStale(lasting);
        let waitS: number;
        if (err instanceof KeyRejectedError || err instanceof CertificateChangedError) {
            this.log.error(`${err.message}. Next attempt in ${RETRY_MAX_S / 60} min.`);
            waitS = RETRY_MAX_S;
        } else if (err instanceof RateLimitedError) {
            this.log.warn(err.message);
            waitS = Math.ceil(err.retryAfterMs / 1000);
        } else {
            const message = `Console not reachable: ${describeError(err)}. Next attempt in ${this.retrySeconds} s`;
            if (this.failing) {
                this.log.debug(message);
            } else {
                this.log.warn(message);
            }
            waitS = this.retrySeconds;
            this.retrySeconds = Math.min(this.retrySeconds * 2, RETRY_MAX_S);
        }
        this.failing = true;
        // the site is read again, in case the console was replaced or reset
        this.site = undefined;
        this.schedule(waitS * 1000, () => this.poll(true));
    }

    /**
     * The tile never shows green from old values.
     *
     * @param now - Stale at once, without waiting for STALE_INTERVALS intervals
     */
    private async markStale(now = false): Promise<void> {
        if (!this.tree || (!now && !isStale(this.lastUpdate, this.pollSeconds * 1000))) {
            return;
        }
        await this.setState('info.dataStale', true, true);
        // summary.state exists once any poll has succeeded, also in an earlier run of the adapter
        if (this.lastUpdate > 0) {
            await this.tree.setValue('summary.state', 'stale');
        }
    }

    /**
     * Manual refresh, at most every 10 s.
     *
     * @param id - State ID
     * @param state - State
     */
    private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
        if (!state || state.ack || id !== `${this.namespace}.refresh`) {
            return;
        }
        const now = Date.now();
        if (now - this.lastRefresh < REFRESH_MIN_MS || this.running || !this.client) {
            this.log.debug('Refresh ignored (running or too soon)');
            return;
        }
        this.lastRefresh = now;
        this.schedule(0, () => this.poll(true));
    }

    /**
     * sendTo from the instance settings: fetchCertificate reads the certificate of the console so the user can
     * confirm its fingerprint. Nothing but the TLS handshake happens, the key is not sent.
     *
     * @param obj - Message
     */
    private async onMessage(obj: ioBroker.Message): Promise<void> {
        if (obj?.command !== 'fetchCertificate' || !obj.callback) {
            return;
        }
        const message = obj.message as { host?: unknown; port?: unknown } | undefined;
        const host = consoleHost(message?.host);
        let answer: Record<string, unknown>;
        if (!host) {
            answer = { error: 'Enter the address of the console first' };
        } else {
            try {
                const cert = await fetchCertificate(host, consolePort(message?.port));
                answer = {
                    native: { certificate: cert.pem, certFingerprint: cert.fingerprint },
                    result: `SHA-256 ${cert.fingerprint}`,
                };
                this.log.info('Certificate of the console fetched - compare the fingerprint and save to confirm it');
            } catch (err) {
                answer = { error: `Certificate not fetched: ${describeError(err)}` };
                this.log.warn(`Certificate of the console not fetched: ${describeError(err)}`);
            }
        }
        this.sendTo(obj.from, obj.command, answer, obj.callback);
    }

    /**
     * Shuts down: no new timers or requests (audit B.4.16).
     *
     * @param callback - Must be called in any case
     */
    private onUnload(callback: () => void): void {
        try {
            this.abort.abort();
            this.clearTimeout(this.timer);
            this.timer = undefined;
            this.setState('info.connection', false, true).catch(err =>
                this.log.debug(`info.connection not reset: ${describeError(err)}`),
            );
        } finally {
            callback();
        }
    }
}

if (require.main !== module) {
    // compact mode
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new UnifiMap(options);
} else {
    (() => new UnifiMap())();
}
