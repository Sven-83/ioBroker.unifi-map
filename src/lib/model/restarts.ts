/*
 * Restart detection (pure). A device has restarted when its start time (time of reading - uptime) moved forward.
 * The time of reading matters: the uptime is read less often than the check runs, and "now - old uptime" would
 * drift forward until it looks like a restart. The start
 * time is kept across adapter restarts, so a restart while the adapter was stopped is found as well, and the first
 * value ever seen is never counted as a restart.
 */

/** Two start times closer than this are the same start (uptime is reported with a delay) */
export const BOOT_TOLERANCE_MS = 120_000;
/** Restarts are counted over this period */
export const RESTART_WINDOW_MS = 7 * 24 * 3_600_000;

/** Stored per device */
interface Entry {
    /** Start time */
    bootAt: number;
    /** Detected restarts (start times) within the window */
    restarts: number[];
}

/** Result for one device */
export interface RestartInfo {
    /** Time of the last start, 0 if unknown */
    lastRestart: number;
    /** Restarts within the last 7 days */
    restartCount7d: number;
    /** A restart was found in this check */
    restarted: boolean;
}

/** Keeps the start times of the devices */
export class RestartTracker {
    private readonly entries = new Map<string, Entry>();

    /**
     * @param stored - JSON of serialize(), may be empty or damaged
     */
    public constructor(stored?: unknown) {
        try {
            const parsed: unknown = typeof stored === 'string' && stored ? JSON.parse(stored) : {};
            for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
                const entry = value as Partial<Entry> | null;
                if (typeof entry?.bootAt === 'number' && Array.isArray(entry.restarts)) {
                    this.entries.set(id, {
                        bootAt: entry.bootAt,
                        restarts: entry.restarts.filter((t): t is number => typeof t === 'number'),
                    });
                }
            }
        } catch {
            // damaged value: start empty, at worst one restart is missed
        }
    }

    /**
     * Checks the uptime of a device.
     *
     * @param id - Device
     * @param uptimeSec - Uptime, undefined if unknown (then nothing changes)
     * @param now - Current time
     * @param readAt - When the uptime was read (default: now)
     */
    public check(id: string, uptimeSec: number | undefined, now = Date.now(), readAt = now): RestartInfo {
        const entry = this.entries.get(id);
        if (uptimeSec === undefined || uptimeSec < 0) {
            return this.info(entry, now, false);
        }
        const bootAt = readAt - uptimeSec * 1000;
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
        // the start time moves a little with each report; keep the earliest of the same start
        entry.bootAt = restarted ? bootAt : Math.min(entry.bootAt, bootAt);
        return this.info(entry, now, restarted);
    }

    /** Value to store */
    public serialize(): string {
        return JSON.stringify(Object.fromEntries(this.entries));
    }

    private info(entry: Entry | undefined, now: number, restarted: boolean): RestartInfo {
        if (!entry) {
            return { lastRestart: 0, restartCount7d: 0, restarted };
        }
        entry.restarts = entry.restarts.filter(t => now - t < RESTART_WINDOW_MS);
        return { lastRestart: Math.round(entry.bootAt), restartCount7d: entry.restarts.length, restarted };
    }
}
