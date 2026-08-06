import { describe, expect, it } from 'vitest';

import { SELF_UPDATE_MIN_PLUGIN_VERSION, pluginRequiresManualUpdate } from './koreader-plugin-update.util';

describe('pluginRequiresManualUpdate', () => {
  it('requires a manual install for versions that crash on self-update', () => {
    expect(pluginRequiresManualUpdate('1.3.0')).toBe(true);
    expect(pluginRequiresManualUpdate('1.3.1')).toBe(true);
    expect(pluginRequiresManualUpdate('0.9.9')).toBe(true);
  });

  it('leaves self-update alone from the fixed version onwards', () => {
    expect(pluginRequiresManualUpdate(SELF_UPDATE_MIN_PLUGIN_VERSION)).toBe(false);
    expect(pluginRequiresManualUpdate('1.4.1')).toBe(false);
    expect(pluginRequiresManualUpdate('2.0.0')).toBe(false);
  });

  it('tolerates a leading v', () => {
    expect(pluginRequiresManualUpdate('v1.3.0')).toBe(true);
    expect(pluginRequiresManualUpdate('v1.4.0')).toBe(false);
  });

  it('treats a version it cannot read as requiring a manual install', () => {
    expect(pluginRequiresManualUpdate(null)).toBe(true);
    expect(pluginRequiresManualUpdate(undefined)).toBe(true);
    expect(pluginRequiresManualUpdate('')).toBe(true);
    expect(pluginRequiresManualUpdate('nightly')).toBe(true);
  });
});
