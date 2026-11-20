import { load } from 'cheerio';

import type { EpubCoverImage } from './epub-cover-image';

function localName(name: string): string {
  return name.slice(name.lastIndexOf(':') + 1).toLowerCase();
}

function coverDocumentImages(xml: string) {
  const $ = load(xml, { xml: { withStartIndices: true } });
  return $('*')
    .toArray()
    .flatMap((node) => {
      if (!('attribs' in node)) return [];
      const name = localName(node.name);
      if (name !== 'img' && name !== 'image') return [];
      const attributes = name === 'img' ? ['src', 'href', 'xlink:href'] : ['href', 'xlink:href'];
      const attribute = attributes.find((name) => node.attribs[name]);
      return attribute ? [{ node, attribute, href: node.attribs[attribute] }] : [];
    });
}

export function coverDocumentImageHrefs(xml: string): string[] {
  return coverDocumentImages(xml).map(({ href }) => href);
}

function patchOpeningTag(xml: string, offset: number, attributes: Record<string, string>): string {
  // Use the parser's offsets to edit only the affected attributes and preserve the rest of the document.
  const openingTag = /<[^\s/>]+(?:[^"'<>]|"[^"]*"|'[^']*')*>/y;
  openingTag.lastIndex = offset;
  const tag = openingTag.exec(xml)?.[0];
  if (!tag) return xml;

  const updated = tag.replace(/(\s[^\s=/>]+)(\s*=\s*)(["'])([\s\S]*?)\3/g, (match, name: string, equals: string, quote: string) => {
    const attribute = name.slice(1);
    return Object.hasOwn(attributes, attribute) ? `${name}${equals}${quote}${attributes[attribute]}${quote}` : match;
  });
  return xml.slice(0, offset) + updated + xml.slice(offset + tag.length);
}

export function patchCoverDocument(
  xml: string,
  oldHref: string,
  newHref: string | undefined,
  dimensions: EpubCoverImage['dimensions'],
): string | null {
  const image = coverDocumentImages(xml).find((reference) => reference.href === oldHref);
  if (!image || image.node.startIndex === null) return null;

  const updates: Record<string, string> = newHref === undefined ? {} : { [image.attribute]: newHref.replaceAll("'", '%27') };
  const svg = image.node.parent;
  if (dimensions && localName(image.node.name) === 'image' && svg && 'attribs' in svg && localName(svg.name) === 'svg' && svg.startIndex !== null) {
    const viewBox = svg.attribs.viewBox
      ?.trim()
      .split(/[\s,]+/)
      .map(Number);
    const { width, height, x = '0', y = '0', transform } = image.node.attribs;
    // A full-canvas image can be resized with its viewBox. Composed cover art has its own layout.
    const hasOtherArtwork = svg.children.some(
      (child) => 'attribs' in child && child !== image.node && !['title', 'desc'].includes(localName(child.name)),
    );
    if (
      viewBox?.length === 4 &&
      viewBox[0] === 0 &&
      viewBox[1] === 0 &&
      viewBox[2] === Number(width) &&
      viewBox[3] === Number(height) &&
      viewBox[2] > 0 &&
      viewBox[3] > 0 &&
      Number(x) === 0 &&
      Number(y) === 0 &&
      !transform &&
      !hasOtherArtwork &&
      (viewBox[2] !== dimensions.width || viewBox[3] !== dimensions.height)
    ) {
      updates.width = String(dimensions.width);
      updates.height = String(dimensions.height);
      const updatedImage = patchOpeningTag(xml, image.node.startIndex, updates);
      return patchOpeningTag(updatedImage, svg.startIndex, { viewBox: `0 0 ${dimensions.width} ${dimensions.height}` });
    }
  }
  return newHref === undefined ? xml : patchOpeningTag(xml, image.node.startIndex, updates);
}
