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
var tree_exports = {};
__export(tree_exports, {
  DEVICE_STATES: () => DEVICE_STATES,
  ObjectTree: () => ObjectTree,
  SUMMARY_STATES: () => SUMMARY_STATES
});
module.exports = __toCommonJS(tree_exports);
const DEVICE_STATES = [
  { key: "name", name: "Name", type: "string", role: "info.name", get: (d) => d.name },
  { key: "model", name: "Model", type: "string", role: "info.model", get: (d) => d.model },
  {
    key: "role",
    name: "Role in the network",
    type: "string",
    role: "text",
    states: { gateway: "console", switch: "switch", accessPoint: "access point", other: "other" },
    get: (d) => d.role
  },
  { key: "state", name: "State reported by the console", type: "string", role: "info.status", get: (d) => d.state },
  { key: "online", name: "Online", type: "boolean", role: "indicator.reachable", get: (d) => d.online },
  { key: "ip", name: "IP address", type: "string", role: "info.ip", get: (d) => d.ip },
  { key: "firmware", name: "Firmware", type: "string", role: "info.firmware", get: (d) => d.firmware },
  { key: "updatable", name: "Firmware update available", type: "boolean", role: "indicator", get: (d) => d.updatable },
  { key: "uptime", name: "Uptime", type: "number", role: "value", unit: "s", get: (d) => {
    var _a;
    return (_a = d.uptimeSec) != null ? _a : null;
  } },
  {
    key: "lastRestart",
    name: "Time of the last start",
    type: "number",
    role: "value.time",
    get: (_d, r) => r.lastRestart
  },
  {
    key: "restartCount7d",
    name: "Restarts in the last 7 days",
    type: "number",
    role: "value",
    get: (_d, r) => r.restartCount7d
  },
  { key: "uplinkId", name: "Device it is connected to", type: "string", role: "text", get: (d) => d.uplinkId },
  {
    key: "uplinkType",
    name: "Connection to that device",
    type: "string",
    role: "text",
    states: { wired: "cable", wireless: "wireless (mesh)", "": "unknown" },
    get: (d) => d.uplinkType
  },
  {
    key: "linkSpeed",
    name: "Link speed (mesh: transmit rate)",
    type: "number",
    role: "value",
    unit: "Mbit/s",
    get: (d) => {
      var _a;
      return (_a = d.linkSpeed) != null ? _a : null;
    }
  },
  {
    key: "linkMaxSpeed",
    name: "Highest link speed (cable)",
    type: "number",
    role: "value",
    unit: "Mbit/s",
    get: (d) => {
      var _a;
      return (_a = d.linkMaxSpeed) != null ? _a : null;
    }
  },
  {
    key: "linkUsualSpeed",
    name: "Usual link speed (cable, yellow below it)",
    type: "number",
    role: "value",
    unit: "Mbit/s",
    get: (d) => {
      var _a;
      return (_a = d.linkUsualSpeed) != null ? _a : null;
    }
  },
  {
    key: "signal",
    name: "Signal of the mesh link",
    type: "number",
    role: "value",
    unit: "dBm",
    get: (d) => {
      var _a;
      return (_a = d.signalDbm) != null ? _a : null;
    }
  },
  {
    key: "degraded",
    name: "Uplink slower than usual",
    type: "boolean",
    role: "indicator.alarm",
    get: (d) => d.degraded
  },
  {
    key: "degradedReason",
    name: "Why the device is shown yellow",
    type: "string",
    role: "text",
    get: (d) => d.degradedReason
  },
  { key: "clients", name: "Connected clients", type: "number", role: "value", get: (d) => {
    var _a;
    return (_a = d.clients) != null ? _a : null;
  } },
  {
    key: "consequence",
    name: "Unreachable only because a device before it failed",
    type: "boolean",
    role: "indicator",
    get: (_d, _r, n) => n.state === "consequence"
  },
  {
    key: "causeId",
    name: "Failed device that cuts it off",
    type: "string",
    role: "text",
    get: (_d, _r, n) => n.causeId
  }
];
const SUMMARY_STATES = [
  { key: "total", name: "Devices", type: "number", role: "value" },
  { key: "online", name: "Devices online", type: "number", role: "value" },
  { key: "offline", name: "Devices offline", type: "number", role: "value" },
  { key: "degraded", name: "Devices with an uplink slower than usual", type: "number", role: "value" },
  { key: "updates", name: "Firmware updates available", type: "number", role: "value" },
  { key: "state", name: "State of the network", type: "string", role: "text" }
];
class ObjectTree {
  /**
   * @param host - Adapter functions
   */
  constructor(host) {
    this.host = host;
  }
  objects = /* @__PURE__ */ new Map();
  values = /* @__PURE__ */ new Map();
  /**
   * Writes one device.
   *
   * @param device - Status
   * @param restarts - Restart information
   * @param node - Node of the topology
   */
  async writeDevice(device, restarts, node) {
    const base = `devices.${device.id}`;
    await this.ensureObject("devices", { type: "folder", common: { name: "Devices" }, native: {} });
    await this.ensureObject(base, { type: "device", common: { name: device.name || device.model }, native: {} });
    for (const def of DEVICE_STATES) {
      const id = `${base}.${def.key}`;
      await this.ensureObject(id, {
        type: "state",
        common: {
          name: def.name,
          type: def.type,
          role: def.role,
          read: true,
          write: false,
          ...def.unit ? { unit: def.unit } : {},
          ...def.states ? { states: def.states } : {}
        },
        native: {}
      });
      await this.setValue(id, def.get(device, restarts, node));
    }
  }
  /**
   * Writes the topology for the map.
   *
   * @param topology - Nodes and edges
   */
  async writeTopology(topology) {
    await this.ensureObject("topology", { type: "channel", common: { name: "Topology" }, native: {} });
    await this.ensureObject("topology.json", {
      type: "state",
      common: { name: "Nodes and links for the map", type: "string", role: "json", read: true, write: false },
      native: {}
    });
    await this.setValue("topology.json", JSON.stringify(topology));
  }
  /**
   * Writes the summary.
   *
   * @param summary - Counts and state
   * @param details - Detail list for the widget
   */
  async writeSummary(summary, details) {
    await this.ensureObject("summary", { type: "channel", common: { name: "Summary" }, native: {} });
    for (const def of SUMMARY_STATES) {
      const id = `summary.${def.key}`;
      await this.ensureObject(id, {
        type: "state",
        common: {
          name: def.name,
          type: def.type,
          role: def.role,
          read: true,
          write: false,
          ...def.key === "state" ? {
            states: {
              ok: "ok",
              degraded: "slow uplink",
              offline: "device offline",
              stale: "data too old"
            }
          } : {}
        },
        native: {}
      });
      await this.setValue(id, summary[def.key]);
    }
    await this.ensureObject("summary.json", {
      type: "state",
      common: { name: "Detail list for the widget", type: "string", role: "json", read: true, write: false },
      native: {}
    });
    await this.setValue("summary.json", JSON.stringify(details));
  }
  /**
   * Writes a state with ack: true if its value has changed.
   *
   * @param id - Relative state ID
   * @param value - New value
   * @returns The value was written
   */
  async setValue(id, value) {
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
  value(id) {
    return this.values.get(id);
  }
  async ensureObject(id, object) {
    const signature = JSON.stringify(object);
    if (this.objects.get(id) !== signature) {
      await this.host.writeObject(id, object);
      this.objects.set(id, signature);
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DEVICE_STATES,
  ObjectTree,
  SUMMARY_STATES
});
//# sourceMappingURL=tree.js.map
