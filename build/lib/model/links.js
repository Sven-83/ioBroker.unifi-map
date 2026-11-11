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
var links_exports = {};
__export(links_exports, {
  LinkBaseline: () => LinkBaseline
});
module.exports = __toCommonJS(links_exports);
class LinkBaseline {
  usual = /* @__PURE__ */ new Map();
  /**
   * @param stored - JSON of serialize(), may be empty or damaged
   */
  constructor(stored) {
    try {
      const parsed = typeof stored === "string" && stored ? JSON.parse(stored) : {};
      for (const [id, value] of Object.entries(parsed)) {
        if (typeof value === "number" && Number.isFinite(value) && value > 0) {
          this.usual.set(id, value);
        }
      }
    } catch {
    }
  }
  /**
   * Checks the current speed of a cable uplink and learns it.
   *
   * @param id - Device
   * @param speedMbps - Current speed; undefined or 0 if unknown (then nothing changes)
   */
  check(id, speedMbps) {
    const usual = this.usual.get(id);
    if (speedMbps === void 0 || !(speedMbps > 0)) {
      return { usual, slower: false };
    }
    if (usual === void 0 || speedMbps > usual) {
      this.usual.set(id, speedMbps);
    }
    return { usual: usual != null ? usual : speedMbps, slower: usual !== void 0 && speedMbps < usual };
  }
  /** Forgets all usual speeds: the next values become the usual ones */
  reset() {
    this.usual.clear();
  }
  /** Value to store */
  serialize() {
    return JSON.stringify(Object.fromEntries(this.usual));
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  LinkBaseline
});
//# sourceMappingURL=links.js.map
