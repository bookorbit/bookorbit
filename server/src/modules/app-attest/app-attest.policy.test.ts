import {
  androidKeyAttestPolicy,
  BOOKORBIT_ANDROID_DEBUG_PACKAGE,
  BOOKORBIT_ANDROID_PACKAGE,
  BOOKORBIT_ANDROID_RELEASE_DIGESTS,
} from './app-attest.policy';

describe('Android attestation policy', () => {
  it('pins the release signing certificates', () => {
    expect(BOOKORBIT_ANDROID_RELEASE_DIGESTS).toEqual([
      '012316fc783d25d118fdc13681f5f4ae388e7f1d12914f8ea74b8eab7dd2637e',
      'de6ee3afa930eb0d162846d22fb7c08f22159610ea17dcb1f340bd83509331cf',
      '3e59ca69776c7211636c8975e632fd8f3d86e45dca146904165aba7cc46dccc9',
      '49a23669832e9defc4bdbec975ae28c1c6337689dc2c81ca3b4a6cef2e4ff485',
    ]);
  });

  it('writes each digest as 64 lowercase hex characters, the form the verifier compares', () => {
    for (const digest of BOOKORBIT_ANDROID_RELEASE_DIGESTS) expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('accepts the release package on those digests only, and no development key in production', () => {
    const policy = androidKeyAttestPolicy('production');
    expect(policy.apps).toEqual([
      { packageName: BOOKORBIT_ANDROID_PACKAGE, signatureDigests: BOOKORBIT_ANDROID_RELEASE_DIGESTS, development: false },
    ]);
    expect(policy.allowDevelopment).toBe(false);
  });

  it('accepts the debug package on any key outside production only', () => {
    expect(androidKeyAttestPolicy('development').apps).toContainEqual({
      packageName: BOOKORBIT_ANDROID_DEBUG_PACKAGE,
      signatureDigests: 'any',
      development: true,
    });
    expect(androidKeyAttestPolicy('production').apps.map((app) => app.packageName)).not.toContain(BOOKORBIT_ANDROID_DEBUG_PACKAGE);
  });
});
