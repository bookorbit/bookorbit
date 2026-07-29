import {
  Fb2StructureError,
  elementText,
  findElementClose,
  findTagEnd,
  locateElement,
  readAttribute,
  scanChildElements,
  startTagOf,
} from './fb2-element-scanner';

function childNames(xml: string, parent: string): string[] {
  const element = locateElement(xml, parent);
  if (!element) throw new Error(`missing <${parent}>`);
  return scanChildElements(xml, element.contentStart, element.contentEnd).map((child) => child.name);
}

describe('findTagEnd', () => {
  it('finds the end of a simple tag', () => {
    const xml = '<book-title>x</book-title>';
    expect(findTagEnd(xml, 0)).toBe(11);
  });

  it('ignores a > inside a double-quoted attribute value', () => {
    const xml = '<image href="a>b"/>';
    expect(findTagEnd(xml, 0)).toBe(xml.length - 1);
  });

  it('ignores a > inside a single-quoted attribute value', () => {
    const xml = "<image href='a>b'/>";
    expect(findTagEnd(xml, 0)).toBe(xml.length - 1);
  });

  it('throws when the tag never closes', () => {
    expect(() => findTagEnd('<book-title', 0)).toThrow(Fb2StructureError);
  });
});

describe('findElementClose', () => {
  it('matches the outer close when the same element nests', () => {
    const xml = '<sequence name="a"><sequence name="b"/></sequence>';
    const close = findElementClose(xml, 'sequence', xml.indexOf('>') + 1);
    expect(xml.slice(close)).toBe('</sequence>');
  });

  it('does not count self-closing tags as nesting', () => {
    const xml = '<annotation><p/><p/></annotation>';
    const close = findElementClose(xml, 'annotation', xml.indexOf('>') + 1);
    expect(xml.slice(close)).toBe('</annotation>');
  });

  it('tolerates whitespace inside the closing tag', () => {
    const xml = '<lang>en</lang  >';
    expect(findElementClose(xml, 'lang', 6)).toBe(8);
  });

  it('ignores markup that only appears inside a comment', () => {
    const xml = '<annotation><!-- </annotation> --><p>real</p></annotation>';
    const close = findElementClose(xml, 'annotation', xml.indexOf('>') + 1);
    expect(xml.slice(close)).toBe('</annotation>');
  });

  it('ignores markup that only appears inside CDATA', () => {
    const xml = '<program-used><![CDATA[</program-used>]]></program-used>';
    const close = findElementClose(xml, 'program-used', xml.indexOf('>') + 1);
    expect(xml.slice(close)).toBe('</program-used>');
  });

  it('throws when the element never closes', () => {
    expect(() => findElementClose('<description><title-info>', 'description', 13)).toThrow(/unclosed <description>/);
  });

  it('throws on an unterminated comment', () => {
    expect(() => findElementClose('<annotation><!-- oops', 'annotation', 12)).toThrow(/unterminated comment/);
  });
});

describe('scanChildElements', () => {
  it('lists children in document order', () => {
    const xml = '<title-info><genre>sf</genre><author><nickname>a</nickname></author><book-title>T</book-title></title-info>';
    expect(childNames(xml, 'title-info')).toEqual(['genre', 'author', 'book-title']);
  });

  it('includes repeated and self-closing children', () => {
    const xml = '<title-info><genre>a</genre><genre>b</genre><sequence name="s"/><lang>en</lang></title-info>';
    expect(childNames(xml, 'title-info')).toEqual(['genre', 'genre', 'sequence', 'lang']);
  });

  it('skips comments, CDATA and processing instructions between children', () => {
    const xml = '<description><!-- note --><?pi data?><title-info/><![CDATA[raw]]><document-info/></description>';
    expect(childNames(xml, 'description')).toEqual(['title-info', 'document-info']);
  });

  it('does not descend into grandchildren', () => {
    const xml = '<description><title-info><genre>sf</genre></title-info></description>';
    expect(childNames(xml, 'description')).toEqual(['title-info']);
  });

  it('reports spans that slice back to the original text', () => {
    const xml = '<title-info><genre>sf</genre><book-title>T &amp; U</book-title></title-info>';
    const parent = locateElement(xml, 'title-info')!;
    const children = scanChildElements(xml, parent.contentStart, parent.contentEnd);
    expect(elementText(xml, children[1])).toBe('<book-title>T &amp; U</book-title>');
    expect(xml.slice(children[1].contentStart, children[1].contentEnd)).toBe('T &amp; U');
  });

  it('stops at the parent closing tag', () => {
    const xml = '<description><title-info/></description><body><section/></body>';
    expect(childNames(xml, 'description')).toEqual(['title-info']);
  });
});

describe('locateElement', () => {
  it('does not match an element whose name only shares a prefix', () => {
    const xml = '<description-extra/><description><title-info/></description>';
    const found = locateElement(xml, 'description')!;
    expect(found.start).toBe(xml.indexOf('<description>'));
  });

  it('handles a self-closing element', () => {
    const found = locateElement('<coverpage><image href="#c"/></coverpage>', 'image')!;
    expect(found.selfClosing).toBe(true);
    expect(found.contentStart).toBe(-1);
  });

  it('returns null when the element is absent', () => {
    expect(locateElement('<description><title-info/></description>', 'publish-info')).toBeNull();
  });

  it('searches from the requested offset', () => {
    const xml = '<lang>en</lang><src-title-info><lang>ru</lang></src-title-info>';
    const second = locateElement(xml, 'lang', 15)!;
    expect(xml.slice(second.contentStart, second.contentEnd)).toBe('ru');
  });
});

describe('readAttribute', () => {
  it('reads double and single quoted values', () => {
    expect(readAttribute('<image l:href="#img_0"/>', 'l:href')).toBe('#img_0');
    expect(readAttribute("<image l:href='#img_0'/>", 'l:href')).toBe('#img_0');
  });

  it('is case insensitive on the attribute name', () => {
    expect(readAttribute('<binary ID="cover.jpg">', 'id')).toBe('cover.jpg');
  });

  it('does not confuse an attribute whose name ends with the requested one', () => {
    expect(readAttribute('<binary xml:id="a" id="b">', 'id')).toBe('b');
  });

  it('returns null for a missing attribute', () => {
    expect(readAttribute('<binary id="a">', 'content-type')).toBeNull();
  });

  it('reads an empty value', () => {
    expect(readAttribute('<sequence name=""/>', 'name')).toBe('');
  });
});

describe('startTagOf', () => {
  it('returns only the opening tag with its attributes', () => {
    const xml = '<title-info xml:lang="ru"><genre>sf</genre></title-info>';
    const element = locateElement(xml, 'title-info')!;
    expect(startTagOf(xml, element)).toBe('<title-info xml:lang="ru">');
  });
});
