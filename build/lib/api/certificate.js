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
  fetchCertificate: () => fetchCertificate,
  parseCertificate: () => parseCertificate,
  toPem: () => toPem
});
module.exports = __toCommonJS(certificate_exports);
var import_node_crypto = require("node:crypto");
var import_node_net = require("node:net");
var import_node_tls = require("node:tls");
function toPem(raw) {
  var _a;
  const lines = (_a = raw.toString("base64").match(/.{1,64}/g)) != null ? _a : [];
  return `-----BEGIN CERTIFICATE-----
${lines.join("\n")}
-----END CERTIFICATE-----
`;
}
function parseCertificate(pem) {
  var _a, _b;
  if (typeof pem !== "string" || !pem.includes("BEGIN CERTIFICATE")) {
    return void 0;
  }
  try {
    const cert = new import_node_crypto.X509Certificate(pem);
    return {
      pem,
      fingerprint: cert.fingerprint256,
      subject: (_b = (_a = /CN=([^\n,]+)/.exec(cert.subject)) == null ? void 0 : _a[1]) != null ? _b : "",
      validTo: cert.validTo
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  fetchCertificate,
  parseCertificate,
  toPem
});
//# sourceMappingURL=certificate.js.map
