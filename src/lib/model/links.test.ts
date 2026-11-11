import { expect } from 'chai';
import { LinkBaseline } from './links';

describe('model/links', () => {
    it('takes the first speed as usual, also a slow one', () => {
        const links = new LinkBaseline();
        expect(links.check('a', 100)).to.deep.equal({ usual: 100, slower: false });
        expect(links.check('a', 100).slower).to.equal(false);
    });

    it('shows a link that gets slower than usual', () => {
        const links = new LinkBaseline();
        links.check('a', 1000);
        expect(links.check('a', 100)).to.deep.equal({ usual: 1000, slower: true });
        // stays yellow while it is slow, green again when it is back
        expect(links.check('a', 100).slower).to.equal(true);
        expect(links.check('a', 1000).slower).to.equal(false);
    });

    it('learns a faster speed as the new usual one', () => {
        const links = new LinkBaseline();
        links.check('a', 100);
        expect(links.check('a', 1000).slower).to.equal(false);
        expect(links.check('a', 100)).to.deep.equal({ usual: 1000, slower: true });
    });

    it('ignores unknown speeds', () => {
        const links = new LinkBaseline();
        links.check('a', 1000);
        expect(links.check('a', undefined)).to.deep.equal({ usual: 1000, slower: false });
        expect(links.check('a', 0).slower).to.equal(false);
        expect(links.check('b', undefined)).to.deep.equal({ usual: undefined, slower: false });
    });

    it('keeps the usual speeds across adapter restarts and survives damaged values', () => {
        const first = new LinkBaseline();
        first.check('a', 1000);
        const later = new LinkBaseline(first.serialize());
        expect(later.check('a', 100).slower).to.equal(true);
        expect(new LinkBaseline('{broken').check('a', 100).slower).to.equal(false);
        expect(new LinkBaseline(JSON.stringify({ a: 'x', b: -1 })).serialize()).to.equal('{}');
    });

    it('accepts the current speeds after a reset', () => {
        const links = new LinkBaseline();
        links.check('a', 1000);
        links.reset();
        expect(links.check('a', 100).slower).to.equal(false);
        expect(links.check('a', 100).slower).to.equal(false);
    });
});
