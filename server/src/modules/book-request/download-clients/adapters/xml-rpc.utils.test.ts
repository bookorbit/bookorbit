import { decodeMethodResponse, decodeMulticallResults, encodeMethodCall, XmlRpcFault, XmlRpcMalformedError } from './xml-rpc.utils';

/*
 * Every response below was captured verbatim from a live daemon: rTorrent 0.9.8 (xmlrpc-c, pretty
 * printed, `i4` fault codes), rTorrent 0.16.25 (built-in XML-RPC, compact, `i8` fault codes) and
 * ruTorrent's httprpc plugin in front of 0.16.25. The same call is answered in both spellings.
 */
const RT098_MULTICALL = `<?xml version="1.0" encoding="UTF-8"?>
<methodResponse>
<params>
<param><value><array><data>
<value><array><data>
<value><string>Agnes &amp; Friends &lt;Box Set&gt; 'Vol 1'</string></value>
</data></array></value>
<value><array><data>
<value><i8>8693172</i8></value>
</data></array></value>
<value><struct>
<member><name>faultCode</name>
<value><i4>-501</i4></value></member>
<member><name>faultString</name>
<value><string>Could not find info-hash.</string></value></member>
</struct></value>
<value><struct>
<member><name>faultCode</name>
<value><i4>-503</i4></value></member>
<member><name>faultString</name>
<value><string>Could not find view.</string></value></member>
</struct></value>
</data></array></value></param>
</params>
</methodResponse>
`;

const RT016_MULTICALL = `<?xml version="1.0"?><methodResponse><params><param><value><array><data><value><array><data><value><string>Agnes &amp; Friends &lt;Box Set&gt; 'Vol 1'</string></value></data></array></value><value><array><data><value><i8>8693172</i8></value></data></array></value><value><struct><member><name>faultCode</name><value><i8>-500</i8></value></member><member><name>faultString</name><value><string>invalid parameters: info-hash not found</string></value></member></struct></value><value><struct><member><name>faultCode</name><value><i8>-500</i8></value></member><member><name>faultString</name><value><string>Could not find view.</string></value></member></struct></value></data></array></value></param></params></methodResponse>`;

const RT098_FAULT = `<?xml version="1.0" encoding="UTF-8"?>
<methodResponse>
<fault>
<value><struct>
<member><name>faultCode</name>
<value><i4>-501</i4></value></member>
<member><name>faultString</name>
<value><string>Could not find info-hash.</string></value></member>
</struct></value>
</fault>
</methodResponse>
`;

const RT016_FAULT = `<?xml version="1.0"?><methodResponse><fault><value><struct><member><name>faultCode</name><value><i8>-500</i8></value></member><member><name>faultString</name><value><string>invalid parameters: info-hash not found</string></value></member></struct></value></fault></methodResponse>`;

const JESEC_MULTICALL2 = `<?xml version="1.0" encoding="UTF-8"?>
<methodResponse>
<params>
<param><value><array><data>
<value><array><data>
<value><string>35D63D873F37E3276970B9CB981F33A45285C240</string></value>
<value><string>ハルコさんの彼氏.epub</string></value>
</data></array></value>
<value><array><data>
<value><string>849E80BB41D9DA7ACD132165E58243830ABA6CE5</string></value>
<value><string>Agnes &amp; Friends &lt;Box Set&gt; 'Vol 1'</string></value>
</data></array></value>
</data></array></value></param>
</params>
</methodResponse>
`;

const EMPTY_VIEW_098 = `<?xml version="1.0" encoding="UTF-8"?>
<methodResponse>
<params>
<param><value><array><data>
</data></array></value></param>
</params>
</methodResponse>
`;

const EMPTY_VIEW_016 = `<?xml version="1.0"?><methodResponse><params><param><value><array><data/></array></value></param></params></methodResponse>`;

function single(value: string): string {
  return `<?xml version="1.0"?><methodResponse><params><param><value>${value}</value></param></params></methodResponse>`;
}

describe('encodeMethodCall', () => {
  it('spells a call the way rTorrent parses it', () => {
    expect(encodeMethodCall('d.name', ['ABCDEF'])).toBe(
      '<?xml version="1.0"?><methodCall><methodName>d.name</methodName><params><param><value><string>ABCDEF</string></value></param></params></methodCall>',
    );
  });

  it('sends no params element contents for a call without arguments', () => {
    expect(encodeMethodCall('system.client_version', [])).toContain('<params></params>');
  });

  it('escapes markup in strings so a magnet or a path cannot break the document', () => {
    const body = encodeMethodCall('load.start', ['', 'magnet:?xt=urn:btih:abc&dn=A <b> & c']);
    expect(body).toContain('<string>magnet:?xt=urn:btih:abc&amp;dn=A &lt;b&gt; &amp; c</string>');
    expect(body).toContain('<string></string>');
  });

  it('sends a .torrent as base64 and integers as i8', () => {
    const body = encodeMethodCall('load.raw', [Buffer.from('d4:infoe'), 5_000_000_000]);
    expect(body).toContain(`<base64>${Buffer.from('d4:infoe').toString('base64')}</base64>`);
    expect(body).toContain('<i8>5000000000</i8>');
  });

  it('nests the structs and arrays system.multicall takes', () => {
    const body = encodeMethodCall('system.multicall', [[{ methodName: 'd.name', params: ['AB'] }]]);
    expect(body).toContain(
      '<array><data><value><struct><member><name>methodName</name><value><string>d.name</string></value></member><member><name>params</name><value><array><data><value><string>AB</string></value></data></array></value></member></struct></value></data></array>',
    );
  });

  it('refuses text XML cannot carry rather than sending a document the daemon rejects', () => {
    expect(() => encodeMethodCall('d.name', ['a\u0000b'])).toThrow(XmlRpcMalformedError);
  });
});

