import { imageContentTypeFromExtension, imageContentTypeFromPath } from './image-content-type';

describe('image content type helpers', () => {
  describe('imageContentTypeFromPath', () => {
    it('returns image/png for png file paths', () => {
      expect(imageContentTypeFromPath('/tmp/cover.png')).toBe('image/png');
    });

    it('returns image/webp for webp file paths', () => {
      expect(imageContentTypeFromPath('/tmp/cover.webp')).toBe('image/webp');
    });

    it('falls back to image/jpeg for unknown extensions', () => {
      expect(imageContentTypeFromPath('/tmp/cover.unknown')).toBe('image/jpeg');
    });
  });

  describe('imageContentTypeFromExtension', () => {
    it('normalizes extension case', () => {
      expect(imageContentTypeFromExtension('.PNG')).toBe('image/png');
    });

    it('returns image/jpeg for jpeg aliases', () => {
      expect(imageContentTypeFromExtension('.jpg')).toBe('image/jpeg');
      expect(imageContentTypeFromExtension('.jpeg')).toBe('image/jpeg');
    });
  });
});
