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
var http_exports = {};
__export(http_exports, {
  MAX_ANSWER_BYTES: () => MAX_ANSWER_BYTES,
  RATE_LIMIT_FALLBACK_MS: () => RATE_LIMIT_FALLBACK_MS,
  REQUEST_TIMEOUT_MS: () => REQUEST_TIMEOUT_MS,
  UnifiHttp: () => UnifiHttp,
  retryAfterMs: () => retryAfterMs
});
module.exports = __toCommonJS(http_exports);
var import_node_https = require("node:https");
var import_errors = require("./errors");
const REQUEST_TIMEOUT_MS = 1e4;
const MAX_ANSWER_BYTES = 10 * 1024 * 1024;
const RATE_LIMIT_FALLBACK_MS = 6e4;
function retryAfterMs(header, now = Date.now()) {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) {
    return RATE_LIMIT_FALLBACK_MS;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1e3, 36e5);
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.min(Math.max(date - now, 0), 36e5) : RATE_LIMIT_FALLBACK_MS;
}
class UnifiHttp {
  /**
   * @param options - Connection settings
   */
  constructor(options) {
    this.options = options;
  }
  /**
   * Requests a path and returns the parsed JSON.
   *
   * @param path - Path starting with /
   * @param what - Short description for errors
   */
  get(path, what) {
    const { host, port, apiKey, certificatePem, fingerprint, signal } = this.options;
    if (signal == null ? void 0 : signal.aborted) {
      return Promise.reject(new import_errors.AbortedError());
    }
    const started = Date.now();
    return new Promise((resolve, reject) => {
      var _a;
      let certificateChanged = false;
      const req = (0, import_node_https.request)(
        {
          host,
          port,
          path,
          method: "GET",
          headers: { "X-API-KEY": apiKey, Accept: "application/json" },
          // the confirmed certificate is the only trust anchor, and only its fingerprint is accepted;
          // the name check is replaced because consoles issue the certificate for a name, not the address
          ca: certificatePem,
          rejectUnauthorized: true,
          checkServerIdentity: (_name, cert) => {
            if (cert.fingerprint256 === fingerprint) {
              return void 0;
            }
            certificateChanged = true;
            return new import_errors.CertificateChangedError();
          },
          timeout: (_a = this.options.timeoutMs) != null ? _a : REQUEST_TIMEOUT_MS,
          signal,
          agent: false
        },
        (res) => {
          const chunks = [];
          let size = 0;
          res.on("data", (chunk) => {
            size += chunk.length;
            if (size > MAX_ANSWER_BYTES) {
              req.destroy(new import_errors.ApiError(`${what}: answer too large`, 0));
              return;
            }
            chunks.push(chunk);
          });
          res.on("end", () => {
            var _a2, _b, _c;
            const status = (_a2 = res.statusCode) != null ? _a2 : 0;
            (_c = (_b = this.options).trace) == null ? void 0 : _c.call(_b, `GET ${what} -> ${status} in ${Date.now() - started} ms, ${size} bytes`);
            if (status === 401 || status === 403) {
              return reject(new import_errors.KeyRejectedError(status));
            }
            if (status === 429) {
              return reject(new import_errors.RateLimitedError(retryAfterMs(res.headers["retry-after"])));
            }
            if (status < 200 || status >= 300) {
              return reject(new import_errors.ApiError(what, status));
            }
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            } catch {
              reject(new import_errors.ApiError(`${what}: answer is not JSON`, status));
            }
          });
          res.on("error", (err) => reject(new import_errors.ApiError(`${what}: ${err.message}`, 0)));
        }
      );
      req.on("timeout", () => req.destroy(new import_errors.ApiError(`${what}: no answer within the time limit`, 0)));
      req.on("error", (err) => {
        if (signal == null ? void 0 : signal.aborted) {
          return reject(new import_errors.AbortedError());
        }
        if (certificateChanged || err instanceof import_errors.CertificateChangedError) {
          return reject(new import_errors.CertificateChangedError());
        }
        if (/self[- ]signed|unable to verify|certificate/i.test(err.message)) {
          return reject(new import_errors.CertificateChangedError());
        }
        reject(err instanceof import_errors.ApiError ? err : new import_errors.ApiError(`${what}: ${err.message}`, 0));
      });
      req.end();
    });
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MAX_ANSWER_BYTES,
  RATE_LIMIT_FALLBACK_MS,
  REQUEST_TIMEOUT_MS,
  UnifiHttp,
  retryAfterMs
});
//# sourceMappingURL=http.js.map
