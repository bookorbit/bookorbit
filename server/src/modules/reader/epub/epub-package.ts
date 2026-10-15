import { XMLParser } from 'fast-xml-parser';

const OPF_NAMESPACE = 'http://www.idpf.org/2007/opf';
const DUBLIN_CORE_NAMESPACE = 'http://purl.org/dc/elements/1.1/';

interface OrderedXmlNode {
  [name: string]: unknown;
  ':@'?: Record<string, string>;
  '#text'?: string;
}

const packageParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  preserveOrder: true,
  parseTagValue: false,
});

function normalizePackageElements(nodes: OrderedXmlNode[], inheritedNamespaces: ReadonlyMap<string, string>): Record<string, unknown> {
  const result = Object.create(null) as Record<string, unknown>;
  for (const node of nodes) {
    if (node['#text'] !== undefined) {
      result['#text'] = ((result['#text'] as string | undefined) ?? '') + node['#text'];
      continue;
    }
    const attributes = node[':@'] ?? {};
    const namespaces = new Map(inheritedNamespaces);
    for (const [name, value] of Object.entries(attributes)) {
      if (name === '@_xmlns') namespaces.set('', value);
      else if (name.startsWith('@_xmlns:')) namespaces.set(name.slice('@_xmlns:'.length), value);
    }
    for (const [qualifiedName, children] of Object.entries(node)) {
      if (!Array.isArray(children)) continue;
      const colon = qualifiedName.indexOf(':');
      const prefix = colon < 0 ? '' : qualifiedName.slice(0, colon);
      const localName = colon < 0 ? qualifiedName : qualifiedName.slice(colon + 1);
      const namespace = namespaces.get(prefix);
      let name: string;
      if (namespace === OPF_NAMESPACE || (!prefix && !namespace)) name = localName;
      else if (namespace === DUBLIN_CORE_NAMESPACE) name = `dc:${localName}`;
      else continue;

      const content = normalizePackageElements(children as OrderedXmlNode[], namespaces);
      const value = Object.keys(attributes).length
        ? { ...content, ...attributes }
        : Object.keys(content).every((key) => key === '#text')
          ? (content['#text'] ?? '')
          : content;
      if (!Object.hasOwn(result, name)) result[name] = value;
      else if (Array.isArray(result[name])) (result[name] as unknown[]).push(value);
      else result[name] = [result[name], value];
    }
  }
  return result;
}

export function parseEpubPackage(xml: string | Buffer): Record<string, unknown> {
  // Resolve namespaces before grouping aliases, preserving creator order and excluding foreign lookalikes.
  const document = normalizePackageElements(packageParser.parse(xml) as OrderedXmlNode[], new Map());
  const pkg = document['package'];
  return pkg && typeof pkg === 'object' && !Array.isArray(pkg) ? (pkg as Record<string, unknown>) : {};
}
