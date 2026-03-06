import { isIdentifiable, MetadataProvider } from './metadata-provider';
import { MetadataProviderKey } from '@projectx/types';

describe('MetadataProvider Utils', () => {
  describe('isIdentifiable', () => {
    it('should return true for identifiable providers', () => {
      const p: MetadataProvider = {
        key: MetadataProviderKey.GOOGLE,
        label: 'Google',
        identifiable: true,
        search: jest.fn(),
      };
      expect(isIdentifiable(p)).toBe(true);
    });

    it('should return false for non-identifiable providers', () => {
      const p: MetadataProvider = {
        key: MetadataProviderKey.AMAZON,
        label: 'Amazon',
        identifiable: false,
        search: jest.fn(),
      };
      expect(isIdentifiable(p)).toBe(false);
    });
  });
});
