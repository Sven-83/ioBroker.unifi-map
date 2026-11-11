// @ts-nocheck -- plain JS test helper
'use strict';

// A fake UniFi console for the tests: HTTPS with a self-signed certificate, Integration API and the classic
// device list, shaped like real answers. All names, IDs and addresses are invented.

const https = require('node:https');
const { X509Certificate } = require('node:crypto');
const { selfSigned } = require('./selfsigned');

const API_KEY = 'test-key-0123456789';
const SITE_ID = '00000000-0000-4000-8000-000000000001';

const id = n => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`;
// invented, locally administered addresses; built at run time so no address literal is in the sources
const mac = n => ['02', '00', '00', '00', '00', String(n).padStart(2, '0')].join(':');

/** Invented network: console, two switches, an AP on cable, a mesh AP with a switch behind it (100 Mbit) */
function defaultDevices() {
    return [
        { n: 1, name: 'Console', model: 'UDR', features: ['switching', 'accessPoint'], parent: 0, uplink: { type: 'wire', speed: 1000, max_speed: 1000 } },
        { n: 2, name: 'Switch A', model: 'USW-Lite-8-PoE', features: ['switching'], parent: 1, uplink: { type: 'wire', speed: 1000, max_speed: 1000 } },
        { n: 3, name: 'AP Cable', model: 'U6 LR', features: ['accessPoint'], parent: 2, uplink: { type: 'wire', speed: 1000, max_speed: 1000 } },
        { n: 4, name: 'AP Mesh', model: 'U7 Lite', features: ['accessPoint'], parent: 1, uplink: { type: 'wireless', tx_rate: 344100, signal: -62 } },
        { n: 5, name: 'Switch Slow', model: 'USW-Lite-8-PoE', features: ['switching'], parent: 4, uplink: { type: 'wire', speed: 100, max_speed: 1000 } },
    ].map(d => ({ ...d, id: id(d.n), mac: mac(d.n), ip: `192.0.2.${d.n}`, state: 'ONLINE', firmware: '1.0.0', updatable: false, uptimeSec: 100_000 + d.n }));
}

function send(res, status, body, headers = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

/**
 * @param {object} [options]
 * @param {string} [options.commonName]
 */
async function startFakeConsole(options = {}) {
    const tls = selfSigned(options.commonName);
    const config = {
        devices: defaultDevices(),
        classicStatus: 200,
        rateLimit: false,
        version: '10.6.109',
        clientsPerDevice: { 1: 2, 3: 5, 4: 1 },
    };
    const stats = { requests: 0, keys: new Set(), paths: [] };

    const server = https.createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
        stats.requests++;
        stats.keys.add(req.headers['x-api-key']);
        const url = new URL(req.url, 'https://console');
        stats.paths.push(url.pathname);
        if (req.method !== 'GET') return send(res, 405, { error: 'read only' });
        if (req.headers['x-api-key'] !== API_KEY) return send(res, 401, { statusCode: 401, statusName: 'UNAUTHORIZED' });
        if (config.rateLimit) return send(res, 429, { error: 'slow down' }, { 'Retry-After': '120' });

        const base = '/proxy/network/integration/v1';
        const p = url.pathname;
        if (p === `${base}/info`) return send(res, 200, { applicationVersion: config.version });
        if (p === `${base}/sites`) {
            return send(res, 200, { offset: 0, limit: 25, count: 1, totalCount: 1, data: [{ id: SITE_ID, internalReference: 'default', name: 'Default' }] });
        }
        if (p === `${base}/sites/${SITE_ID}/devices`) {
            const data = config.devices.map(d => ({
                id: d.id,
                macAddress: d.mac,
                ipAddress: d.ip,
                name: d.name,
                model: d.model,
                state: d.state,
                supported: true,
                firmwareVersion: d.firmware,
                firmwareUpdatable: d.updatable,
                features: d.features,
                interfaces: [],
            }));
            return send(res, 200, { offset: 0, limit: 200, count: data.length, totalCount: data.length, data });
        }
        const detail = p.match(new RegExp(`^${base}/sites/${SITE_ID}/devices/([0-9a-f-]+)(/statistics/latest)?$`));
        if (detail) {
            const d = config.devices.find(x => x.id === detail[1]);
            if (!d) return send(res, 404, { statusCode: 404 });
            if (detail[2]) {
                return send(res, 200, { uptimeSec: d.uptimeSec, lastHeartbeatAt: new Date().toISOString(), cpuUtilizationPct: 3.5, memoryUtilizationPct: 40, uplink: {}, interfaces: {} });
            }
            const parent = config.devices.find(x => x.n === d.parent);
            // like a real console: a device that is not online reports no uplink
            const reportsUplink = parent && d.state === 'ONLINE';
            return send(res, 200, { id: d.id, name: d.name, model: d.model, state: d.state, ...(reportsUplink ? { uplink: { deviceId: parent.id } } : {}) });
        }
        if (p === `${base}/sites/${SITE_ID}/clients`) {
            const data = [];
            for (const [n, count] of Object.entries(config.clientsPerDevice)) {
                for (let i = 0; i < count; i++) data.push({ type: 'WIRELESS', id: `client-${n}-${i}`, name: `Client ${i}`, macAddress: mac(99), uplinkDeviceId: id(Number(n)) });
            }
            return send(res, 200, { offset: 0, limit: 200, count: data.length, totalCount: data.length, data });
        }
        if (p === '/proxy/network/api/s/default/stat/device') {
            if (config.classicStatus !== 200) return send(res, config.classicStatus, { meta: { rc: 'error' } });
            return send(res, 200, { meta: { rc: 'ok' }, data: config.devices.map(d => {
                const parent = config.devices.find(x => x.n === d.parent);
                const online = d.state === 'ONLINE';
                return {
                    mac: d.mac,
                    model: d.model,
                    uptime: d.uptimeSec,
                    // the console has no parent device; offline devices keep only their last uplink
                    uplink: online ? { ...d.uplink, ...(parent ? { uplink_mac: parent.mac } : {}) } : {},
                    ...(parent ? { last_uplink: { uplink_mac: parent.mac } } : {}),
                };
            }) });
        }
        send(res, 404, { statusCode: 404 });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return {
        host: '127.0.0.1',
        port: server.address().port,
        apiKey: API_KEY,
        certificate: tls.cert,
        fingerprint: new X509Certificate(tls.cert).fingerprint256,
        config,
        stats,
        id,
        close: () =>
            new Promise(resolve => {
                server.closeAllConnections();
                server.close(() => resolve());
            }),
    };
}

module.exports = { startFakeConsole, API_KEY, SITE_ID, mac };