describe('decodeMethodResponse', () => {
  it('reads a pretty-printed xmlrpc-c answer and a compact one to the same values', () => {
    const pretty = decodeMethodResponse(RT098_MULTICALL) as unknown[];
    const compact = decodeMethodResponse(RT016_MULTICALL) as unknown[];
    expect(pretty.slice(0, 2)).toEqual([["Agnes & Friends <Box Set> 'Vol 1'"], [8693172]]);
    expect(compact.slice(0, 2)).toEqual(pretty.slice(0, 2));
  });

  it('keeps faults inside a multicall as data rather than throwing', () => {
    const decoded = decodeMethodResponse(RT016_MULTICALL);
    expect(Array.isArray(decoded)).toBe(true);
    expect((decoded as unknown[])[2]).toEqual({ faultCode: -500, faultString: 'invalid parameters: info-hash not found' });
  });

  it.each([
    ['0.9.8', RT098_FAULT, -501, 'Could not find info-hash.'],
    ['0.16.25', RT016_FAULT, -500, 'invalid parameters: info-hash not found'],
  ])('throws a top-level fault from rTorrent %s with its own code and reason', (_version, xml, code, reason) => {
    let caught: unknown;
    try {
      decodeMethodResponse(xml);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(XmlRpcFault);
    expect((caught as XmlRpcFault).code).toBe(code);
    expect((caught as XmlRpcFault).reason).toBe(reason);
  });

  it('decodes Unicode and escaped names from a real listing', () => {
    expect(decodeMethodResponse(JESEC_MULTICALL2)).toEqual([
      ['35D63D873F37E3276970B9CB981F33A45285C240', 'ハルコさんの彼氏.epub'],
      ['849E80BB41D9DA7ACD132165E58243830ABA6CE5', "Agnes & Friends <Box Set> 'Vol 1'"],
    ]);
  });

  it.each([
    ['0.9.8', EMPTY_VIEW_098],
    ['0.16.25', EMPTY_VIEW_016],
  ])('reads an empty view from rTorrent %s as an empty list', (_version, xml) => {
    expect(decodeMethodResponse(xml)).toEqual([]);
  });

  it('keeps a hash made only of digits a string, with its leading zeros', () => {
    expect(decodeMethodResponse(single('<string>0012345678901234567890123456789012345678</string>'))).toBe(
      '0012345678901234567890123456789012345678',
    );
  });

  it('keeps leading and trailing spaces in a string', () => {
    expect(decodeMethodResponse(single('<string>  spaced name  </string>'))).toBe('  spaced name  ');
  });

  it('decodes numeric character references once, and only once', () => {
    expect(decodeMethodResponse(single('<string>a&#13;b &#x41; &amp;#38;</string>'))).toBe('a\rb A &#38;');
  });

  it('reads every scalar spelling a dialect may use', () => {
    expect(decodeMethodResponse(single('<i4>-7</i4>'))).toBe(-7);
    expect(decodeMethodResponse(single('<int>42</int>'))).toBe(42);
    expect(decodeMethodResponse(single('<ex:i8>9007199254740991</ex:i8>'))).toBe(9007199254740991);
    expect(decodeMethodResponse(single('<boolean>1</boolean>'))).toBe(true);
    expect(decodeMethodResponse(single('<double>1.5</double>'))).toBe(1.5);
    expect(decodeMethodResponse(single('bare text'))).toBe('bare text');
    expect(decodeMethodResponse(single('<string/>'))).toBe('');
    expect(decodeMethodResponse(single('<nil/>'))).toBeNull();
  });

  it('refuses a DTD rather than expanding its entities', () => {
    const xml =
      '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "AAAA"><!ENTITY b "&a;&a;">]><methodResponse><params><param><value><string>&b;</string></value></param></params></methodResponse>';
    expect(() => decodeMethodResponse(xml)).toThrow(XmlRpcMalformedError);
  });

  it.each([
    ['an nginx error page', '<html><head><title>404 Not Found</title></head><body>nginx</body></html>'],
    ['plain text', 'Forbidden'],
    ['an empty body', ''],
    ['a response with no value', '<methodResponse><params></params></methodResponse>'],
  ])('refuses %s as not XML-RPC', (_case, body) => {
    expect(() => decodeMethodResponse(body)).toThrow(XmlRpcMalformedError);
  });

  it('refuses an integer that is not one, instead of reading it as zero', () => {
    expect(() => decodeMethodResponse(single('<i8>12abc</i8>'))).toThrow(XmlRpcMalformedError);
  });
});

describe('decodeMulticallResults', () => {
  it('splits a multicall answer into values and per-call faults', () => {
    const results = decodeMulticallResults(decodeMethodResponse(RT098_MULTICALL), 4);
    expect(results[0]).toBe("Agnes & Friends <Box Set> 'Vol 1'");
    expect(results[1]).toBe(8693172);
    expect(results[2]).toBeInstanceOf(XmlRpcFault);
    expect((results[2] as XmlRpcFault).reason).toBe('Could not find info-hash.');
    expect((results[3] as XmlRpcFault).code).toBe(-503);
  });

  it('refuses an answer with a different number of slots than calls', () => {
    expect(() => decodeMulticallResults(decodeMethodResponse(RT016_MULTICALL), 3)).toThrow(XmlRpcMalformedError);
  });

  it('refuses a slot that is neither a value nor a fault', () => {
    expect(() => decodeMulticallResults([['a', 'b']], 1)).toThrow(XmlRpcMalformedError);
    expect(() => decodeMulticallResults(['bare'], 1)).toThrow(XmlRpcMalformedError);
  });
});
