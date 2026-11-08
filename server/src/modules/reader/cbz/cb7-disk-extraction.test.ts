import { cb7PagePath } from './cb7-disk-extraction';

describe('cb7PagePath', () => {
  it('keeps nested pages inside the private extraction directory', () => {
    expect(cb7PagePath('/tmp/bookorbit-cb7-test', 'chapter/001.jpg')).toBe('/tmp/bookorbit-cb7-test/chapter/001.jpg');
  });

  it.each(['../outside.jpg', '/tmp/outside.jpg'])('rejects an extracted page path outside the private directory: %s', (path) => {
    expect(() => cb7PagePath('/tmp/bookorbit-cb7-test', path)).toThrow('CB7 page escaped its extraction directory');
  });
});
