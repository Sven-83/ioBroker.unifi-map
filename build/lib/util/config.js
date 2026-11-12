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
var config_exports = {};
__export(config_exports, {
  DETAIL_DEFAULT_S: () => DETAIL_DEFAULT_S,
  DETAIL_MAX_S: () => DETAIL_MAX_S,
  DETAIL_MIN_S: () => DETAIL_MIN_S,
  JITTER_MS: () => JITTER_MS,
  POLL_DEFAULT_S: () => POLL_DEFAULT_S,
  POLL_MAX_S: () => POLL_MAX_S,
  POLL_MIN_S: () => POLL_MIN_S,
  apiKey: () => apiKey,
  clamp: () => clamp,
  consoleHost: () => consoleHost,
  consolePort: () => consolePort,
  delayMs: () => delayMs,
  segmentName: () => segmentName
});
module.exports = __toCommonJS(config_exports);
var import_node_net = require("node:net");
const POLL_DEFAULT_S = 60;
const POLL_MIN_S = 30;
const POLL_MAX_S = 3600;
const DETAIL_DEFAULT_S = 300;
const DETAIL_MIN_S = 60;
const DETAIL_MAX_S = 3600;
const JITTER_MS = 5e3;
function clamp(value, fallback, min, max) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return Math.min(Math.max(n, min), max);
}
function consoleHost(value) {
  const host = typeof value === "string" ? value.trim() : "";
  if ((0, import_node_net.isIP)(host)) {
    return host;
  }
  return /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/.test(
    host
  ) ? host : void 0;
}
function consolePort(value) {
  const port = Math.round(Number(value));
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 443;
}
function apiKey(value) {
  const key = typeof value === "string" ? value.trim() : "";
  return /^[\x21-\x7e]{8,256}$/.test(key) ? key : void 0;
}
function segmentName(value) {
  const name = typeof value === "string" ? value.replace(new RegExp("\\p{Cc}", "gu"), "").trim() : "";
  return name.slice(0, 30);
}
function delayMs(seconds, random = Math.random) {
  return seconds * 1e3 + Math.floor(random() * JITTER_MS);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DETAIL_DEFAULT_S,
  DETAIL_MAX_S,
  DETAIL_MIN_S,
  JITTER_MS,
  POLL_DEFAULT_S,
  POLL_MAX_S,
  POLL_MIN_S,
  apiKey,
  clamp,
  consoleHost,
  consolePort,
  delayMs,
  segmentName
});
//# sourceMappingURL=config.js.map
