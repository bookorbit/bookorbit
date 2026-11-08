import { BadRequestException, Logger, ServiceUnavailableException } from '@nestjs/common';

import type { ResolvedClientConfig } from '../download-client-adapter';
import type { DownloadContentRemovalService } from '../download-content-removal.service';
import { RtorrentAdapter } from './rtorrent.adapter';
import { decodeMethodResponse, encodeMethodCall, type XmlRpcParam, type XmlRpcStruct, type XmlRpcValue } from './xml-rpc.utils';

const AGNES = '849e80bb41d9da7acd132165e58243830aba6ce5';
const HARUKO_UNREGISTERED = 'd33f4da500920381ecc282be8ef3bc609a574b8c';
const UNKNOWN = '0000000000000000000000000000000000000000';
const MURDERBOT = 'a5db0b1b5576dd3f8b9b8ee5d417ef0fad73f1d5';

/**
 * Captured verbatim from rTorrent 0.16.25 behind Basic auth: the status multicall for a finished
 * multi-file torrent its move-on-complete hook had already moved, a torrent its tracker had
 * deleted, and a hash it does not hold, in that order.
 */
const RT016_STATUS = `<?xml version="1.0"?><methodResponse><params><param><value><array><data><value><array><data><value><string>Agnes &amp; Friends &lt;Box Set&gt; 'Vol 1'</string></value></data></array></value><value><array><data><value><i8>8693172</i8></value></data></array></value><value><array><data><value><i8>8693172</i8></value></data></array></value><value><array><data><value><i8>1</i8></value></data></array></value><value><array><data><value><i8>1</i8></value></data></array></value><value><array><data><value><i8>1</i8></value></data></array></value><value><array><data><value><i8>1</i8></value></data></array></value><value><array><data><value><i8>0</i8></value></data></array></value><value><array><data><value><string></string></value></data></array></value><value><array><data><value><string>/downloads/complete/bookorbit/Agnes &amp; Friends &lt;Box Set&gt; 'Vol 1'</string></value></data></array></value><value><array><data><value><string>/downloads/complete/bookorbit/Agnes &amp; Friends &lt;Box Set&gt; 'Vol 1'</string></value></data></array></value><value><array><data><value><i8>1</i8></value></data></array></value><value><array><data><value><i8>209</i8></value></data></array></value><value><array><data><value><i8>1818624</i8></value></data></array></value><value><array><data><value><i8>1793955498</i8></value></data></array></value><value><array><data><value><string>ハルコさんの彼氏.epub</string></value></data></array></value><value><array><data><value><i8>2247393</i8></value></data></array></value><value><array><data><value><i8>0</i8></value></data></array></value><value><array><data><value><i8>0</i8></value></data></array></value><value><array><data><value><i8>1</i8></value></data></array></value><value><array><data><value><i8>1</i8></value></data></array></value><value><array><data><value><i8>1</i8></value></data></array></value><value><array><data><value><i8>0</i8></value></data></array></value><value><array><data><value><string>Tracker: [v4 : Failure reason "Unregistered torrent"]</string></value></data></array></value><value><array><data><value><string>/downloads/temp/ハルコさんの彼氏.epub</string></value></data></array></value><value><array><data><value><string>/downloads/temp</string></value></data></array></value><value><array><data><value><i8>0</i8></value></data></array></value><value><array><data><value><i8>0</i8></value></data></array></value><value><array><data><value><i8>0</i8></value></data></array></value><value><array><data><value><i8>0</i8></value></data></array></value><value><struct><member><name>faultCode</name><value><i8>-500</i8></value></member><member><name>faultString</name><value><string>invalid parameters: info-hash not found</string></value></member></struct></value><value><struct><member><name>faultCode</name><value><i8>-500</i8></value></member><member><name>faultString</name><value><string>invalid parameters: info-hash not found</string></value></member></struct></value><value><struct><member><name>faultCode</name><value><i8>-500</i8></value></member><member><name>faultString</name><value><string>invalid parameters: info-hash not found</string></value></member></struct></value><value><struct><member><name>faultCode</name><value><i8>-500</i8></value></member><member><name>faultString</name><value><string>invalid parameters: info-hash not found</string></value></member></struct></value><value><struct><member><name>faultCode</name><value><i8>-500</i8></value></member><member><name>faultString</name><value><string>invalid parameters: info-hash not found</string></value></member></struct></value><value><struct><member><name>faultCode</name><value><i8>-500</i8></value></member><member><name>faultString</name><value><string>invalid parameters: info-hash not found</string></value></member></struct></value><value><struct><member><name>faultCode</name><value><i8>-500</i8></value></member><member><name>faultString</name><value><string>invalid parameters: info-hash not found</string></value></member></struct></value><value><struct><member><name>faultCode</name><value><i8>-500</i8></value></member><member><name>faultString</name><value><string>invalid parameters: info-hash not found</string></value></member></struct></value><value><struct><member><name>faultCode</name><value><i8>-500</i8></value></member><member><name>faultString</name><value><string>invalid parameters: info-hash not found</string></value></member></struct></value><value><struct><member><name>faultCode</name><value><i8>-500</i8></value></member><member><name>faultString</name><value><string>invalid parameters: info-hash not found</string></value></member></struct></value><value><struct><member><name>faultCode</name><value><i8>-500</i8></value></member><member><name>faultString</name><value><string>invalid parameters: info-hash not found</string></value></member></struct></value><value><struct><member><name>faultCode</name><value><i8>-500</i8></value></member><member><name>faultString</name><value><string>invalid parameters: info-hash not found</string></value></member></struct></value><value><struct><member><name>faultCode</name><value><i8>-500</i8></value></member><member><name>faultString</name><value><string>invalid parameters: info-hash not found</string></value></member></struct></value><value><struct><member><name>faultCode</name><value><i8>-500</i8></value></member><member><name>faultString</name><value><string>invalid parameters: info-hash not found</string></value></member></struct></value><value><struct><member><name>faultCode</name><value><i8>-500</i8></value></member><member><name>faultString</name><value><string>invalid parameters: info-hash not found</string></value></member></struct></value></data></array></value></param></params></methodResponse>`;

