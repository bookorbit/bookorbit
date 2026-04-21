import { BOOKORBIT_NS_PREFIX, BOOKORBIT_NS_URI } from './bookorbit-ns';

describe('bookorbit namespace constants', () => {
  it('use stable namespace prefix and uri for metadata compatibility', () => {
    expect(BOOKORBIT_NS_PREFIX).toBe('bookorbit');
    expect(BOOKORBIT_NS_URI).toBe('https://bookorbit.app/metadata/1.0/');
  });
});
