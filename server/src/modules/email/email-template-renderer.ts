export interface TemplateContext {
  title?: string | null;
  subtitle?: string | null;
  author?: string | null;
  authors?: string | null;
  series?: string | null;
  seriesName?: string | null;
  seriesIndex?: number | null;
  format?: string | null;
  fileSize?: string | null;
  pageCount?: number | null;
  publisher?: string | null;
  publishedYear?: number | null;
  isbn?: string | null;
  tags?: string | null;
  language?: string | null;
  senderName?: string | null;
  appUrl?: string | null;
  coverUrl?: string | null;
}

export interface RenderedTemplate {
  subject: string;
  bodyText: string;
}

export function renderTemplate(subject: string, bodyText: string, context: TemplateContext): RenderedTemplate {
  return {
    subject: interpolate(subject, context),
    bodyText: interpolate(bodyText, context),
  };
}

function interpolate(template: string, context: TemplateContext): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = (context as Record<string, string | number | null | undefined>)[key];
    if (value === null || value === undefined) return '';
    return typeof value === 'number' ? value.toString() : value;
  });
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