const STATUS_FIELD_COUNT = 15;

function config(overrides: Partial<ResolvedClientConfig> = {}): ResolvedClientConfig {
  return {
    id: 7,
    name: 'seedbox',
    adapterType: 'rtorrent',
    baseUrl: 'http://127.0.0.1:8000/RPC2',
    username: null,
    password: null,
    category: 'bookorbit',
    allowPrivateAddress: true,
    settings: null,
    ...overrides,
  };
}

interface FakeTorrent {
  'd.name': string;
  'd.size_bytes': number;
  'd.completed_bytes': number;
  'd.complete': number;
  'd.state': number;
  'd.is_open': number;
  'd.is_active': number;
  'd.is_hash_checking': number;
  'd.message': string;
  'd.base_path': string;
  'd.directory': string;
  'd.is_multi_file': number;
  'd.ratio': number;
  'd.up.total': number;
  'd.timestamp.finished': number;
  'd.custom1': string;
  files: string[];
}

/** A single-file epub, started and downloading, as rTorrent reports one. */
function torrent(overrides: Partial<FakeTorrent> = {}): FakeTorrent {
  return {
    'd.name': 'Artificial Condition--The Murderbot Diaries.epub',
    'd.size_bytes': 98_000_000,
    'd.completed_bytes': 49_000_000,
    'd.complete': 0,
    'd.state': 1,
    'd.is_open': 1,
    'd.is_active': 1,
    'd.is_hash_checking': 0,
    'd.message': '',
    'd.base_path': '/downloads/bookorbit/Artificial Condition--The Murderbot Diaries.epub',
    'd.directory': '/downloads/bookorbit',
    'd.is_multi_file': 0,
    'd.ratio': 0,
    'd.up.total': 0,
    'd.timestamp.finished': 0,
    'd.custom1': 'bookorbit',
    files: ['Artificial Condition--The Murderbot Diaries.epub'],
    ...overrides,
  };
}

class FakeFault extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

interface Request {
  url: string;
  authorization: string | null;
  contentType: string | null;
  method: string;
  params: XmlRpcValue[];
  body: string;
}

/**
 * rTorrent as its XML-RPC answers it, in memory. Requests are decoded and answers encoded with
 * the adapter's own codec turned around, so the fake speaks exactly the wire format the codec's
 * tests pin against captured responses. Faults use the 0.9.8 spelling unless told otherwise.
 */
class FakeRtorrent {
  readonly torrents = new Map<string, FakeTorrent>();
  readonly requests: Request[] = [];
  unknownHashFault: [number, string] = [-501, 'Could not find info-hash.'];
  /** rTorrent 0.9.7 and older, which have no `d.multicall.filtered`. */
  lacksFilteredMulticall = false;
  /** What a `load.*` call does. By default nothing appears, which is how rTorrent drops a load. */
  onLoad: (method: string, params: XmlRpcValue[]) => void = () => undefined;
  /** Replaces the whole HTTP answer for a call when it returns one. */
  answer: (method: string, params: XmlRpcValue[]) => Response | undefined = () => undefined;

  readonly fetch = vi.fn((url: URL | string, init: RequestInit = {}): Promise<Response> => {
    const body = init.body as string;
    const headers = new Headers(init.headers as HeadersInit);
    const { method, params } = decodeCall(body);
    this.requests.push({
      url: url.toString(),
      authorization: headers.get('authorization'),
      contentType: headers.get('content-type'),
      method,
      params,
      body,
    });

    const replaced = this.answer(method, params);
    if (replaced) return Promise.resolve(replaced);
    try {
      return Promise.resolve(xmlResponse(this.call(method, params)));
    } catch (error) {
      if (error instanceof FakeFault) return Promise.resolve(faultResponse(error.code, error.message));
      throw error;
    }
  });

  hold(hash: string, value: FakeTorrent): void {
    this.torrents.set(hash.toUpperCase(), value);
  }

  /** Every call the adapter made, with `system.multicall` opened up into the calls it carried. */
  calls(): { method: string; params: XmlRpcValue[] }[] {
    return this.requests.flatMap((request) =>
      request.method === 'system.multicall'
        ? (request.params[0] as XmlRpcStruct[]).map((entry) => ({ method: entry.methodName as string, params: entry.params as XmlRpcValue[] }))
        : [{ method: request.method, params: request.params }],
    );
  }

  private call(method: string, params: XmlRpcValue[]): XmlRpcParam {
    switch (method) {
      case 'system.multicall':
        return (params[0] as XmlRpcStruct[]).map((entry) => {
          try {
            return [this.call(entry.methodName as string, entry.params as XmlRpcValue[])];
          } catch (error) {
            if (error instanceof FakeFault) return { faultCode: error.code, faultString: error.message };
            throw error;
          }
        });
      case 'system.client_version':
        return '0.9.8';
      case 'load.raw_start':
      case 'load.start':
        this.onLoad(method, params);
        return 0;
      case 'd.multicall.filtered': {
        if (this.lacksFilteredMulticall) throw new FakeFault(-506, "Method 'd.multicall.filtered' not defined");
        expect(params.slice(0, 2)).toEqual(['', 'main']);
        const condition = params[2] as string;
        const exact = /^equal=\{d\.custom1=,cat="([^"]*)"\}$/.exec(condition)?.[1];
        if (condition !== 'd.custom1=' && exact === undefined) throw new Error(`a filter the fake does not know: ${condition}`);
        const fields = (params.slice(3) as string[]).map((field) => field.replace(/=$/, ''));
        return [...this.torrents]
          .filter(([, entry]) => (exact === undefined ? entry['d.custom1'] !== '' : entry['d.custom1'] === exact))
          .map(([hash, entry]) => fields.map((field) => (field === 'd.hash' ? hash : entry[field as keyof FakeTorrent])) as XmlRpcParam);
      }
      case 'download_list':
        expect(params).toEqual(['', 'main']);
        return [...this.torrents.keys()];
      case 'd.multicall2':
        throw new Error('d.multicall2 over a large view crashes rTorrent 0.9.x');
      case 'view.size':
        expect(params).toEqual(['', 'main']);
        return this.torrents.size;
      case 'd.hash':
        this.held(params[0]);
        return params[0] as string;
      case 'd.erase':
        this.held(params[0]);
        this.torrents.delete(params[0] as string);
        return 0;
      case 'd.custom1.set':
        this.held(params[0])['d.custom1'] = params[1] as string;
        return 0;
      case 'f.multicall':
        expect(params.slice(1)).toEqual(['', 'f.path=']);
        return this.held(params[0]).files.map((path) => [path]);
      default: {
        if (!method.startsWith('d.')) throw new FakeFault(-506, `Method '${method}' not defined`);
        const value = this.held(params[0])[method as keyof FakeTorrent];
        if (value === undefined) throw new FakeFault(-506, `Method '${method}' not defined`);
        return value;
      }
    }
  }

  private held(hash: XmlRpcValue | undefined): FakeTorrent {
    const found = typeof hash === 'string' ? this.torrents.get(hash) : undefined;
    if (!found) throw new FakeFault(...this.unknownHashFault);
    return found;
  }
}

