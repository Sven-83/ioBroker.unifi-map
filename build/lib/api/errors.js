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
var errors_exports = {};
__export(errors_exports, {
  AbortedError: () => AbortedError,
  ApiError: () => ApiError,
  CertificateChangedError: () => CertificateChangedError,
  KeyRejectedError: () => KeyRejectedError,
  RateLimitedError: () => RateLimitedError,
  UnifiError: () => UnifiError,
  describeError: () => describeError
});
module.exports = __toCommonJS(errors_exports);
class UnifiError extends Error {
  /**
   * @param message - Error message
   */
  constructor(message) {
    super(message);
    this.name = new.target.name;
  }
}
class KeyRejectedError extends UnifiError {
  /**
   * @param status - HTTP status
   */
  constructor(status) {
    super(`The console rejected the API key (HTTP ${status})`);
    this.status = status;
  }
}
class CertificateChangedError extends UnifiError {
  /** Creates the error */
  constructor() {
    super("The certificate of the console has changed - fetch and confirm it again in the instance settings");
  }
}
class RateLimitedError extends UnifiError {
  /**
   * @param retryAfterMs - Wait time from Retry-After, otherwise a fallback
   */
  constructor(retryAfterMs) {
    super(`The console asks to wait ${Math.round(retryAfterMs / 1e3)} s (HTTP 429)`);
    this.retryAfterMs = retryAfterMs;
  }
}
class ApiError extends UnifiError {
  /**
   * @param what - What was requested
   * @param status - HTTP status, 0 if there was no answer
   */
  constructor(what, status) {
    super(status ? `${what}: HTTP ${status}` : what);
    this.status = status;
  }
}
class AbortedError extends UnifiError {
  /** Creates the error */
  constructor() {
    super("Request aborted");
  }
}
function describeError(err) {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AbortedError,
  ApiError,
  CertificateChangedError,
  KeyRejectedError,
  RateLimitedError,
  UnifiError,
  describeError
});
//# sourceMappingURL=errors.js.map
