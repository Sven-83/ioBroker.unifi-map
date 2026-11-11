/*
 * Usual speed of each cable uplink (pure). A link is only shown yellow when it gets slower than usual: a link that
 * has always run at 100 Mbit/s (e.g. a powerline adapter with a 100 Mbit/s port) is normal for this network.
 *
 * The usual speed is the highest speed seen so far, starting with the first value. It is kept across adapter
 * restarts. If a link stays slower for good (other cable, other adapter), the user accepts the current speeds.
 */

/** Result for one link */
export interface LinkCheck {
    /** Usual speed in Mbit/s before this value, undefined if the link is new */
    usual: number | undefined;
    /** The link runs slower than usual */
    slower: boolean;
}

/** Keeps the usual speed per device */
export class LinkBaseline {
    private readonly usual = new Map<string, number>();

    /**
     * @param stored - JSON of serialize(), may be empty or damaged
     */
    public constructor(stored?: unknown) {
        try {
            const parsed: unknown = typeof stored === 'string' && stored ? JSON.parse(stored) : {};
            for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
                if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
                    this.usual.set(id, value);
                }
            }
        } catch {
            // damaged value: the current speeds become the usual ones
        }
    }

    /**
     * Checks the current speed of a cable uplink and learns it.
     *
     * @param id - Device
     * @param speedMbps - Current speed; undefined or 0 if unknown (then nothing changes)
     */
    public check(id: string, speedMbps: number | undefined): LinkCheck {
        const usual = this.usual.get(id);
        if (speedMbps === undefined || !(speedMbps > 0)) {
            return { usual, slower: false };
        }
        if (usual === undefined || speedMbps > usual) {
            this.usual.set(id, speedMbps);
        }
        return { usual: usual ?? speedMbps, slower: usual !== undefined && speedMbps < usual };
    }

    /** Forgets all usual speeds: the next values become the usual ones */
    public reset(): void {
        this.usual.clear();
    }

    /** Value to store */
    public serialize(): string {
        return JSON.stringify(Object.fromEntries(this.usual));
    }
}