/** A methodCall's params, read by wrapping them as the array of a methodResponse. */
function decodeCall(body: string): { method: string; params: XmlRpcValue[] } {
  const method = /<methodName>([^<]*)<\/methodName>/.exec(body)?.[1] ?? '';
  const inner = body.slice(body.indexOf('<params>') + '<params>'.length, body.lastIndexOf('</params>'));
  const values = inner.replace(/<\/?param>/g, '');
  const response = `<?xml version="1.0"?><methodResponse><params><param><value><array><data>${values}</data></array></value></param></params></methodResponse>`;
  return { method, params: decodeMethodResponse(response) as XmlRpcValue[] };
}

function xmlResponse(value: XmlRpcParam): Response {
  const xml = encodeMethodCall('_', [value])
    .replace('<methodCall><methodName>_</methodName>', '<methodResponse>')
    .replace('</methodCall>', '</methodResponse>');
  return new Response(xml, { status: 200, headers: { 'Content-Type': 'text/xml' } });
}

function rawResponse(xml: string): Response {
  return new Response(xml, { status: 200, headers: { 'Content-Type': 'text/xml' } });
}

function faultResponse(code: number, reason: string): Response {
  return rawResponse(
    `<?xml version="1.0"?><methodResponse><fault><value><struct><member><name>faultCode</name><value><i4>${code}</i4></value></member><member><name>faultString</name><value><string>${reason}</string></value></member></struct></value></fault></methodResponse>`,
  );
}

/** The two command arguments a load carried, after the empty target and the payload. */
function loadCommands(fake: FakeRtorrent): XmlRpcValue[] {
  const load = fake.calls().find((call) => call.method.startsWith('load.'));
  return load ? load.params.slice(2) : [];
}

function contentRemoval() {
  const plan = vi.fn().mockResolvedValue({ files: ['/local/file.epub'], topDirectory: null });
  const execute = vi.fn().mockResolvedValue({ deleted: 1, failures: [], topDirectoryRemoved: true });
  return { plan, execute, service: { plan, execute } as unknown as DownloadContentRemovalService };
}

