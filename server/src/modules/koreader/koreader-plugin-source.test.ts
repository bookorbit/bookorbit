import { readFile } from 'fs/promises';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const pluginRoot = join(process.cwd(), '..', 'koreader-plugin', 'bookorbit.koplugin');

async function readPluginFile(name: string): Promise<string> {
  return readFile(join(pluginRoot, name), 'utf8');
}

describe('KOReader plugin update source wiring', () => {
  it('places update checking after full sync and keeps sync behavior unboxed', async () => {
    const main = await readPluginFile('main.lua');
    const updateRowIndex = main.indexOf('return self:updateCheckMenuText()');
    const browseBlock = main.slice(main.indexOf('text = _("Browse library")'), main.indexOf('text = _("Auto sync this book")'));
    const fullSyncBlock = main.slice(main.indexOf('text = _("Sync all books now")'), updateRowIndex);
    const syncBehaviorBlock = main.slice(
      main.indexOf('return T(_("Periodically sync every # pages (%1)")'),
      main.indexOf('text = _("Sync this book now")'),
    );

    expect(main).toContain('function BookOrbit:updateCheckMenuText()');
    expect(browseBlock).toContain('separator = true');
    expect(fullSyncBlock).toContain('separator = true');
    expect(syncBehaviorBlock).not.toContain('separator = true');
    expect(updateRowIndex).toBeGreaterThan(main.indexOf('text = _("Sync all books now")'));
    expect(updateRowIndex).toBeLessThan(main.indexOf('return T(_("Last sync: %1")'));
    expect(main.indexOf('keep_menu_open = true,\n                callback = function()\n                    self:checkForUpdate()')).toBeGreaterThan(
      0,
    );
    expect(main).toContain('return T(_("Plugin update available: v%1 -> v%2"), PLUGIN_VERSION, self.settings.update_latest_version)');
    expect(main).toContain('return T(_("Installed plugin: v%1 (Check for update)"), PLUGIN_VERSION)');
    expect(main).toContain('return T(_("Installed plugin: v%1 (Login required)"), PLUGIN_VERSION)');
    expect(main).not.toContain('return T(_("Installed plugin: v%1"), PLUGIN_VERSION)');
  });

  it('throttles automatic update prompts and does not interrupt the catalog browser', async () => {
    const main = await readPluginFile('main.lua');

    expect(main).toContain('local UPDATE_CHECK_INTERVAL = 24 * 60 * 60');
    expect(main).toContain('update_check_last_at = 0');
    expect(main).toContain('function BookOrbit:maybeCheckForUpdate(interactive)');
    expect(main).toContain('self:handleUpdateVersionResponse(body, interactive, interactive or self.catalog_browser == nil)');
    expect(main).toContain('if not prompt_allowed then');
    expect(main).toContain('self.settings.update_dismissed_version = plugin_latest');
  });

  it('runs a throttled update check after successful full-library sweeps', async () => {
    const main = await readPluginFile('main.lua');
    const sweep = await readPluginFile('bookorbit_sweep.lua');

    expect(main).toContain('if not err then self:maybeCheckForUpdate(false) end');
    expect(sweep).toContain('on_finish = opts.on_finish');
    expect(sweep).toContain('pcall(ctx.on_finish, err)');
  });
});
