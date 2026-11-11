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
var topology_exports = {};
__export(topology_exports, {
  buildTopology: () => buildTopology,
  rememberUplinks: () => rememberUplinks,
  uplinksFromStored: () => uplinksFromStored
});
module.exports = __toCommonJS(topology_exports);
const MAX_DEPTH = 32;
const PLACEHOLDER = "unknown-switch-";
function buildTopology(devices, lastUplinks) {
  var _a, _b, _c, _d, _e, _f;
  const byId = new Map(devices.map((d) => [d.id, d]));
  const parentOf = (d) => {
    if (d.uplinkId && byId.has(d.uplinkId)) {
      return { id: d.uplinkId, remembered: false };
    }
    const last = lastUplinks.get(d.id);
    if (last && byId.has(last) && d.role !== "gateway") {
      return { id: last, remembered: true };
    }
    return { id: "", remembered: false };
  };
  const parents = new Map(devices.map((d) => [d.id, parentOf(d)]));
  const root = (_b = (_a = devices.find((d) => d.role === "gateway")) == null ? void 0 : _a.id) != null ? _b : "";
  const placeholders = placeUnknownSwitches(devices, parents, root, byId);
  const walk = (id) => {
    var _a2, _b2, _c2;
    let depth = 0;
    let cause = "";
    let current = id;
    const seen = /* @__PURE__ */ new Set([id]);
    while (current !== root) {
      const parent = (_b2 = (_a2 = parents.get(current)) == null ? void 0 : _a2.id) != null ? _b2 : "";
      if (!parent || seen.has(parent) || depth >= MAX_DEPTH) {
        return { depth: -1, cause };
      }
      depth++;
      if (!cause && ((_c2 = byId.get(parent)) == null ? void 0 : _c2.failed)) {
        cause = parent;
      }
      seen.add(parent);
      current = parent;
    }
    return { depth, cause };
  };
  const nodes = placeholders.map((p) => ({
    id: p.id,
    name: "",
    model: "",
    role: "unknownSwitch",
    state: "ok",
    uplinkId: p.parent,
    depth: walk(p.id).depth,
    causeId: "",
    updatable: false,
    virtual: true
  }));
  nodes.push(
    ...devices.map((d) => {
      var _a2, _b2;
      const { depth, cause } = walk(d.id);
      const consequence = d.failed && cause !== "";
      let state = "ok";
      if (consequence) {
        state = "consequence";
      } else if (d.failed) {
        state = "offline";
      } else if (!d.online) {
        state = "busy";
      } else if (d.degraded) {
        state = "degraded";
      }
      return {
        id: d.id,
        name: d.name,
        model: d.model,
        role: d.role,
        state,
        uplinkId: (_b2 = (_a2 = parents.get(d.id)) == null ? void 0 : _a2.id) != null ? _b2 : "",
        depth: d.id === root ? 0 : depth,
        causeId: consequence ? rootCause(cause, parents, byId) : "",
        updatable: d.updatable,
        virtual: false
      };
    })
  );
  const edges = placeholders.filter((p) => p.parent).map((p) => {
    var _a2;
    return {
      from: p.parent,
      to: p.id,
      type: "",
      speed: null,
      maxSpeed: null,
      signal: null,
      degraded: false,
      remembered: false,
      port: (_a2 = p.port) != null ? _a2 : null
    };
  });
  for (const d of devices) {
    const parent = parents.get(d.id);
    if (!parent.id) {
      continue;
    }
    edges.push({
      from: parent.id,
      to: d.id,
      type: d.uplinkType,
      speed: (_c = d.linkSpeed) != null ? _c : null,
      maxSpeed: (_d = d.linkMaxSpeed) != null ? _d : null,
      signal: (_e = d.signalDbm) != null ? _e : null,
      degraded: d.degraded,
      remembered: parent.remembered,
      // behind a placeholder the reported port belongs to the other member, not to the section
      port: d.uplinkType === "wired" && !parent.id.startsWith(PLACEHOLDER) ? (_f = d.uplinkPort) != null ? _f : null : null
    });
  }
  return { rootId: root, nodes, edges };
}
function placeUnknownSwitches(devices, parents, root, byId) {
  var _a, _b, _c, _d;
  const circles = [];
  const done = /* @__PURE__ */ new Set();
  for (const device of devices) {
    const path = [];
    const onPath = /* @__PURE__ */ new Set();
    let current = device.id;
    while (current && current !== root && !done.has(current) && !onPath.has(current)) {
      path.push(current);
      onPath.add(current);
      current = (_b = (_a = parents.get(current)) == null ? void 0 : _a.id) != null ? _b : "";
    }
    if (current && onPath.has(current)) {
      const id = `${PLACEHOLDER}${circles.length + 1}`;
      const members = path.slice(path.indexOf(current));
      for (const member of members) {
        parents.set(member, { id, remembered: (_d = (_c = parents.get(member)) == null ? void 0 : _c.remembered) != null ? _d : false });
      }
      parents.set(id, { id: root, remembered: false });
      circles.push({ id, members });
    }
    for (const id of path) {
      done.add(id);
    }
  }
  return circles.map(({ id, members }) => {
    const found = attachPoint(members, devices, byId);
    if (found && !leadsThrough(found.id, id, parents)) {
      parents.set(id, { id: found.id, remembered: false });
      return { id, parent: found.id, port: found.port };
    }
    return { id, parent: root, port: void 0 };
  });
}
function attachPoint(members, devices, byId) {
  var _a;
  const inCircle = new Set(members);
  const seenByAll = devices.filter((d) => !inCircle.has(d.id)).filter((d) => members.every((m) => {
    var _a2;
    return (_a2 = byId.get(m)) == null ? void 0 : _a2.neighbors.some((n) => n.id === d.id);
  })).map((d) => d.id);
  const towards = (id) => {
    var _a2;
    return (_a2 = byId.get(id)) == null ? void 0 : _a2.neighbors.find((n) => inCircle.has(n.id));
  };
  const confirmed = seenByAll.filter((id) => towards(id));
  const pick = confirmed.length === 1 ? confirmed[0] : seenByAll.length === 1 ? seenByAll[0] : void 0;
  return pick ? { id: pick, port: (_a = towards(pick)) == null ? void 0 : _a.port } : void 0;
}
function leadsThrough(from, target, parents) {
  var _a, _b;
  let current = from;
  for (let i = 0; i < MAX_DEPTH && current; i++) {
    if (current === target) {
      return true;
    }
    current = (_b = (_a = parents.get(current)) == null ? void 0 : _a.id) != null ? _b : "";
  }
  return false;
}
function rootCause(start, parents, byId) {
  var _a, _b, _c;
  let cause = start;
  let current = start;
  for (let i = 0; i < MAX_DEPTH; i++) {
    const parent = (_b = (_a = parents.get(current)) == null ? void 0 : _a.id) != null ? _b : "";
    if (!parent) {
      break;
    }
    if ((_c = byId.get(parent)) == null ? void 0 : _c.failed) {
      cause = parent;
    }
    current = parent;
  }
  return cause;
}
function rememberUplinks(devices, previous) {
  const known = new Set(devices.map((d) => d.id));
  const next = /* @__PURE__ */ new Map();
  for (const [id, parent] of previous) {
    if (known.has(id)) {
      next.set(id, parent);
    }
  }
  for (const d of devices) {
    if (d.uplinkId) {
      next.set(d.id, d.uplinkId);
    }
  }
  return next;
}
function uplinksFromStored(stored) {
  const result = /* @__PURE__ */ new Map();
  try {
    const parsed = typeof stored === "string" && stored ? JSON.parse(stored) : {};
    for (const node of Array.isArray(parsed.nodes) ? parsed.nodes : []) {
      if (typeof (node == null ? void 0 : node.id) === "string" && typeof node.uplinkId === "string" && node.uplinkId) {
        result.set(node.id, node.uplinkId);
      }
    }
  } catch {
  }
  return result;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  buildTopology,
  rememberUplinks,
  uplinksFromStored
});
//# sourceMappingURL=topology.js.map
