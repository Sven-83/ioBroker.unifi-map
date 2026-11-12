import { expect } from 'chai';

// the layout runs in the admin tab (plain browser script), the tests load it as CommonJS
// eslint-disable-next-line @typescript-eslint/no-require-imports
const L = require('../../../admin/map-layout.js') as {
    SIZE: { width: number; height: number; column: number; row: number; margin: number };
    esc: (v: unknown) => string;
    speedText: (v: unknown) => string;
    layout: (t: unknown) => {
        pos: Record<string, { x: number; y: number }>;
        unplaced: string[];
        width: number;
        height: number;
    };
};

const node = (id: string, uplinkId = '', name = id): { id: string; name: string; uplinkId: string } => ({
    id,
    name,
    uplinkId,
});

describe('admin/map-layout', () => {
    it('puts the console on top and a parent centred above its children', () => {
        const { pos, unplaced } = L.layout({
            rootId: 'gw',
            nodes: [node('gw'), node('sw', 'gw'), node('ap1', 'sw'), node('ap2', 'sw')],
        });
        expect(unplaced).to.deep.equal([]);
        expect(pos.gw.y).to.be.below(pos.sw.y);
        expect(pos.sw.y).to.be.below(pos.ap1.y);
        expect(pos.ap1.y).to.equal(pos.ap2.y);
        expect(pos.sw.x).to.equal((pos.ap1.x + pos.ap2.x) / 2);
    });

    it('never puts two cards on the same place', () => {
        const nodes = [node('gw'), node('a', 'gw'), node('b', 'gw'), node('c', 'a'), node('d', 'a'), node('e', 'b')];
        const { pos } = L.layout({ rootId: 'gw', nodes });
        const places = Object.values(pos).map(p => `${p.x}/${p.y}`);
        expect(new Set(places).size).to.equal(nodes.length);
    });

    it('keeps everything inside the reported size', () => {
        const nodes = [node('gw'), node('a', 'gw'), node('b', 'a'), node('c', 'b'), node('d', 'gw')];
        const { pos, width, height } = L.layout({ rootId: 'gw', nodes });
        for (const p of Object.values(pos)) {
            expect(p.x - L.SIZE.width / 2).to.be.at.least(0);
            expect(p.x + L.SIZE.width / 2).to.be.at.most(width);
            expect(p.y + L.SIZE.height / 2).to.be.at.most(height);
        }
    });

    it('shows devices without a way to the console in an extra row', () => {
        const { pos, unplaced } = L.layout({
            rootId: 'gw',
            nodes: [node('gw'), node('a', 'gw'), node('lost', 'gone')],
        });
        expect(unplaced).to.deep.equal(['lost']);
        expect(pos.lost.y).to.be.above(pos.a.y);
    });

    it('survives a loop in broken data', () => {
        const { unplaced } = L.layout({ rootId: 'gw', nodes: [node('gw'), node('a', 'b'), node('b', 'a')] });
        expect(unplaced).to.have.members(['a', 'b']);
    });

    it('copes with missing data', () => {
        expect(L.layout({ rootId: '', nodes: [] }).unplaced).to.deep.equal([]);
        expect(L.layout(null).unplaced).to.deep.equal([]);
    });

    it('escapes names', () => {
        expect(L.esc('<b onclick="x">A & B\'s</b>')).to.equal(
            '&lt;b onclick=&quot;x&quot;&gt;A &amp; B&#39;s&lt;/b&gt;',
        );
        expect(L.esc(null)).to.equal('');
    });

    it('writes speeds short', () => {
        expect(L.speedText(1000)).to.equal('1 G');
        expect(L.speedText(2500)).to.equal('2.5 G');
        expect(L.speedText(100)).to.equal('100 M');
        expect(L.speedText(0)).to.equal('');
        expect(L.speedText(null)).to.equal('');
    });
});
