import { isSemverNewer } from '../../common/utils/semver.utils';

/**
 * Plugin versions below this one cannot install their own updates: they call
 * Device:unpackArchive, which KOReader removed in koreader/koreader@751b4978
 * (July 2026), so tapping Update raises an uncaught Lua error on the UI loop and
 * takes KOReader down with it. The fix shipped in 1.4.0, but the broken code is
 * the code that would have to install it, so it can never self-deliver.
 */
export const SELF_UPDATE_MIN_PLUGIN_VERSION = '1.4.0';

/**
 * Whether a device reporting `version` has to be updated by hand. A version we
 * cannot parse counts as requiring it: an unnecessary manual install is a far
 * better outcome than a crash.
 */
export function pluginRequiresManualUpdate(version: string | null | undefined): boolean {
  return isSemverNewer(SELF_UPDATE_MIN_PLUGIN_VERSION, version) !== false;
}
