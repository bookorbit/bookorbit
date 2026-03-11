import { PROJECTX_NS_PREFIX, PROJECTX_NS_URI } from './projectx-ns';

describe('projectx namespace constants', () => {
  it('use stable namespace prefix and uri for metadata compatibility', () => {
    expect(PROJECTX_NS_PREFIX).toBe('projectx');
    expect(PROJECTX_NS_URI).toBe('https://projectx.app/metadata/1.0/');
  });
});