describe('RtorrentAdapter', () => {
  let fake: FakeRtorrent;
  let removal: ReturnType<typeof contentRemoval>;
  let adapter: RtorrentAdapter;

  beforeEach(() => {
    fake = new FakeRtorrent();
    vi.stubGlobal('fetch', fake.fetch);
    removal = contentRemoval();
    adapter = new RtorrentAdapter(removal.service);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('endpoint', () => {
    it('posts XML-RPC to the address as given, path included', async () => {
      await adapter.test(config({ baseUrl: 'http://127.0.0.1:8080/plugins/httprpc/action.php' }));

      expect(fake.requests[0].url).toBe('http://127.0.0.1:8080/plugins/httprpc/action.php');
      expect(fake.requests[0].contentType).toBe('text/xml');
    });

    it.each(['http://127.0.0.1:8000', 'http://127.0.0.1:8000/'])('reads a bare host %s as its /RPC2 endpoint', async (baseUrl) => {
      await adapter.test(config({ baseUrl }));

      expect(fake.requests[0].url).toBe('http://127.0.0.1:8000/RPC2');
    });

    it('sends Basic auth on every request when credentials are set, and none otherwise', async () => {
      await adapter.test(config({ username: 'rt', password: 'secret' }));
      await adapter.test(config());

      expect(fake.requests[0].authorization).toBe(`Basic ${Buffer.from('rt:secret').toString('base64')}`);
      expect(fake.requests[1].authorization).toBeNull();
    });

    it('refuses a private address the client was not allowed to reach, before sending anything', async () => {
      const result = await adapter.test(config({ allowPrivateAddress: false }));

      expect(result.success).toBe(false);
      expect(fake.fetch).not.toHaveBeenCalled();
    });
  });

  describe('test', () => {
    it('reports the version through system.multicall, the call every poll depends on', async () => {
      await expect(adapter.test(config())).resolves.toEqual({ success: true, version: '0.9.8' });
      expect(fake.requests.map((request) => request.method)).toEqual(['system.multicall']);
    });

    it.each([
      [401, 'rTorrent refused those credentials'],
      [403, 'rTorrent refused those credentials'],
      [404, 'answered 404 at that address. The base URL must be the XML-RPC endpoint itself'],
      [302, 'answered with a redirect (302), which is usually a login page'],
      [413, 'refused a 1 KB request as too large. Raise its request body limit'],
    ])('explains an HTTP %i by what fixes it', async (status, message) => {
      fake.answer = () => new Response('', { status });

      const result = await adapter.test(config());

      expect(result.success).toBe(false);
      expect(result.error).toContain(message);
    });

    it('tells a web page apart from XML-RPC, which is what pasting the ruTorrent address gives', async () => {
      fake.answer = () => new Response('<!doctype html><html><head><title>ruTorrent v5.3</title></head></html>', { status: 200 });

      const result = await adapter.test(config());

      expect(result).toEqual({ success: false, error: expect.stringContaining("not rTorrent's XML-RPC") });
    });

    it('passes on rTorrent refusing the call itself, with its own reason', async () => {
      fake.answer = () => faultResponse(-506, "Method 'system.multicall' not defined");

      const result = await adapter.test(config());

      expect(result.error).toBe("rTorrent refused system.multicall: Method 'system.multicall' not defined");
    });
  });

  describe('add', () => {
    const torrentFile = Buffer.from('d4:infod6:lengthi1e4:name4:testee');

    function appearOnLoad(hash: string, entry: FakeTorrent = torrent()) {
      fake.onLoad = () => fake.hold(hash, entry);
    }

    it('loads a .torrent started and labelled, and confirms it arrived', async () => {
      appearOnLoad(MURDERBOT);

      await expect(adapter.add({ torrentFile, clientKey: MURDERBOT }, config())).resolves.toEqual({ clientKey: MURDERBOT });

      expect(fake.calls().map((call) => call.method)).toEqual(['d.hash', 'load.raw_start', 'd.hash', 'd.custom1']);
      const load = fake.calls().find((call) => call.method === 'load.raw_start');
      expect(load?.params[0]).toBe('');
      expect(load?.params[1]).toEqual(torrentFile);
      expect(loadCommands(fake)).toEqual(['d.custom1.set="bookorbit"']);
    });

    it('leaves where the files go to rTorrent, since it cannot create a new folder two levels deep', async () => {
      appearOnLoad(MURDERBOT);

      await adapter.add({ torrentFile, clientKey: MURDERBOT }, config({ category: 'books' }));

      expect(loadCommands(fake).some((command) => typeof command === 'string' && command.startsWith('d.directory'))).toBe(false);
    });

    it('loads a magnet link with load.start', async () => {
      appearOnLoad(MURDERBOT);
      const magnet = `magnet:?xt=urn:btih:${MURDERBOT}&dn=Murderbot&tr=http%3A%2F%2Ftracker%3A6969%2Fannounce`;

      await adapter.add({ magnet, clientKey: MURDERBOT }, config());

      expect(
        fake
          .calls()
          .find((call) => call.method === 'load.start')
          ?.params.slice(0, 2),
      ).toEqual(['', magnet]);
    });

    it('quotes the label so a space, a comma or a quote cannot split the command', async () => {
      // Unquoted, rTorrent splits its arguments at the space and silently drops the command.
      appearOnLoad(MURDERBOT);

      await adapter.add({ torrentFile, clientKey: MURDERBOT }, config({ category: 'Book Orbit, "new" \\ old' }));

      expect(loadCommands(fake)).toEqual(['d.custom1.set="Book Orbit, \\"new\\" \\\\ old"']);
    });

    it('sets the label directly when rTorrent dropped the command but kept the torrent', async () => {
      appearOnLoad(MURDERBOT, torrent({ 'd.custom1': '' }));

      await adapter.add({ torrentFile, clientKey: MURDERBOT }, config({ category: 'Book Orbit' }));

      expect(fake.torrents.get(MURDERBOT.toUpperCase())?.['d.custom1']).toBe('Book Orbit');
      expect(fake.calls().at(-1)).toEqual({ method: 'd.custom1.set', params: [MURDERBOT.toUpperCase(), 'Book Orbit'] });
    });

    it('sends no label for a blank category', async () => {
      appearOnLoad(MURDERBOT);

      await adapter.add({ torrentFile, clientKey: MURDERBOT }, config({ category: '  ' }));

      expect(loadCommands(fake)).toEqual([]);
    });

    it('adopts a torrent rTorrent already holds instead of loading it again, and labels it', async () => {
      fake.hold(MURDERBOT, torrent({ 'd.custom1': '' }));

      await expect(adapter.add({ torrentFile, clientKey: MURDERBOT.toUpperCase() }, config())).resolves.toEqual({ clientKey: MURDERBOT });

      expect(fake.calls().some((call) => call.method.startsWith('load.'))).toBe(false);
      expect(fake.torrents.get(MURDERBOT.toUpperCase())?.['d.custom1']).toBe('bookorbit');
    });

    it('waits for a torrent that is slow to appear', async () => {
      vi.useFakeTimers();
      let checks = 0;
      fake.answer = (method) => {
        if (method !== 'd.hash') return undefined;
        checks += 1;
        if (checks === 3) fake.hold(MURDERBOT, torrent());
        return undefined;
      };

      const added = adapter.add({ torrentFile, clientKey: MURDERBOT }, config());
      await vi.runAllTimersAsync();

      await expect(added).resolves.toEqual({ clientKey: MURDERBOT });
      expect(checks).toBe(3);
    });

    it('fails a load rTorrent dropped, since load.* answers 0 for a corrupt file too', async () => {
      vi.useFakeTimers();
      fake.hold(AGNES, torrent());

      const added = adapter.add({ torrentFile, clientKey: MURDERBOT }, config());
      const outcome = expect(added).rejects.toThrow('rTorrent did not take the torrent. It reports why only in its own log');
      await vi.runAllTimersAsync();
      await outcome;
      expect(fake.calls().filter((call) => call.method === 'view.size')).toHaveLength(2);
    });

    /** Each count of the torrents finds the daemon has loaded one more of another tool's burst. */
    function workThroughBacklog(landsOnCount = Infinity) {
      let counts = 0;
      fake.answer = (method) => {
        if (method !== 'view.size') return undefined;
        counts += 1;
        fake.hold(counts.toString(16).padStart(40, '0'), torrent());
        if (counts === landsOnCount) fake.hold(MURDERBOT, torrent());
        return undefined;
      };
    }

    it('keeps waiting while rTorrent works through loads queued before this one, and takes it when it lands', async () => {
      vi.useFakeTimers();
      workThroughBacklog(6);

      const added = adapter.add({ torrentFile, clientKey: MURDERBOT }, config());
      await vi.runAllTimersAsync();

      await expect(added).resolves.toEqual({ clientKey: MURDERBOT });
      expect(fake.calls().at(-1)?.method).toBe('d.custom1');
      expect(Logger.prototype.warn).not.toHaveBeenCalled();
    });

    it('leaves a load still queued after the wait to the download monitor, rather than failing it', async () => {
      vi.useFakeTimers();
      workThroughBacklog();

      const added = adapter.add({ torrentFile, clientKey: MURDERBOT }, config());
      await vi.runAllTimersAsync();

      await expect(added).resolves.toEqual({ clientKey: MURDERBOT });
      expect(fake.calls().filter((call) => call.method === 'view.size')).toHaveLength(16);
      expect(fake.calls().some((call) => call.method === 'd.custom1')).toBe(false);
      expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('listed=false'));
    });

    it('takes a load that landed between the presence check and the count, while another torrent was erased', async () => {
      vi.useFakeTimers();
      let counts = 0;
      fake.answer = (method) => {
        if (method !== 'view.size') return undefined;
        counts += 1;
        if (counts === 1) fake.hold(AGNES, torrent());
        if (counts === 2) {
          fake.torrents.delete(AGNES.toUpperCase());
          fake.hold(MURDERBOT, torrent());
        }
        return undefined;
      };

      const added = adapter.add({ torrentFile, clientKey: MURDERBOT }, config());
      await vi.runAllTimersAsync();

      await expect(added).resolves.toEqual({ clientKey: MURDERBOT });
    });

    it('names the missing tracker when a magnet without one is dropped', async () => {
      vi.useFakeTimers();

      const added = adapter.add({ magnet: `magnet:?xt=urn:btih:${MURDERBOT}&dn=Murderbot`, clientKey: MURDERBOT }, config());
      const outcome = expect(added).rejects.toThrow('It names no tracker, and rTorrent drops such a link when its DHT is off');
      await vi.runAllTimersAsync();
      await outcome;
    });

    it('refuses a grab with nothing to load, and a key that is not an infohash', async () => {
      await expect(adapter.add({ clientKey: MURDERBOT }, config())).rejects.toThrow(BadRequestException);
      await expect(adapter.add({ torrentFile, clientKey: 'not-a-hash' }, config())).rejects.toThrow('40-character infohash');
      expect(fake.fetch).not.toHaveBeenCalled();
    });

    it('logs that a seed goal is not applied rather than pretending it was', async () => {
      appearOnLoad(MURDERBOT);

      await adapter.add({ torrentFile, clientKey: MURDERBOT, seedRatioGoal: 2 }, config());

      expect(Logger.prototype.log).toHaveBeenCalledWith(expect.stringContaining('[download_client.seed_goal] [end] clientId=7'));
    });
  });

  describe('status', () => {
    it('reads a status answer captured from rTorrent 0.16.25', async () => {
      vi.useFakeTimers();
      vi.setSystemTime((1_793_955_498 + 3600) * 1000);
      fake.answer = (method) => (method === 'system.multicall' ? rawResponse(RT016_STATUS) : undefined);

      const statuses = await adapter.status([AGNES, HARUKO_UNREGISTERED, UNKNOWN], config());

      expect(fake.calls().map((call) => call.params[0])).toEqual([
        ...Array<string>(STATUS_FIELD_COUNT).fill(AGNES.toUpperCase()),
        ...Array<string>(STATUS_FIELD_COUNT).fill(HARUKO_UNREGISTERED.toUpperCase()),
        ...Array<string>(STATUS_FIELD_COUNT).fill(UNKNOWN),
      ]);
      expect(statuses).toEqual([
        {
          clientKey: AGNES,
          state: 'completed',
          progressPercent: 100,
          downloadedBytes: 8_693_172,
          totalBytes: 8_693_172,
          contentPath: "/downloads/complete/bookorbit/Agnes & Friends <Box Set> 'Vol 1'",
          seed: { seeding: true, ratio: 0.209, ratioGoal: null, seedingTimeSeconds: 3600, seedingTimeGoalMinutes: null, uploadedBytes: 1_818_624 },
        },
        {
          clientKey: HARUKO_UNREGISTERED,
          state: 'downloading',
          progressPercent: 0,
          downloadedBytes: 0,
          totalBytes: 2_247_393,
          contentPath: '/downloads/temp/ハルコさんの彼氏.epub',
          seed: { seeding: false, ratio: 0, ratioGoal: null, seedingTimeSeconds: null, seedingTimeGoalMinutes: null, uploadedBytes: 0 },
          trackerError: 'Tracker: [v4 : Failure reason "Unregistered torrent"]',
        },
      ]);
    });

    it('treats a hash rTorrent 0.9.8 does not hold as absent', async () => {
      fake.hold(MURDERBOT, torrent());

      const statuses = await adapter.status([UNKNOWN, MURDERBOT], config());

      expect(statuses.map((status) => status.clientKey)).toEqual([MURDERBOT]);
    });

    it.each<[string, Partial<FakeTorrent>, string]>([
      ['downloading', {}, 'downloading'],
      ['paused, which rTorrent shows as started but inactive', { 'd.is_active': 0 }, 'queued'],
      ['stopped', { 'd.state': 0, 'd.is_active': 0 }, 'queued'],
      ['closed', { 'd.state': 0, 'd.is_open': 0, 'd.is_active': 0 }, 'queued'],
      // An unwritable directory or a full disk looks exactly like this, with no message at all.
      ['stalled by a storage failure', { 'd.is_active': 0, 'd.message': '' }, 'queued'],
      ['finished and seeding', { 'd.complete': 1, 'd.completed_bytes': 98_000_000 }, 'completed'],
      ['finished and stopped', { 'd.complete': 1, 'd.completed_bytes': 98_000_000, 'd.state': 0, 'd.is_active': 0 }, 'completed'],
      ['rechecking a finished torrent', { 'd.complete': 1, 'd.is_hash_checking': 1, 'd.completed_bytes': 12_000_000 }, 'queued'],
      // rTorrent 0.9.8, captured between its completion check and its finished hooks moving the files.
      ['finished but not yet reopened', { 'd.complete': 1, 'd.completed_bytes': 98_000_000, 'd.is_open': 0, 'd.is_active': 0 }, 'queued'],
      ['finished and paused', { 'd.complete': 1, 'd.completed_bytes': 98_000_000, 'd.is_active': 0 }, 'completed'],
    ])('maps a torrent %s', async (_case, overrides, state) => {
      fake.hold(MURDERBOT, torrent(overrides));

      const [status] = await adapter.status([MURDERBOT], config());

      expect(status.state).toBe(state);
    });

    it('never reports 100 percent for a recheck, even though d.complete stays 1 through it', async () => {
      fake.hold(MURDERBOT, torrent({ 'd.complete': 1, 'd.is_hash_checking': 1, 'd.completed_bytes': 49_000_000 }));

      const [status] = await adapter.status([MURDERBOT], config());

      expect(status.progressPercent).toBe(50);
    });

    it('caps an unfinished torrent below 100 percent', async () => {
      fake.hold(MURDERBOT, torrent({ 'd.completed_bytes': 97_999_999 }));

      const [status] = await adapter.status([MURDERBOT], config());

      expect(status.progressPercent).toBe(99);
    });

    it('reports a magnet still fetching its metadata as queued, with no size and no path', async () => {
      const name = `${MURDERBOT.toUpperCase()}.meta`;
      fake.hold(MURDERBOT, torrent({ 'd.name': name, 'd.size_bytes': 1, 'd.base_path': `/downloads/bookorbit/${name}`, files: [name] }));

      const [status] = await adapter.status([MURDERBOT], config());

      expect(status).toMatchObject({ state: 'queued', progressPercent: 0, downloadedBytes: 0, totalBytes: null, contentPath: null });
    });

    it('rebuilds the path of a torrent never opened, whose d.base_path is empty', async () => {
      fake.hold(MURDERBOT, torrent({ 'd.base_path': '', 'd.directory': '/downloads/bookorbit/' }));
      fake.hold(AGNES, torrent({ 'd.base_path': '', 'd.directory': '/downloads/bookorbit/Agnes', 'd.is_multi_file': 1 }));

      const statuses = await adapter.status([MURDERBOT, AGNES], config());

      expect(statuses.map((status) => status.contentPath)).toEqual([
        '/downloads/bookorbit/Artificial Condition--The Murderbot Diaries.epub',
        '/downloads/bookorbit/Agnes',
      ]);
    });

    it('passes on only tracker messages, and caps their length', async () => {
      fake.hold(MURDERBOT, torrent({ 'd.message': `Tracker: [Failure reason "${'x'.repeat(400)}"]` }));
      fake.hold(AGNES, torrent({ 'd.message': 'Hash check on download completion found bad chunks, consider using "safe_sync".' }));

      const statuses = await adapter.status([MURDERBOT, AGNES], config());

      expect(statuses[0].trackerError).toHaveLength(200);
      expect(statuses[1]).not.toHaveProperty('trackerError');
    });

    it('counts seeding time only while the torrent is still seeding', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(2_000_000_000 * 1000);
      fake.hold(MURDERBOT, torrent({ 'd.complete': 1, 'd.timestamp.finished': 2_000_000_000 - 90, 'd.state': 0, 'd.is_active': 0 }));

      const [status] = await adapter.status([MURDERBOT], config());

      expect(status.seed).toMatchObject({ seeding: false, seedingTimeSeconds: null });
    });

    it('asks once per fifty hashes, deduplicated however they are cased, and not at all for none', async () => {
      const hashes = Array.from({ length: 120 }, (_, index) => index.toString(16).padStart(40, '0'));
      for (const hash of hashes) fake.hold(hash, torrent());

      const statuses = await adapter.status([...hashes, ...hashes.map((hash) => hash.toUpperCase())], config());
      expect(statuses).toHaveLength(120);
      expect(fake.requests).toHaveLength(3);
      expect(fake.requests.map((request) => (request.params[0] as unknown[]).length)).toEqual(
        [50, 50, 20].map((count) => count * STATUS_FIELD_COUNT),
      );

      await adapter.status([], config());
      expect(fake.requests).toHaveLength(3);
    });

    it('throws on a refusal that is not an unknown hash, rather than reporting the torrent gone', async () => {
      fake.hold(MURDERBOT, torrent());
      fake.answer = (method) =>
        method === 'system.multicall'
          ? xmlResponse(Array.from({ length: STATUS_FIELD_COUNT }, () => ({ faultCode: -503, faultString: 'Permission denied' })))
          : undefined;

      await expect(adapter.status([MURDERBOT], config())).rejects.toThrow('rTorrent refused d.name: Permission denied');
    });

    it('says the server failed, as a temporary error, when the web server in front answers 502', async () => {
      fake.answer = () => new Response('Bad Gateway', { status: 502 });

      await expect(adapter.status([MURDERBOT], config())).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('listOwned', () => {
    it('lists the torrents carrying the label, in any spelling a front end stores it', async () => {
      fake.hold(MURDERBOT, torrent({ 'd.custom1': 'bookorbit' }));
      // ruTorrent stores labels URL-encoded; Flood keeps several, comma-separated.
      fake.hold(AGNES, torrent({ 'd.name': 'Agnes', 'd.custom1': 'book%20orbit' }));
      fake.hold(HARUKO_UNREGISTERED, torrent({ 'd.name': 'Haruko', 'd.custom1': 'ebooks, book orbit' }));
      fake.hold(UNKNOWN, torrent({ 'd.name': 'Someone else', 'd.custom1': 'tv' }));

      const owned = await adapter.listOwned(config({ category: 'book orbit' }));

      expect(owned.supported).toBe(true);
      expect(owned.truncated).toBe(false);
      expect(owned.items.map((item) => [item.clientKey, item.name])).toEqual([
        [AGNES, 'Agnes'],
        [HARUKO_UNREGISTERED, 'Haruko'],
      ]);
      // No torrent carries this exact spelling, so there is nothing for a one-pass read to find.
      expect(fake.requests.map((request) => request.method)).toEqual(['d.multicall.filtered', 'system.multicall']);
    });

    it('falls back to the hash for a torrent with no name yet', async () => {
      fake.hold(MURDERBOT, torrent({ 'd.name': '  ' }));

      const owned = await adapter.listOwned(config());

      expect(owned.items[0].name).toBe(MURDERBOT);
    });

    it('cannot list by a blank category, which would claim every unlabelled torrent', async () => {
      await expect(adapter.listOwned(config({ category: '' }))).resolves.toEqual({ supported: false, truncated: false, items: [] });
      expect(fake.fetch).not.toHaveBeenCalled();
    });

    it('stops at a thousand and says so', async () => {
      for (let index = 0; index < 1001; index += 1) fake.hold(index.toString(16).padStart(40, '0'), torrent());

      const owned = await adapter.listOwned(config());

      expect(owned.truncated).toBe(true);
      expect(owned.items).toHaveLength(1000);
    });

    it('reads only hash and label for the whole view, in one filtered call rather than d.multicall2, which crashes rTorrent 0.9.8', async () => {
      for (let index = 0; index < 1600; index += 1) fake.hold(index.toString(16).padStart(40, '0'), torrent({ 'd.custom1': 'tv' }));
      fake.hold(AGNES, torrent({ 'd.name': 'Agnes' }));
      fake.hold(MURDERBOT, torrent());
      fake.hold(UNKNOWN, torrent({ 'd.custom1': '' }));

      const owned = await adapter.listOwned(config());

      expect(owned.items.map((item) => [item.clientKey, item.name, item.progressPercent])).toEqual([
        [AGNES, 'Agnes', 50],
        [MURDERBOT, 'Artificial Condition--The Murderbot Diaries.epub', 50],
      ]);
      expect(fake.requests.map((request) => request.params.slice(2, 4))).toEqual([
        ['d.custom1=', 'd.hash='],
        ['equal={d.custom1=,cat="bookorbit"}', 'd.hash='],
      ]);
      expect(fake.requests[1].params).toHaveLength(4 + STATUS_FIELD_COUNT);
    });

    it("reads by hash a front end's other spelling of the label, which the one-pass read leaves out", async () => {
      fake.hold(AGNES, torrent({ 'd.name': 'Agnes', 'd.custom1': 'book orbit' }));
      fake.hold(MURDERBOT, torrent({ 'd.custom1': 'book%20orbit' }));

      const owned = await adapter.listOwned(config({ category: 'book orbit' }));

      expect(owned.items.map((item) => item.clientKey)).toEqual([AGNES, MURDERBOT]);
      expect(fake.requests.map((request) => request.method)).toEqual(['d.multicall.filtered', 'd.multicall.filtered', 'system.multicall']);
      expect(fake.requests[1].params[2]).toBe('equal={d.custom1=,cat="book orbit"}');
      expect(
        fake
          .calls()
          .slice(2)
          .every((call) => call.params[0] === MURDERBOT.toUpperCase()),
      ).toBe(true);
    });

    it('reads by hash anything the one-pass read did not bring back', async () => {
      fake.hold(AGNES, torrent({ 'd.name': 'Agnes' }));
      fake.hold(MURDERBOT, torrent());
      fake.answer = (method, params) => (method === 'd.multicall.filtered' && params[2] !== 'd.custom1=' ? xmlResponse([]) : undefined);

      const owned = await adapter.listOwned(config());

      expect(owned.items.map((item) => item.clientKey)).toEqual([AGNES, MURDERBOT]);
      expect((fake.requests[2].params[0] as unknown[]).length).toBe(2 * STATUS_FIELD_COUNT);
    });

    it('reads by hash for a label the filter syntax cannot carry', async () => {
      fake.hold(MURDERBOT, torrent({ 'd.custom1': 'say "hi"' }));

      const owned = await adapter.listOwned(config({ category: 'say "hi"' }));

      expect(owned.items.map((item) => item.clientKey)).toEqual([MURDERBOT]);
      expect(fake.requests.map((request) => request.method)).toEqual(['d.multicall.filtered', 'system.multicall']);
    });

    it('reads by hash past ten thousand torrents with the label, rather than one answer too large to take', async () => {
      for (let index = 0; index < 10_001; index += 1) fake.hold(index.toString(16).padStart(40, '0'), torrent());

      const owned = await adapter.listOwned(config());

      expect(owned.items).toHaveLength(1000);
      expect(fake.requests.filter((request) => request.method === 'd.multicall.filtered')).toHaveLength(1);
    });

    it('reads nothing further for a listed row that is not an infohash', async () => {
      fake.hold(MURDERBOT, torrent());
      fake.answer = (method, params) =>
        method === 'd.multicall.filtered' && params[2] === 'd.custom1='
          ? xmlResponse([[MURDERBOT.toUpperCase(), 'bookorbit'], ['', 'bookorbit'], [42, 'bookorbit'], ['NOT-A-HASH', 'bookorbit'], 'junk'])
          : undefined;

      const owned = await adapter.listOwned(config());

      expect(owned.items.map((item) => item.clientKey)).toEqual([MURDERBOT]);
      expect(fake.requests).toHaveLength(2);
    });

    it('takes from the one-pass read only rows that are whole', async () => {
      fake.hold(MURDERBOT, torrent());
      fake.answer = (method, params) =>
        method === 'd.multicall.filtered' && params[2] !== 'd.custom1='
          ? xmlResponse([
              [AGNES.toUpperCase(), ...Array.from({ length: STATUS_FIELD_COUNT }, () => 0)],
              [MURDERBOT.toUpperCase(), 'short row'],
            ])
          : undefined;

      const owned = await adapter.listOwned(config());

      expect(owned.items.map((item) => [item.clientKey, item.progressPercent])).toEqual([[MURDERBOT, 50]]);
      expect(fake.requests.map((request) => request.method)).toEqual(['d.multicall.filtered', 'd.multicall.filtered', 'system.multicall']);
    });

    it('passes on any other refusal of the filtered call, rather than reading every label one by one', async () => {
      fake.answer = (method) => (method === 'd.multicall.filtered' ? faultResponse(-503, 'Permission denied') : undefined);

      await expect(adapter.listOwned(config())).rejects.toThrow('rTorrent refused d.multicall.filtered: Permission denied');
      expect(fake.requests).toHaveLength(1);
    });

    describe('on rTorrent 0.9.7, which has no d.multicall.filtered', () => {
      beforeEach(() => {
        fake.lacksFilteredMulticall = true;
      });

      it('lists the hashes and reads their labels in batches', async () => {
        for (let index = 0; index < 1600; index += 1) fake.hold(index.toString(16).padStart(40, '0'), torrent({ 'd.custom1': 'tv' }));
        fake.hold(AGNES, torrent({ 'd.name': 'Agnes', 'd.custom1': 'book%20orbit' }));
        fake.hold(MURDERBOT, torrent({ 'd.custom1': 'ebooks, book orbit' }));

        const owned = await adapter.listOwned(config({ category: 'book orbit' }));

        expect(owned.items.map((item) => item.clientKey)).toEqual([AGNES, MURDERBOT]);
        expect(fake.requests.map((request) => request.method)).toEqual([
          'd.multicall.filtered',
          'download_list',
          'system.multicall',
          'system.multicall',
          'system.multicall',
          'system.multicall',
        ]);
        expect(fake.requests.slice(2).map((request) => (request.params[0] as unknown[]).length)).toEqual([750, 750, 102, 2 * STATUS_FIELD_COUNT]);
        expect(
          new Set(
            fake
              .calls()
              .slice(2, 1604)
              .map((call) => call.method),
          ),
        ).toEqual(new Set(['d.custom1']));
      });

      it('skips a torrent erased between the listing and the label read', async () => {
        fake.hold(AGNES, torrent({ 'd.name': 'Agnes' }));
        fake.hold(MURDERBOT, torrent());
        fake.answer = (method) => {
          if (method === 'system.multicall') fake.torrents.delete(AGNES.toUpperCase());
          return undefined;
        };

        const owned = await adapter.listOwned(config());

        expect(owned.items.map((item) => item.clientKey)).toEqual([MURDERBOT]);
      });

      it('throws on a label refusal that is not an unknown hash, rather than leaving the torrent out', async () => {
        fake.hold(MURDERBOT, torrent());
        fake.answer = (method) => (method === 'system.multicall' ? xmlResponse([{ faultCode: -503, faultString: 'Permission denied' }]) : undefined);

        await expect(adapter.listOwned(config())).rejects.toThrow('rTorrent refused d.custom1: Permission denied');
      });
    });
  });

  describe('remove', () => {
    it('erases the torrent and leaves its files when asked to keep them', async () => {
      fake.hold(MURDERBOT, torrent());

      await adapter.remove(MURDERBOT, config(), { deleteFiles: false });

      expect(fake.torrents.size).toBe(0);
      expect(removal.plan).not.toHaveBeenCalled();
    });

    it('treats a torrent rTorrent no longer holds as already removed', async () => {
      await expect(adapter.remove(MURDERBOT, config(), { deleteFiles: false })).resolves.toBeUndefined();
      await expect(adapter.remove(MURDERBOT, config(), { deleteFiles: true })).resolves.toBeUndefined();
      expect(removal.plan).not.toHaveBeenCalled();
    });

    it('plans the deletion while rTorrent still holds the torrent, erases it, then deletes the files', async () => {
      fake.hold(
        AGNES,
        torrent({
          'd.name': "Agnes & Friends <Box Set> 'Vol 1'",
          'd.base_path': "/downloads/bookorbit/Agnes & Friends <Box Set> 'Vol 1'",
          'd.directory': "/downloads/bookorbit/Agnes & Friends <Box Set> 'Vol 1'",
          'd.is_multi_file': 1,
          files: ['01 - Agnes.epub', 'Extras/Cover.jpg'],
        }),
      );
      const order: string[] = [];
      removal.plan.mockImplementation(() => {
        order.push(`plan:${fake.torrents.size}`);
        return Promise.resolve({ files: [], topDirectory: null });
      });
      removal.execute.mockImplementation(() => {
        order.push(`execute:${fake.torrents.size}`);
        return Promise.resolve({ deleted: 2, failures: [], topDirectoryRemoved: true });
      });

      await adapter.remove(AGNES, config(), { deleteFiles: true });

      expect(removal.plan).toHaveBeenCalledWith(7, {
        root: "/downloads/bookorbit/Agnes & Friends <Box Set> 'Vol 1'",
        files: ['01 - Agnes.epub', 'Extras/Cover.jpg'],
        multiFile: true,
        expectOnDisk: true,
      });
      expect(order).toEqual(['plan:1', 'execute:0']);
    });

    it('hands a single file over as its own root', async () => {
      fake.hold(MURDERBOT, torrent({ 'd.completed_bytes': 0 }));

      await adapter.remove(MURDERBOT, config(), { deleteFiles: true });

      expect(removal.plan).toHaveBeenCalledWith(7, {
        root: '/downloads/bookorbit/Artificial Condition--The Murderbot Diaries.epub',
        files: [],
        multiFile: false,
        expectOnDisk: false,
      });
    });

    it('deletes the empty .meta placeholder a magnet leaves, which erase does not', async () => {
      const name = `${MURDERBOT.toUpperCase()}.meta`;
      fake.hold(MURDERBOT, torrent({ 'd.name': name, 'd.base_path': `/downloads/bookorbit/${name}`, 'd.completed_bytes': 0, files: [name] }));

      await adapter.remove(MURDERBOT, config(), { deleteFiles: true });

      expect(removal.plan).toHaveBeenCalledWith(7, { root: `/downloads/bookorbit/${name}`, files: [], multiFile: false, expectOnDisk: false });
    });

    it('keeps the torrent in rTorrent when its files cannot be deleted', async () => {
      fake.hold(MURDERBOT, torrent());
      removal.plan.mockRejectedValue(new BadRequestException('No path mapping covers "/downloads/bookorbit"'));

      await expect(adapter.remove(MURDERBOT, config(), { deleteFiles: true })).rejects.toThrow('No path mapping covers');

      expect(fake.torrents.size).toBe(1);
      expect(removal.execute).not.toHaveBeenCalled();
    });

    it('reports files it could not delete after the erase in the log, not as a failed removal', async () => {
      fake.hold(MURDERBOT, torrent());
      removal.execute.mockResolvedValue({ deleted: 0, failures: [{ path: '/local/file.epub', code: 'EBUSY' }], topDirectoryRemoved: true });

      await expect(adapter.remove(MURDERBOT, config(), { deleteFiles: true })).resolves.toBeUndefined();

      expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('[download_client.delete_files] [fail] clientId=7'));
      expect(fake.torrents.size).toBe(0);
    });
  });
});
