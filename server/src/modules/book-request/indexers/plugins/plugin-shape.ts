import { BOOK_REQUEST_MEDIA_KINDS } from '@bookorbit/types';
import type { PluginSettingsField } from '@bookorbit/plugin-api';

/** Bumped when a change to the contract would break a plugin written against the old one. */
export const PLUGIN_API_VERSION = 1;

/** Never a path segment with a `.` or a `/` in it, which is what makes it safe as a directory name. */
const TYPE_SLUG = /^[a-z0-9][a-z0-9-]{0,29}$/;

export function isPluginTypeSlug(value: string): boolean {
  return TYPE_SLUG.test(value);
}

/**
 * What a plugin declares about itself, with the four functions reduced to whether they are there.
 *
 * Shaped this way so the same rules can judge a plugin the loader imported into this process and a
 * plugin the installer only ever ran in a child process. Two rule sets would drift, and the way
 * they would drift is that something installable stops being loadable.
 */
export interface DeclaredPluginShape {
  apiVersion?: unknown;
  version?: unknown;
  type?: unknown;
  label?: unknown;
  requiresCredential?: unknown;
  usesCategories?: unknown;
  seedsBack?: unknown;
  mediaKinds?: unknown;
  settingsFields?: readonly PluginSettingsField[];
  hasSearch: boolean;
  hasTest: boolean;
  hasResolveFile: boolean;
  hasFetchTorrentFile: boolean;
}

/**
 * Checked before a plugin is ever called rather than when a search fails, so a malformed plugin is
 * a message on the settings page and not a broken picker.
 */
export function assertPluginShape(plugin: DeclaredPluginShape): void {
  if (plugin.apiVersion !== PLUGIN_API_VERSION) {
    throw new Error(`it targets plugin API version ${String(plugin.apiVersion)}, and this build speaks version ${PLUGIN_API_VERSION}`);
  }
  if (typeof plugin.type !== 'string' || !isPluginTypeSlug(plugin.type)) {
    throw new Error('its type must be a lowercase slug of at most 30 characters');
  }
  if (plugin.version !== undefined && (typeof plugin.version !== 'string' || !isPluginVersion(plugin.version))) {
    throw new Error('its version must be a semantic version such as 1.2.3, without a leading "v"');
  }
  if (typeof plugin.label !== 'string' || plugin.label.trim() === '') throw new Error('it declares no label');
  if (!plugin.hasSearch) throw new Error('it exports no search function');
  if (!plugin.hasTest) throw new Error('it exports no test function');
  if (typeof plugin.requiresCredential !== 'boolean') throw new Error('it does not say whether it requires a credential');
  if (typeof plugin.usesCategories !== 'boolean') throw new Error('it does not say whether it uses categories');
  if (typeof plugin.seedsBack !== 'boolean') throw new Error('it does not say whether it seeds back');

  if (!Array.isArray(plugin.mediaKinds) || plugin.mediaKinds.length === 0) {
    throw new Error('it declares no media kinds');
  }
  for (const kind of plugin.mediaKinds) {
    if (!(BOOK_REQUEST_MEDIA_KINDS as readonly string[]).includes(kind as string)) throw new Error(`"${String(kind)}" is not a media kind`);
  }

  // Declaring both would leave the grab path guessing which one a release meant.
  if (plugin.hasFetchTorrentFile && plugin.hasResolveFile) {
    throw new Error('it declares both fetchTorrentFile and resolveFile, and a release can only be one of those');
  }
  if (!plugin.hasFetchTorrentFile && !plugin.hasResolveFile) {
    throw new Error('it declares neither fetchTorrentFile nor resolveFile, so nothing it finds could be grabbed');
  }

  for (const field of plugin.settingsFields ?? []) assertField(field);
}

function isPluginVersion(version: string): boolean {
  return (
    version.length <= 64 &&
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version)
  );
}

function assertField(field: PluginSettingsField): void {
  if (typeof field?.key !== 'string' || !/^[a-zA-Z][a-zA-Z0-9]{0,39}$/.test(field.key)) {
    throw new Error('a settings field has no usable key');
  }
  if (!['boolean', 'string', 'number'].includes(field.type)) throw new Error(`settings field "${field.key}" has an unknown type`);
  if (typeof field.label !== 'string' || field.label.trim() === '') throw new Error(`settings field "${field.key}" has no label`);

  if (field.format !== undefined && field.format !== 'list') {
    throw new Error(`settings field "${field.key}" has an unknown format`);
  }
  if (field.format === 'list' && field.type !== 'string') {
    throw new Error(`settings field "${field.key}" can only use list format with a string value`);
  }
  if (field.options !== undefined) assertFieldOptions(field);
  if (field.minItems !== undefined) assertFieldMinimum(field);
}

function assertFieldOptions(field: PluginSettingsField): void {
  if (field.format !== 'list' || !Array.isArray(field.options) || field.options.length === 0) {
    throw new Error(`settings field "${field.key}" can only declare options for a non-empty list`);
  }

  const normalized = new Set<string>();
  for (const option of field.options) {
    if (typeof option !== 'string' || option.trim() === '' || option.length > 40) {
      throw new Error(`settings field "${field.key}" has an unusable option`);
    }
    const canonical = option.trim().toLowerCase();
    if (normalized.has(canonical)) throw new Error(`settings field "${field.key}" has duplicate options`);
    normalized.add(canonical);
  }

  if (field.default !== undefined) {
    if (typeof field.default !== 'string') throw new Error(`settings field "${field.key}" has a non-string default`);
    const defaults = parseList(field.default);
    if (defaults.some((entry) => !normalized.has(entry.toLowerCase()))) {
      throw new Error(`settings field "${field.key}" has a default outside its options`);
    }
  }
}

function assertFieldMinimum(field: PluginSettingsField): void {
  const minItems = field.minItems;
  if (minItems === undefined || !Number.isInteger(minItems) || minItems < 0 || !field.options || minItems > field.options.length) {
    throw new Error(`settings field "${field.key}" has an unusable minimum item count`);
  }
  if (minItems > 0) {
    if (typeof field.default !== 'string' || parseList(field.default).length < minItems) {
      throw new Error(`settings field "${field.key}" needs a default that meets its minimum item count`);
    }
  }
}

function parseList(value: string): string[] {
  const entries = new Map<string, string>();
  for (const entry of value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean))
    entries.set(entry.toLowerCase(), entry);
  return [...entries.values()];
}
