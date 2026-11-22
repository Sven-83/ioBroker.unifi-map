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
var certificate_exports = {};
__export(certificate_exports, {
  RENEWAL_WINDOW_MS: () => RENEWAL_WINDOW_MS,
  fetchCertificate: () => fetchCertificate,
  parseCertificate: () => parseCertificate,
  renewalProblem: () => renewalProblem,
  toPem: () => toPem
});
module.exports = __toCommonJS(certificate_exports);
var import_node_crypto = require("node:crypto");
var import_node_net = require("node:net");
var import_node_tls = require("node:tls");
const RENEWAL_WINDOW_MS = 14 * 864e5;
const CLOCK_SKEW_MS = 10 * 6e4;
function toPem(raw) {
  var _a;
  const lines = (_a = raw.toString("base64").match(/.{1,64}/g)) != null ? _a : [];
  return `-----BEGIN CERTIFICATE-----
${lines.join("\n")}
-----END CERTIFICATE-----
`;
}
function parseCertificate(text) {
  var _a, _b, _c;
  if (typeof text !== "string") {
    return void 0;
  }
  const body = (_a = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/.exec(text)) == null ? void 0 : _a[1].replace(/\s+/g, "");
  if (!body || !/^[A-Za-z0-9+/]+=*$/.test(body)) {
    return void 0;
  }
  const pem = toPem(Buffer.from(body, "base64"));
  try {
    const cert = new import_node_crypto.X509Certificate(pem);
    return {
      pem,
      fingerprint: cert.fingerprint256,
      subject: (_c = (_b = /CN=([^\n,]+)/.exec(cert.subject)) == null ? void 0 : _b[1]) != null ? _c : "",
      validTo: cert.validTo,
      validToMs: Date.parse(cert.validTo)
    };
  } catch {
    return void 0;
  }
}
function fetchCertificate(host, port, timeoutMs = 1e4) {
  return new Promise((resolve, reject) => {
    const socket = (0, import_node_tls.connect)(
      // nothing but the TLS handshake happens on this connection
      { host, port, rejectUnauthorized: false, ...(0, import_node_net.isIP)(host) ? {} : { servername: host } },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        const parsed = (cert == null ? void 0 : cert.raw) ? parseCertificate(toPem(cert.raw)) : void 0;
        if (parsed) {
          resolve(parsed);
        } else {
          reject(new Error("the console sent no certificate"));
        }
      }
    );
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error("no answer from the console")));
    socket.on("error", reject);
  });
}
function renewalProblem(confirmed, next, now, windowMs = RENEWAL_WINDOW_MS) {
  var _a, _b;
  let old;
  let fresh;
  try {
    old = new import_node_crypto.X509Certificate(confirmed);
    fresh = new import_node_crypto.X509Certificate(next);
  } catch {
    return "certificate cannot be read";
  }
  if (old.fingerprint256 === fresh.fingerprint256) {
    return "same certificate";
  }
  const oldTo = Date.parse(old.validTo);
  const oldFrom = Date.parse(old.validFrom);
  const newFrom = Date.parse(fresh.validFrom);
  const newTo = Date.parse(fresh.validTo);
  if (!(oldTo - now <= windowMs)) {
    return "the confirmed certificate does not run out soon";
  }
  if (fresh.subject !== old.subject || ((_a = fresh.subjectAltName) != null ? _a : "") !== ((_b = old.subjectAltName) != null ? _b : "")) {
    return "the new certificate is issued for another name";
  }
  if (fresh.issuer !== fresh.subject || !fresh.verify(fresh.publicKey)) {
    return "the new certificate is not self-signed";
  }
  if (!(newFrom > oldFrom)) {
    return "the new certificate is not newer";
  }
  if (!(newFrom - CLOCK_SKEW_MS <= now && now < newTo)) {
    return "the new certificate is not valid now";
  }
  return "";
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  RENEWAL_WINDOW_MS,
  fetchCertificate,
  parseCertificate,
  renewalProblem,
  toPem
});
//# sourceMappingURL=certificate.js.map
