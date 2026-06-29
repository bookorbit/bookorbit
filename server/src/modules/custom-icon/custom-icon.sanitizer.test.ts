import { BadRequestException } from '@nestjs/common';
import { CUSTOM_ICON_MAX_FILE_SIZE } from '@bookorbit/types';
import { describe, expect, it } from 'vitest';

import { sanitizeSvgIcon } from './custom-icon.sanitizer';

describe('sanitizeSvgIcon', () => {
  it('keeps safe icon geometry and removes unsupported attributes', () => {
    const svg = Buffer.from('<svg viewBox="0 0 24 24" width="24" onclick="alert(1)"><path d="M4 4h16v16H4z" stroke="currentColor"/></svg>');

    const sanitized = sanitizeSvgIcon(svg);

    expect(sanitized).toContain('<svg');
    expect(sanitized).toContain('viewBox="0 0 24 24"');
    expect(sanitized).toContain('<path');
    expect(sanitized).toContain('stroke="currentColor"');
    expect(sanitized).not.toContain('onclick');
  });

  it('rejects scriptable svg content', () => {
    expect(() => sanitizeSvgIcon(Buffer.from('<svg viewBox="0 0 24 24"><script>alert(1)</script></svg>'))).toThrow(BadRequestException);
  });

  it('accepts safe SVGRepo-style preamble and flattens style attribute', () => {
    const svg = Buffer.from(`
      <?xml version="1.0" encoding="iso-8859-1"?>
      <!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.0//EN" "http://www.w3.org/TR/2001/REC-SVG-20010904/DTD/svg10.dtd">
      <!-- Uploaded to: SVG Repo -->
      <svg version="1.0" xmlns="http://www.w3.org/2000/svg" width="800px" height="800px" viewBox="0 0 24 24" xml:space="preserve">
        <g id="Free_Icons">
          <line style="fill:none;stroke:#000000;stroke-linecap:round;stroke-linejoin:round;stroke-miterlimit:10;" x1="12.5" y1="23.5" x2="12.5" y2="9.5"/>
        </g>
      </svg>
    `);

    const sanitized = sanitizeSvgIcon(svg);

    expect(sanitized).toContain('<svg');
    expect(sanitized).toContain('viewBox="0 0 24 24"');
    // black (#000000) is rewritten to currentColor for theme compatibility
    expect(sanitized).toContain('stroke="currentColor"');
    expect(sanitized).toContain('stroke-linecap="round"');
    expect(sanitized).toContain('stroke-miterlimit="10"');
    expect(sanitized).not.toContain('DOCTYPE');
    // style= attribute is flattened into individual presentation attributes
    expect(sanitized).not.toContain('style=');
  });

  it('rejects doctype subsets', () => {
    expect(() => sanitizeSvgIcon(Buffer.from('<!DOCTYPE svg [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]><svg viewBox="0 0 24 24"></svg>'))).toThrow(
      BadRequestException,
    );
  });

  it('requires an svg viewBox', () => {
    expect(() => sanitizeSvgIcon(Buffer.from('<svg><path d="M0 0h1v1z"/></svg>'))).toThrow(BadRequestException);
  });

  it('rejects an empty buffer', () => {
    expect(() => sanitizeSvgIcon(Buffer.alloc(0))).toThrow(BadRequestException);
  });

  it('rejects a buffer exceeding the max file size', () => {
    const oversized = Buffer.alloc(CUSTOM_ICON_MAX_FILE_SIZE + 1, 'x');
    expect(() => sanitizeSvgIcon(oversized)).toThrow(BadRequestException);
  });

  it('rejects foreignObject elements', () => {
    expect(() =>
      sanitizeSvgIcon(
        Buffer.from('<svg viewBox="0 0 24 24"><foreignObject><body xmlns="http://www.w3.org/1999/xhtml">x</body></foreignObject></svg>'),
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects use elements', () => {
    expect(() => sanitizeSvgIcon(Buffer.from('<svg viewBox="0 0 24 24"><use href="#icon"/></svg>'))).toThrow(BadRequestException);
  });

  it('converts black fill to currentColor', () => {
    const sanitized = sanitizeSvgIcon(Buffer.from('<svg viewBox="0 0 24 24"><path d="M0 0" fill="black"/></svg>'));
    expect(sanitized).toContain('fill="currentColor"');
    expect(sanitized).not.toContain('fill="black"');
  });

  it('converts #000 fill to currentColor', () => {
    const sanitized = sanitizeSvgIcon(Buffer.from('<svg viewBox="0 0 24 24"><path d="M0 0" fill="#000"/></svg>'));
    expect(sanitized).toContain('fill="currentColor"');
  });

  it('strips on* event handler attributes', () => {
    const sanitized = sanitizeSvgIcon(
      Buffer.from('<svg viewBox="0 0 24 24"><path d="M0 0" fill="red" onmouseover="alert(1)" onclick="evil()"/></svg>'),
    );
    expect(sanitized).not.toContain('onmouseover');
    expect(sanitized).not.toContain('onclick');
    expect(sanitized).toContain('fill="red"');
  });

  it('blocks external url() references in fill', () => {
    const sanitized = sanitizeSvgIcon(Buffer.from('<svg viewBox="0 0 24 24"><path d="M0 0" fill="url(https://evil.com/img.svg)"/></svg>'));
    expect(sanitized).not.toContain('url(https://evil.com');
  });

  it('allows local url(#id) references', () => {
    const sanitized = sanitizeSvgIcon(
      Buffer.from(
        '<svg viewBox="0 0 24 24"><defs><clipPath id="clip"><rect width="24" height="24"/></clipPath></defs><path d="M0 0" clip-path="url(#clip)"/></svg>',
      ),
    );
    expect(sanitized).toContain('url(#clip)');
  });

  it('rejects a file that is not an svg element', () => {
    expect(() => sanitizeSvgIcon(Buffer.from('<html><body>not svg</body></html>'))).toThrow(BadRequestException);
  });
});
