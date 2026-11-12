/*
 * Layout of the topology map (pure, no DOM): places the tree from the console downwards.
 * Leaves get one column each, a parent sits centred above its children.
 * Used by the admin tab (browser global UnifiMapLayout) and by the unit tests (CommonJS).
 */
(function (/** @type {Record<string, unknown>} */ root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        root.UnifiMapLayout = api;
    }
})(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (globalThis)), function () {
    'use strict';

    /** Size of a device card, column and row distance (SVG units) */
    const SIZE = { width: 132, height: 54, column: 144, row: 88, margin: 6 };
    /** Longest chain followed, so broken data with a loop cannot hang the page */
    const MAX_DEPTH = 32;

    /**
     * Escapes text for HTML and SVG.
     *
     * @param {unknown} value - Any value
     * @returns {string} Safe text
     */
    function esc(value) {
        /** @type {Record<string, string>} */
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
        return String(value ?? '').replace(/[&<>"']/g, c => map[c] || c);
    }

    /**
     * Link speed as short text.
     *
     * @param {number | null | undefined} mbps - Speed in Mbit/s
     * @returns {string} e.g. "1 G", "100 M", "2.5 G"
     */
    function speedText(mbps) {
        if (typeof mbps !== 'number' || !isFinite(mbps) || mbps <= 0) {
            return '';
        }
        return mbps >= 1000 ? `${Math.round(mbps / 100) / 10} G` : `${Math.round(mbps)} M`;
    }

    /**
     * @typedef {{id: string, name: string, uplinkId: string}} MapNode
     * @typedef {{x: number, y: number}} Point
     */

    /**
     * Places all nodes.
     *
     * @param {{rootId?: string, nodes?: MapNode[]} | null | undefined} topology - From topology.json
     * @returns {{pos: Record<string, Point>, unplaced: string[], width: number, height: number}} Centre of each card
     */
    function layout(topology) {
        /** @type {MapNode[]} */
        const nodes = Array.isArray(topology?.nodes) ? topology.nodes : [];
        const byId = new Map(nodes.map(n => [n.id, n]));
        /** @type {Map<string, MapNode[]>} */
        const kids = new Map();
        for (const n of nodes) {
            if (n.id !== topology?.rootId && n.uplinkId && byId.has(n.uplinkId)) {
                if (!kids.has(n.uplinkId)) {
                    kids.set(n.uplinkId, []);
                }
                kids.get(n.uplinkId)?.push(n);
            }
        }
        // stable order: devices with something behind them first, then by name
        for (const list of kids.values()) {
            list.sort(
                (a, b) =>
                    Number(kids.has(b.id)) - Number(kids.has(a.id)) || String(a.name).localeCompare(String(b.name)),
            );
        }
        /** @type {Record<string, Point>} */
        const pos = {};
        let leaf = 0;
        let depthMax = 0;
        /** @param {number} i - Column */
        const x = i => SIZE.margin + SIZE.width / 2 + i * SIZE.column;
        /** @param {number} d - Row */
        const y = d => SIZE.margin + SIZE.height / 2 + d * SIZE.row;
        /**
         * @param {MapNode} node - Node to place with its subtree
         * @param {number} depth - Row
         */
        const place = (node, depth) => {
            depthMax = Math.max(depthMax, depth);
            const children = depth < MAX_DEPTH ? (kids.get(node.id) || []).filter(k => !pos[k.id]) : [];
            pos[node.id] = { x: 0, y: y(depth) };
            if (!children.length) {
                pos[node.id].x = x(leaf++);
                return;
            }
            children.forEach(k => place(k, depth + 1));
            const xs = children.map(k => pos[k.id].x);
            pos[node.id].x = (Math.min(...xs) + Math.max(...xs)) / 2;
        };
        const root = byId.get(topology?.rootId ?? '');
        if (root) {
            place(root, 0);
        }
        // devices without a way to the console: one row below the tree
        const unplaced = nodes.filter(n => !pos[n.id]).map(n => n.id);
        if (unplaced.length) {
            const row = root ? depthMax + 1 : 0;
            depthMax = row;
            unplaced.forEach((id, i) => (pos[id] = { x: x(i), y: y(row) }));
        }
        const columns = Math.max(leaf, unplaced.length, 1);
        return {
            pos,
            unplaced,
            width: SIZE.margin * 2 + SIZE.width + (columns - 1) * SIZE.column,
            height: SIZE.margin * 2 + SIZE.height + depthMax * SIZE.row,
        };
    }

    return { SIZE, esc, speedText, layout };
});
