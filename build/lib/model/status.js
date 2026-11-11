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
var status_exports = {};
__export(status_exports, {
  BUSY_STATES: () => BUSY_STATES,
  STALE_INTERVALS: () => STALE_INTERVALS,
  deviceStatus: () => deviceStatus,
  isStale: () => isStale,
  roleOf: () => roleOf,
  summarize: () => summarize
});
module.exports = __toCommonJS(status_exports);
const BUSY_STATES = /* @__PURE__ */ new Set(["UPDATING", "GETTING_READY", "ADOPTING", "PENDING_ADOPTION"]);
const STALE_INTERVALS = 3;
function roleOf(device, details) {
  if (details && !details.uplinkDeviceId && device.features.includes("switching")) {
    return "gateway";
  }
  if (device.features.includes("switching")) {
    return "switch";
  }
  if (device.features.includes("accessPoint")) {
    return "accessPoint";
  }
  return "other";
}
function deviceStatus(input) {
  var _a, _b;
  const { device, details, statistics, uplink } = input;
  const online = device.state === "ONLINE";
  const role = roleOf(device, details);
  const wired = (uplink == null ? void 0 : uplink.type) === "wired";
  const usual = input.usualSpeedMbps;
  const slow = online && role !== "gateway" && wired && uplink.speedMbps !== void 0 && usual !== void 0 && uplink.speedMbps > 0 && uplink.speedMbps < usual;
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
    uptimeSec: online ? statistics == null ? void 0 : statistics.uptimeSec : void 0,
    // the console is the root: what the classic list reports as its uplink is the internet line or history
    uplinkId: role === "gateway" ? "" : (details == null ? void 0 : details.uplinkDeviceId) || input.classicParentId || (online ? "" : input.classicLastParentId) || "",
    uplinkType: (_a = uplink == null ? void 0 : uplink.type) != null ? _a : "",
    linkSpeed: uplink == null ? void 0 : uplink.speedMbps,
    linkMaxSpeed: uplink == null ? void 0 : uplink.maxSpeedMbps,
    linkUsualSpeed: wired ? usual : void 0,
    signalDbm: uplink == null ? void 0 : uplink.signalDbm,
    degraded: slow,
    degradedReason: slow ? `uplink ${uplink.speedMbps} instead of the usual ${usual} Mbit/s` : "",
    clients: input.clients,
    uplinkPort: uplink == null ? void 0 : uplink.remotePort,
    neighbors: (_b = input.neighbors) != null ? _b : []
  };
}
function summarize(devices, stale) {
  const offline = devices.filter((d) => d.failed).length;
  const degraded = devices.filter((d) => d.degraded).length;
  let state = "ok";
  if (stale) {
    state = "stale";
  } else if (offline > 0) {
    state = "offline";
  } else if (degraded > 0) {
    state = "degraded";
  }
  return {
    total: devices.length,
    online: devices.filter((d) => d.online).length,
    offline,
    degraded,
    updates: devices.filter((d) => d.updatable).length,
    state
  };
}
function isStale(lastUpdate, intervalMs, now = Date.now()) {
  return !lastUpdate || now - lastUpdate > STALE_INTERVALS * intervalMs;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BUSY_STATES,
  STALE_INTERVALS,
  deviceStatus,
  isStale,
  roleOf,
  summarize
});
//# sourceMappingURL=status.js.map
