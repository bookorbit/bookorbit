import { isIdentifiable, MetadataProvider } from './metadata-provider';
import { MetadataProviderKey } from '@bookorbit/types';

describe('MetadataProvider Utils', () => {
  describe('isIdentifiable', () => {
    it('should return true for identifiable providers', () => {
      const p: MetadataProvider = {
        key: MetadataProviderKey.GOOGLE,
        label: 'Google',
        identifiable: true,
        search: vi.fn(),
      };
      expect(isIdentifiable(p)).toBe(true);
    });

    it('should return false for non-identifiable providers', () => {
      const p: MetadataProvider = {
        key: MetadataProviderKey.AMAZON,
        label: 'Amazon',
        identifiable: false,
        search: vi.fn(),
      };
      expect(isIdentifiable(p)).toBe(false);
    });
  });
});
