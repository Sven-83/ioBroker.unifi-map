"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var client_exports = {};
__export(client_exports, {
  CLASSIC_PATH: () => CLASSIC_PATH,
  INTEGRATION_PATH: () => INTEGRATION_PATH,
  PAGE_SIZE: () => PAGE_SIZE,
  UnifiClient: () => UnifiClient,
  listOf: () => listOf,
  parseClassicUplink: () => parseClassicUplink,
  parseDevice: () => parseDevice
});
module.exports = __toCommonJS(client_exports);
var import_errors = require("./errors");
const INTEGRATION_PATH = "/proxy/network/integration/v1";
const CLASSIC_PATH = "/proxy/network/api/s";
const PAGE_SIZE = 200;
const MAX_PAGES = 20;
const text = (value) => typeof value === "string" ? value : "";
const num = (value) => typeof value === "number" && Number.isFinite(value) ? value : void 0;
const record = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
function listOf(body) {
  if (Array.isArray(body)) {
    return body;
  }
  const data = record(body).data;
  return Array.isArray(data) ? data : [];
}
function parseDevice(entry) {
  const item = record(entry);
  const id = text(item.id);
  if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) {
    return void 0;
  }
  return {
    id,
    name: text(item.name).slice(0, 100),
    model: text(item.model).slice(0, 60),
    mac: text(item.macAddress).toLowerCase(),
    ip: text(item.ipAddress).slice(0, 45),
    state: text(item.state).toUpperCase() || "UNKNOWN",
    firmware: text(item.firmwareVersion).slice(0, 40),
    updatable: item.firmwareUpdatable === true,
    features: Array.isArray(item.features) ? item.features.filter((f) => typeof f === "string") : []
  };
}
function parseClassicUplink(entry) {
  const uplink = record(record(entry).uplink);
  const last = record(record(entry).last_uplink);
  const parentMac = text(uplink.uplink_mac).toLowerCase();
  const lastParentMac = text(last.uplink_mac).toLowerCase();
  const type = uplink.type === "wire" ? "wired" : uplink.type === "wireless" ? "wireless" : void 0;
  if (type === "wireless") {
    const rate = num(uplink.tx_rate);
    return {
      type,
      speedMbps: rate === void 0 ? void 0 : Math.round(rate / 1e3),
      maxSpeedMbps: void 0,
      signalDbm: num(uplink.signal),
      parentMac,
      lastParentMac
    };
  }
  return {
    type,
    speedMbps: num(uplink.speed),
    maxSpeedMbps: num(uplink.max_speed),
    signalDbm: void 0,
    parentMac,
    lastParentMac
  };
}
class UnifiClient {
  /**
   * @param http - HTTPS layer
   */
  constructor(http) {
    this.http = http;
  }
  /** Version of the Network application */
  async networkVersion() {
    return text(record(await this.http.get(`${INTEGRATION_PATH}/info`, "info")).applicationVersion);
  }
  /** First site of the console (home networks have one) */
  async site() {
    const first = record(listOf(await this.http.get(`${INTEGRATION_PATH}/sites`, "sites"))[0]);
    const id = text(first.id);
    if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) {
      throw new import_errors.ApiError("sites: no site in the answer - check the role of the key", 0);
    }
    const reference = text(first.internalReference);
    return { id, reference: /^[A-Za-z0-9_-]{1,64}$/.test(reference) ? reference : "default" };
  }
  /**
   * All adopted devices.
   *
   * @param site - Site
   */
  async devices(site) {
    const devices = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const body = await this.http.get(
        `${INTEGRATION_PATH}/sites/${site.id}/devices?offset=${page * PAGE_SIZE}&limit=${PAGE_SIZE}`,
        "devices"
      );
      const entries = listOf(body);
      devices.push(...entries.map(parseDevice).filter((d) => d !== void 0));
      const total = num(record(body).totalCount);
      if (entries.length < PAGE_SIZE || total !== void 0 && devices.length >= total) {
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
  async details(site, deviceId) {
    const body = record(await this.http.get(`${INTEGRATION_PATH}/sites/${site.id}/devices/${deviceId}`, "details"));
    const uplink = text(record(body.uplink).deviceId);
    return { uplinkDeviceId: uplink || void 0 };
  }
  /**
   * Latest statistics of one device.
   *
   * @param site - Site
   * @param deviceId - Device
   */
  async statistics(site, deviceId) {
    const body = record(
      await this.http.get(
        `${INTEGRATION_PATH}/sites/${site.id}/devices/${deviceId}/statistics/latest`,
        "statistics"
      )
    );
    return {
      uptimeSec: num(body.uptimeSec),
      cpuPct: num(body.cpuUtilizationPct),
      memoryPct: num(body.memoryUtilizationPct)
    };
  }
  /**
   * Number of clients per device they are connected to. Names and addresses of clients are not kept.
   *
   * @param site - Site
   */
  async clientCounts(site) {
    var _a;
    const counts = /* @__PURE__ */ new Map();
    for (let page = 0; page < MAX_PAGES; page++) {
      const body = await this.http.get(
        `${INTEGRATION_PATH}/sites/${site.id}/clients?offset=${page * PAGE_SIZE}&limit=${PAGE_SIZE}`,
        "clients"
      );
      const entries = listOf(body);
      for (const entry of entries) {
        const parent = text(record(entry).uplinkDeviceId);
        if (parent) {
          counts.set(parent, ((_a = counts.get(parent)) != null ? _a : 0) + 1);
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
  async classicUplinks(site) {
    const uplinks = /* @__PURE__ */ new Map();
    for (const entry of listOf(
      await this.http.get(`${CLASSIC_PATH}/${site.reference}/stat/device`, "classic devices")
    )) {
      const mac = text(record(entry).mac).toLowerCase();
      if (mac) {
        uplinks.set(mac, parseClassicUplink(entry));
      }
    }
    return uplinks;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CLASSIC_PATH,
  INTEGRATION_PATH,
  PAGE_SIZE,
  UnifiClient,
  listOf,
  parseClassicUplink,
  parseDevice
});
//# sourceMappingURL=client.js.map
