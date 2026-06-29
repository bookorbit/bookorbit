import { BadRequestException } from '@nestjs/common';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import { CUSTOM_ICON_MAX_FILE_SIZE } from '@bookorbit/types';

const ALLOWED_TAGS = new Set([
  'svg',
  'g',
  'path',
  'circle',
  'rect',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'defs',
  'clipPath',
  'linearGradient',
  'radialGradient',
  'stop',
  'mask',
  'pattern',
]);
const ALLOWED_ATTRS = new Set([
  'aria-hidden',
  'class',
  'clip-path',
  'clip-rule',
  'cx',
  'cy',
  'd',
  'fill',
  'fill-opacity',
  'fill-rule',
  'gradientTransform',
  'gradientUnits',
  'height',
  'id',
  'linecap',
  'linejoin',
  'mask',
  'offset',
  'opacity',
  'patternTransform',
  'patternUnits',
  'points',
  'r',
  'rx',
  'ry',
  'stop-color',
  'stop-opacity',
  'stroke',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-opacity',
  'stroke-width',
  'transform',
  'viewBox',
  'width',
  'x',
  'x1',
  'x2',
  'xmlns',
  'y',
  'y1',
  'y2',
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
});

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  suppressEmptyNode: true,
});

export function sanitizeSvgIcon(bytes: Buffer): string {
  const raw = stripSafePreamble(bytes.toString('utf8').trim());
  if (!raw) throw new BadRequestException('SVG file is empty');
  if (raw.length > CUSTOM_ICON_MAX_FILE_SIZE) throw new BadRequestException('SVG file is too large');
  if (!/<svg[\s>]/i.test(raw)) throw new BadRequestException('File must contain an SVG root element');
  if (/<!entity|<!\[CDATA|<script|<foreignObject|<image|<iframe|<object|<embed|<style|<use/i.test(raw)) {
    throw new BadRequestException('SVG contains unsupported or unsafe elements');
  }

  let parsed: unknown;
  try {
    parsed = parser.parse(raw);
  } catch {
    throw new BadRequestException('SVG could not be parsed');
  }

  if (!isRecord(parsed) || !isRecord(parsed.svg)) {
    throw new BadRequestException('SVG root element is required');
  }

  const svg = sanitizeNode('svg', parsed.svg);
  if (!isRecord(svg) || typeof svg['@_viewBox'] !== 'string') {
    throw new BadRequestException('SVG viewBox is required');
  }

  const sanitized = builder.build({ svg });
  return sanitized.startsWith('<svg') ? sanitized : sanitized.replace(/^<\?xml[^>]*>/, '').trim();
}

function sanitizeNode(tag: string, node: unknown): unknown {
  if (!ALLOWED_TAGS.has(tag)) {
    throw new BadRequestException(`SVG element <${tag}> is not supported`);
  }
  if (typeof node === 'string') {
    if (node.trim()) throw new BadRequestException('SVG text nodes are not supported');
    return {};
  }
  if (!isRecord(node)) return {};

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === '#text') {
      if (typeof value === 'string' && value.trim()) throw new BadRequestException('SVG text nodes are not supported');
      continue;
    }
    if (key.startsWith('@_')) {
      const attr = key.slice(2);
      if (attr === 'style') {
        applyStyleAttribute(result, value);
        continue;
      }
      if (!isAllowedAttribute(attr, value)) continue;
      let finalValue = value;
      if (attr === 'fill' || attr === 'stroke') {
        const lower = String(value).toLowerCase();
        if (lower === 'black' || lower === '#000000' || lower === '#000') {
          finalValue = 'currentColor';
        }
      }
      result[key] = finalValue;
      continue;
    }
    if (!ALLOWED_TAGS.has(key)) {
      if (key === 'title' || key === 'desc') continue;
      throw new BadRequestException(`SVG element <${key}> is not supported`);
    }
    result[key] = Array.isArray(value) ? value.map((child) => sanitizeNode(key, child)) : sanitizeNode(key, value);
  }

  return result;
}

function isAllowedAttribute(attr: string, value: unknown): boolean {
  const normalized = attr.trim();
  if (normalized.toLowerCase().startsWith('on')) return false;
  if (normalized.includes(':')) return false;
  if (!ALLOWED_ATTRS.has(normalized)) return false;
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  const text = String(value);
  if (/javascript:|data:|<|>/i.test(text)) return false;
  if (/url\s*\(/i.test(text)) {
    // Only allow local URL references (e.g., url(#some-id))
    if (!/url\s*\(\s*['"]?#[a-zA-Z0-9_-]+['"]?\s*\)/i.test(text)) {
      return false;
    }
  }
  return true;
}

function applyStyleAttribute(result: Record<string, unknown>, value: unknown): void {
  if (typeof value !== 'string') return;
  for (const declaration of value.split(';')) {
    const separatorIndex = declaration.indexOf(':');
    if (separatorIndex === -1) continue;
    const attr = declaration.slice(0, separatorIndex).trim();
    let attrValue = declaration.slice(separatorIndex + 1).trim();
    if (attr === 'fill' || attr === 'stroke') {
      const lower = attrValue.toLowerCase();
      if (lower === 'black' || lower === '#000000' || lower === '#000') {
        attrValue = 'currentColor';
      }
    }
    const key = `@_${attr}`;
    if (!result[key] && isAllowedAttribute(attr, attrValue)) {
      result[key] = attrValue;
    }
  }
}

function stripSafePreamble(value: string): string {
  if (/<!doctype[\s\S]*\[/i.test(value)) {
    throw new BadRequestException('SVG doctype subsets are not supported');
  }
  return value
    .replace(/^\uFEFF/, '')
    .replace(/<\?xml[^>]*\?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
