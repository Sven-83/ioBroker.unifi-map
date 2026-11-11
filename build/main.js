"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var utils = __toESM(require("@iobroker/adapter-core"));
var import_certificate = require("./lib/api/certificate");
var import_client = require("./lib/api/client");
var import_errors = require("./lib/api/errors");
var import_http = require("./lib/api/http");
var import_restarts = require("./lib/model/restarts");
var import_status = require("./lib/model/status");
var import_tree = require("./lib/model/tree");
var import_config = require("./lib/util/config");
const RETRY_START_S = 30;
const RETRY_MAX_S = 1800;
const PARALLEL_REQUESTS = 4;
const REFRESH_MIN_MS = 1e4;
const RESTART_STATE = "info.restarts";
async function forEachLimited(items, limit, run) {
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
  abort = new AbortController();
  client;
  site;
  tree;
  restarts;
  timer;
  pollSeconds = import_config.POLL_DEFAULT_S;
  detailSeconds = import_config.DETAIL_DEFAULT_S;
  retrySeconds = RETRY_START_S;
  running = false;
  failing = false;
  lastUpdate = 0;
  lastDetails = 0;
  lastRefresh = 0;
  details = /* @__PURE__ */ new Map();
  statistics = /* @__PURE__ */ new Map();
  uplinks = /* @__PURE__ */ new Map();
  clients = /* @__PURE__ */ new Map();
  previous = /* @__PURE__ */ new Map();
  classicFailing = false;
  constructor(options = {}) {
    super({ ...options, name: "unifi-map" });
    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("message", this.onMessage.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }
  async onReady() {
    var _a, _b;
    await this.setState("info.connection", false, true);
    this.pollSeconds = (0, import_config.clamp)(this.config.pollInterval, import_config.POLL_DEFAULT_S, import_config.POLL_MIN_S, import_config.POLL_MAX_S);
    this.detailSeconds = Math.max(
      (0, import_config.clamp)(this.config.detailInterval, import_config.DETAIL_DEFAULT_S, import_config.DETAIL_MIN_S, import_config.DETAIL_MAX_S),
      this.pollSeconds
    );
    const host = (0, import_config.consoleHost)(this.config.host);
    const key = (0, import_config.apiKey)(this.config.apiKey);
    const certificate = (0, import_certificate.parseCertificate)(this.config.certificate);
    if (!host || !key || !certificate) {
      const missing = [!host && "address", !key && "API key", !certificate && "confirmed certificate"].filter(Boolean).join(", ");
      this.log.warn(`Not configured: ${missing} missing. Fill in the instance settings.`);
      return;
    }
    const http = new import_http.UnifiHttp({
      host,
      port: (0, import_config.consolePort)(this.config.port),
      apiKey: key,
      certificatePem: certificate.pem,
      fingerprint: certificate.fingerprint,
      signal: this.abort.signal,
      trace: (line) => this.log.debug(line)
    });
    this.client = new import_client.UnifiClient(http);
    this.tree = new import_tree.ObjectTree({
      writeObject: (id, object) => this.extendObject(id, object),
      writeState: (id, value) => this.setState(id, value, true)
    });
    this.restarts = new import_restarts.RestartTracker((_a = await this.getStateAsync(RESTART_STATE)) == null ? void 0 : _a.val);
    this.lastUpdate = Number((_b = await this.getStateAsync("info.lastUpdate")) == null ? void 0 : _b.val) || 0;
    await this.subscribeStatesAsync("refresh");
    this.schedule(Math.floor(Math.random() * 5e3), () => this.poll(true));
  }
  /**
   * The only timer chain: polls never overlap (audit B.11.2).
   *
   * @param ms - Delay
   * @param task - Task
   */
  schedule(ms, task) {
    this.clearTimeout(this.timer);
    if (this.abort.signal.aborted) {
      return;
    }
    this.timer = this.setTimeout(() => {
      this.timer = void 0;
      task().catch((err) => {
        if (!this.abort.signal.aborted) {
          this.log.error(`Unexpected error: ${(0, import_errors.describeError)(err)}`);
        }
      });
    }, ms);
  }
  /**
   * One poll: the device list always, the rest when due or when a state changed.
   *
   * @param forceDetails - Read details now
   */
  async poll(forceDetails = false) {
    if (this.running || !this.client) {
      return;
    }
    this.running = true;
    try {
      const client = this.client;
      if (!this.site) {
        const version = await client.networkVersion();
        this.site = await client.site();
        await this.setState("info.networkVersion", version, true);
        this.log.info(`Connected to UniFi Network ${version || "(version unknown)"}`);
      }
      const site = this.site;
      const devices = await client.devices(site);
      const changed = devices.some((d) => {
        var _a;
        return ((_a = this.previous.get(d.id)) == null ? void 0 : _a.state) !== d.state;
      });
      const now = Date.now();
      if (forceDetails || changed || now - this.lastDetails >= this.detailSeconds * 1e3) {
        await this.readDetails(site, devices);
        this.lastDetails = Date.now();
      }
      await this.publish(devices);
      this.retrySeconds = RETRY_START_S;
      if (this.failing) {
        this.failing = false;
        this.log.info("Console reachable again");
      }
      await this.setState("info.connection", true, true);
      this.schedule((0, import_config.delayMs)(this.pollSeconds), () => this.poll());
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
  async readDetails(site, devices) {
    const client = this.client;
    await forEachLimited(devices, PARALLEL_REQUESTS, async (device) => {
      this.details.set(device.id, await client.details(site, device.id));
      if (device.state === "ONLINE") {
        this.statistics.set(device.id, await client.statistics(site, device.id));
      }
    });
    this.clients = await client.clientCounts(site);
    try {
      this.uplinks = await client.classicUplinks(site);
      if (this.classicFailing) {
        this.classicFailing = false;
        this.log.info("Uplink type and speed can be read again");
      }
    } catch (err) {
      if (err instanceof import_errors.AbortedError || err instanceof import_errors.RateLimitedError) {
        throw err;
      }
      const message = `Uplink type and speed not read (unofficial API): ${(0, import_errors.describeError)(err)}`;
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
  async publish(devices) {
    const tree = this.tree;
    const restarts = this.restarts;
    const now = Date.now();
    const statuses = devices.map(
      (device) => {
        var _a;
        return (0, import_status.deviceStatus)({
          device,
          details: this.details.get(device.id),
          statistics: this.statistics.get(device.id),
          uplink: this.uplinks.get(device.mac),
          clients: (_a = this.clients.get(device.id)) != null ? _a : 0
        });
      }
    );
    for (const status of statuses) {
      const info = restarts.check(status.id, status.uptimeSec, now);
      await tree.writeDevice(status, info);
      await this.reportEvents(status, info.restarted, now);
    }
    await this.setState(RESTART_STATE, restarts.serialize(), true);
    this.previous = new Map(statuses.map((s) => [s.id, s]));
    this.lastUpdate = now;
    await this.setState("info.lastUpdate", now, true);
    await this.setState("info.dataStale", false, true);
    const order = (s) => s.failed ? 0 : s.degraded ? 1 : 2;
    const list = [...statuses].sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name)).map((s) => {
      var _a, _b, _c, _d;
      return {
        id: s.id,
        name: s.name,
        model: s.model,
        role: s.role,
        state: s.failed ? "offline" : s.degraded ? "degraded" : s.online ? "ok" : "busy",
        uplinkType: s.uplinkType,
        linkSpeed: (_a = s.linkSpeed) != null ? _a : null,
        linkMaxSpeed: (_b = s.linkMaxSpeed) != null ? _b : null,
        uptime: (_c = s.uptimeSec) != null ? _c : null,
        firmware: s.firmware,
        updatable: s.updatable,
        clients: (_d = s.clients) != null ? _d : null
      };
    });
    await tree.writeSummary((0, import_status.summarize)(statuses, false), list);
  }
  /**
   * Writes events.last when a device fails, comes back, restarts or gets a slow uplink.
   *
   * @param status - Current status
   * @param restarted - A restart was found
   * @param now - Time
   */
  async reportEvents(status, restarted, now) {
    const before = this.previous.get(status.id);
    const events = [];
    if (before && !before.failed && status.failed) {
      events.push("offline");
    }
    if ((before == null ? void 0 : before.failed) && !status.failed) {
      events.push("online");
    }
    if (restarted) {
      events.push("restart");
    }
    if (before && !before.degraded && status.degraded) {
      events.push("degraded");
    }
    if ((before == null ? void 0 : before.degraded) && !status.degraded && !status.failed) {
      events.push("recovered");
    }
    for (const event of events) {
      this.log.debug(`Device ${status.id} (${status.model}): ${event}`);
      const value = { time: now, event, id: status.id, name: status.name, model: status.model };
      await this.setState("events.last", JSON.stringify(value), true);
    }
  }
  /**
   * Error handling without loops (audit B.11.5): a rejected key or a changed certificate waits long,
   * other errors retry with backoff. After STALE_INTERVALS intervals without data the summary turns grey.
   *
   * @param err - Caught error
   */
  async handleFailure(err) {
    if (err instanceof import_errors.AbortedError || this.abort.signal.aborted) {
      this.log.debug(`Stopped while busy: ${(0, import_errors.describeError)(err)}`);
      return;
    }
    await this.setState("info.connection", false, true);
    const lasting = err instanceof import_errors.KeyRejectedError || err instanceof import_errors.CertificateChangedError || err instanceof import_errors.RateLimitedError;
    await this.markStale(lasting);
    let waitS;
    if (err instanceof import_errors.KeyRejectedError || err instanceof import_errors.CertificateChangedError) {
      this.log.error(`${err.message}. Next attempt in ${RETRY_MAX_S / 60} min.`);
      waitS = RETRY_MAX_S;
    } else if (err instanceof import_errors.RateLimitedError) {
      this.log.warn(err.message);
      waitS = Math.ceil(err.retryAfterMs / 1e3);
    } else {
      const message = `Console not reachable: ${(0, import_errors.describeError)(err)}. Next attempt in ${this.retrySeconds} s`;
      if (this.failing) {
        this.log.debug(message);
      } else {
        this.log.warn(message);
      }
      waitS = this.retrySeconds;
      this.retrySeconds = Math.min(this.retrySeconds * 2, RETRY_MAX_S);
    }
    this.failing = true;
    this.site = void 0;
    this.schedule(waitS * 1e3, () => this.poll(true));
  }
  /**
   * The tile never shows green from old values.
   *
   * @param now - Stale at once, without waiting for STALE_INTERVALS intervals
   */
  async markStale(now = false) {
    if (!this.tree || !now && !(0, import_status.isStale)(this.lastUpdate, this.pollSeconds * 1e3)) {
      return;
    }
    await this.setState("info.dataStale", true, true);
    if (this.lastUpdate > 0) {
      await this.tree.setValue("summary.state", "stale");
    }
  }
  /**
   * Manual refresh, at most every 10 s.
   *
   * @param id - State ID
   * @param state - State
   */
  onStateChange(id, state) {
    if (!state || state.ack || id !== `${this.namespace}.refresh`) {
      return;
    }
    const now = Date.now();
    if (now - this.lastRefresh < REFRESH_MIN_MS || this.running || !this.client) {
      this.log.debug("Refresh ignored (running or too soon)");
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
  async onMessage(obj) {
    if ((obj == null ? void 0 : obj.command) !== "fetchCertificate" || !obj.callback) {
      return;
    }
    const message = obj.message;
    const host = (0, import_config.consoleHost)(message == null ? void 0 : message.host);
    let answer;
    if (!host) {
      answer = { error: "Enter the address of the console first" };
    } else {
      try {
        const cert = await (0, import_certificate.fetchCertificate)(host, (0, import_config.consolePort)(message == null ? void 0 : message.port));
        answer = {
          native: { certificate: cert.pem, certFingerprint: cert.fingerprint },
          result: `SHA-256 ${cert.fingerprint}`
        };
        this.log.info("Certificate of the console fetched - compare the fingerprint and save to confirm it");
      } catch (err) {
        answer = { error: `Certificate not fetched: ${(0, import_errors.describeError)(err)}` };
      }
    }
    this.sendTo(obj.from, obj.command, answer, obj.callback);
  }
  /**
   * Shuts down: no new timers or requests (audit B.4.16).
   *
   * @param callback - Must be called in any case
   */
  onUnload(callback) {
    try {
      this.abort.abort();
      this.clearTimeout(this.timer);
      this.timer = void 0;
      this.setState("info.connection", false, true).catch(
        (err) => this.log.debug(`info.connection not reset: ${(0, import_errors.describeError)(err)}`)
      );
    } finally {
      callback();
    }
  }
}
if (require.main !== module) {
  module.exports = (options) => new UnifiMap(options);
} else {
  (() => new UnifiMap())();
}
//# sourceMappingURL=main.js.map
