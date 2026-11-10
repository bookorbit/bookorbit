import { certificateExtension, DerError, derChildren, derOid, derUnsigned, readDer, readDerElement } from './der';
import { explicit, int, octets, oid, seq } from './test-fixtures/android-attestation-test-helpers';

describe('DER', () => {
  it('reads a short tag and its value', () => {
    const element = readDer(int(400));
    expect(element).toEqual(expect.objectContaining({ tagClass: 0, constructed: false, tag: 2 }));
    expect(derUnsigned(element, 'n')).toBe(400);
  });

  it('reads multi-byte tag numbers as a key description writes them', () => {
    const element = readDer(explicit(709, octets(Buffer.from('x'))));
    expect(element).toEqual(expect.objectContaining({ tagClass: 2, constructed: true, tag: 709 }));
    expect(derChildren(element)).toHaveLength(1);
  });

  it('reads long-form lengths', () => {
    const value = Buffer.alloc(300, 7);
    expect(readDer(octets(value)).value).toEqual(value);
  });

  it('decodes object identifiers', () => {
    expect(derOid(readDer(oid('1.3.6.1.4.1.11129.2.1.17')), 'oid')).toBe('1.3.6.1.4.1.11129.2.1.17');
    expect(derOid(readDer(oid('2.5.29.19')), 'oid')).toBe('2.5.29.19');
  });

  it('refuses truncated, indefinite and trailing input', () => {
    expect(() => readDer(Buffer.from([0x04, 0x05, 0x01]))).toThrow(DerError);
    expect(() => readDer(Buffer.from([0x30, 0x80, 0x00, 0x00]))).toThrow('indefinite DER length');
    expect(() => readDer(Buffer.concat([int(1), Buffer.from([0x00])]))).toThrow('trailing bytes after DER');
    expect(() => readDerElement(Buffer.from([0xbf, 0x85]), 0)).toThrow(DerError);
  });

  it('refuses a negative or oversized integer', () => {
    expect(() => derUnsigned(readDer(Buffer.from([0x02, 0x01, 0xff])), 'n')).toThrow('not a non-negative integer');
    expect(() => derUnsigned(readDer(Buffer.from([0x02, 0x08, 0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])), 'n')).toThrow('too large');
  });

  it('finds no extension in a structure without one', () => {
    const tbs = seq(int(1));
    expect(certificateExtension(seq(tbs), '2.5.29.19')).toBeUndefined();
  });
});
