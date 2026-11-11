/*
 * Error classes of the UniFi client. Messages never contain the API key, device names, MAC or IP addresses.
 */

/** Base class of all expected UniFi errors */
export class UnifiError extends Error {
    /**
     * @param message - Error message
     */
    public constructor(message: string) {
        super(message);
        this.name = new.target.name;
    }
}

/** The console rejected the API key (401/403) - do not retry in a loop (audit B.11.5) */
export class KeyRejectedError extends UnifiError {
    /**
     * @param status - HTTP status
     */
    public constructor(public readonly status: number) {
        super(`The console rejected the API key (HTTP ${status})`);
    }
}

/** The console presents another certificate than the one confirmed in the settings */
export class CertificateChangedError extends UnifiError {
    /** Creates the error */
    public constructor() {
        super('The certificate of the console has changed - fetch and confirm it again in the instance settings');
    }
}

/** Rate limit (429) with the time to wait */
export class RateLimitedError extends UnifiError {
    /**
     * @param retryAfterMs - Wait time from Retry-After, otherwise a fallback
     */
    public constructor(public readonly retryAfterMs: number) {
        super(`The console asks to wait ${Math.round(retryAfterMs / 1000)} s (HTTP 429)`);
    }
}

/** Any other answer that is not 2xx */
export class ApiError extends UnifiError {
    /**
     * @param what - What was requested
     * @param status - HTTP status, 0 if there was no answer
     */
    public constructor(
        what: string,
        public readonly status: number,
    ) {
        super(status ? `${what}: HTTP ${status}` : what);
    }
}

/** Requests were aborted because the adapter shuts down */
export class AbortedError extends UnifiError {
    /** Creates the error */
    public constructor() {
        super('Request aborted');
    }
}

/**
 * Message of any error for the log.
 *
 * @param err - Caught value
 */
export function describeError(err: unknown): string {
    if (err instanceof Error) {
        return err.message;
    }
    return String(err);
}
