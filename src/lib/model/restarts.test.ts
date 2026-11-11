import { expect } from 'chai';
import { BOOT_TOLERANCE_MS, RESTART_WINDOW_MS, RestartTracker } from './restarts';

const T0 = 1_800_000_000_000;

describe('model/restarts', () => {
    it('does not count the first value as a restart', () => {
        const tracker = new RestartTracker();
        const info = tracker.check('a', 3600, T0);
        expect(info).to.deep.equal({ lastRestart: T0 - 3_600_000, restartCount7d: 0, restarted: false });
    });

    it('finds a restart when the uptime starts again', () => {
        const tracker = new RestartTracker();
        tracker.check('a', 3600, T0);
        tracker.check('a', 3660, T0 + 60_000);
        const info = tracker.check('a', 30, T0 + 120_000);
        expect(info.restarted).to.equal(true);
        expect(info.restartCount7d).to.equal(1);
        expect(info.lastRestart).to.equal(T0 + 90_000);
    });

    it('ignores the small shift of the start time from delayed reports', () => {
        const tracker = new RestartTracker();
        tracker.check('a', 3600, T0);
        const info = tracker.check('a', 3600, T0 + BOOT_TOLERANCE_MS - 1000);
        expect(info.restarted).to.equal(false);
    });

    it('does not drift into a restart when the uptime is read less often than checked', () => {
        // uptime read every 5 minutes, checked every minute: the same reading must keep the same start time
        const tracker = new RestartTracker();
        let restarts = 0;
        for (let minute = 0; minute <= 30; minute++) {
            const readAt = T0 + Math.floor(minute / 5) * 300_000;
            const uptime = 3600 + (readAt - T0) / 1000;
            restarts += tracker.check('a', uptime, T0 + minute * 60_000, readAt).restarted ? 1 : 0;
        }
        expect(restarts).to.equal(0);
        expect(tracker.check('a', 20, T0 + 31 * 60_000, T0 + 31 * 60_000).restarted).to.equal(true);
    });

    it('finds a restart that happened while the adapter was stopped', () => {
        const first = new RestartTracker();
        first.check('a', 3600, T0);
        const later = new RestartTracker(first.serialize());
        const info = later.check('a', 600, T0 + 86_400_000);
        expect(info.restarted).to.equal(true);
        expect(info.restartCount7d).to.equal(1);
    });

    it('does not count a restart again after an adapter restart', () => {
        const first = new RestartTracker();
        first.check('a', 3600, T0);
        first.check('a', 10, T0 + 600_000);
        const later = new RestartTracker(first.serialize());
        const info = later.check('a', 70, T0 + 660_000);
        expect(info.restarted).to.equal(false);
        expect(info.restartCount7d).to.equal(1);
    });

    it('counts restarts of the last 7 days only', () => {
        const tracker = new RestartTracker();
        tracker.check('a', 100, T0);
        tracker.check('a', 10, T0 + 1_000_000);
        tracker.check('a', 10, T0 + 2_000_000);
        expect(tracker.check('a', 20, T0 + 2_010_000).restartCount7d).to.equal(2);
        const info = tracker.check('a', RESTART_WINDOW_MS / 1000, T0 + 2_000_000 + RESTART_WINDOW_MS + 10_000);
        expect(info.restartCount7d).to.equal(0);
    });

    it('keeps the values when the uptime is unknown', () => {
        const tracker = new RestartTracker();
        tracker.check('a', 3600, T0);
        expect(tracker.check('a', undefined, T0 + 60_000)).to.deep.equal({
            lastRestart: T0 - 3_600_000,
            restartCount7d: 0,
            restarted: false,
        });
        expect(tracker.check('b', undefined, T0).lastRestart).to.equal(0);
    });

    it('starts empty with a damaged stored value', () => {
        expect(new RestartTracker('{broken').check('a', 10, T0).restarted).to.equal(false);
        expect(new RestartTracker('{"a":{"bootAt":"x"}}').check('a', 10, T0).restarted).to.equal(false);
    });
});
