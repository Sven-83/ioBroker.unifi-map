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
var restarts_exports = {};
__export(restarts_exports, {
  BOOT_TOLERANCE_MS: () => BOOT_TOLERANCE_MS,
  RESTART_WINDOW_MS: () => RESTART_WINDOW_MS,
  RestartTracker: () => RestartTracker
});
module.exports = __toCommonJS(restarts_exports);
const BOOT_TOLERANCE_MS = 12e4;
const RESTART_WINDOW_MS = 7 * 24 * 36e5;
class RestartTracker {
  entries = /* @__PURE__ */ new Map();
  /**
   * @param stored - JSON of serialize(), may be empty or damaged
   */
  constructor(stored) {
    try {
      const parsed = typeof stored === "string" && stored ? JSON.parse(stored) : {};
      for (const [id, value] of Object.entries(parsed)) {
        const entry = value;
        if (typeof (entry == null ? void 0 : entry.bootAt) === "number" && Array.isArray(entry.restarts)) {
          this.entries.set(id, {
            bootAt: entry.bootAt,
            restarts: entry.restarts.filter((t) => typeof t === "number")
          });
        }
      }
    } catch {
    }
  }
  /**
   * Checks the uptime of a device.
   *
   * @param id - Device
   * @param uptimeSec - Uptime, undefined if unknown (then nothing changes)
   * @param now - Current time
   */
  check(id, uptimeSec, now = Date.now()) {
    const entry = this.entries.get(id);
    if (uptimeSec === void 0 || uptimeSec < 0) {
      return this.info(entry, now, false);
    }
    const bootAt = now - uptimeSec * 1e3;
    if (!entry) {
      const first = { bootAt, restarts: [] };
      this.entries.set(id, first);
      return this.info(first, now, false);
    }
    let restarted = false;
    if (bootAt > entry.bootAt + BOOT_TOLERANCE_MS) {
      entry.restarts.push(bootAt);
      restarted = true;
    }
    entry.bootAt = restarted ? bootAt : Math.min(entry.bootAt, bootAt);
    return this.info(entry, now, restarted);
  }
  /** Value to store */
  serialize() {
    return JSON.stringify(Object.fromEntries(this.entries));
  }
  info(entry, now, restarted) {
    if (!entry) {
      return { lastRestart: 0, restartCount7d: 0, restarted };
    }
    entry.restarts = entry.restarts.filter((t) => now - t < RESTART_WINDOW_MS);
    return { lastRestart: Math.round(entry.bootAt), restartCount7d: entry.restarts.length, restarted };
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BOOT_TOLERANCE_MS,
  RESTART_WINDOW_MS,
  RestartTracker
});
//# sourceMappingURL=restarts.js.map
