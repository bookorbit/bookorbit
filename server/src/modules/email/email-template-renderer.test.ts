import { renderTemplate, formatFileSize, TemplateContext } from './email-template-renderer';

describe('EmailTemplateRenderer', () => {
  describe('renderTemplate', () => {
    const context: TemplateContext = {
      title: 'Testing Book',
      author: 'Author Name',
      series: 'Series 1',
      pageCount: 123,
    };

    it('should interpolate single variables', () => {
      const subject = 'Send book: {{title}}';
      const body = 'Author: {{author}}, Series: {{series}}';
      const rendered = renderTemplate(subject, body, context);

      expect(rendered.subject).toBe('Send book: Testing Book');
      expect(rendered.bodyText).toBe('Author: Author Name, Series: Series 1');
    });

    it('should interpolate numeric variables', () => {
      const body = 'Pages: {{pageCount}}';
      const rendered = renderTemplate('', body, context);
      expect(rendered.bodyText).toBe('Pages: 123');
    });

    it('should replace missing variables with empty strings', () => {
      const body = 'Missing: {{missing}} - Null: {{nullField}}';
      const rendered = renderTemplate('', body, { ...context, nullField: null } as any);
      expect(rendered.bodyText).toBe('Missing:  - Null: ');
    });

    it('should handle complex templates', () => {
      const body = '{{title}} by {{author}} is part of {{series}} ({{pageCount}} pages).';
      const rendered = renderTemplate('', body, context);
      expect(rendered.bodyText).toBe('Testing Book by Author Name is part of Series 1 (123 pages).');
    });
  });

  describe('formatFileSize', () => {
    it('should format bytes correctly', () => {
      expect(formatFileSize(500)).toBe('500 B');
    });

    it('should format kilobytes correctly', () => {
      expect(formatFileSize(2048)).toBe('2.0 KB');
      expect(formatFileSize(1024 * 1.5)).toBe('1.5 KB');
    });

    it('should format megabytes correctly', () => {
      expect(formatFileSize(1024 * 1024 * 2.5)).toBe('2.5 MB');
    });

    it('should return empty string for null or zero', () => {
      expect(formatFileSize(null)).toBe('');
      expect(formatFileSize(undefined)).toBe('');
      expect(formatFileSize(0)).toBe('');
    });
  });
});
