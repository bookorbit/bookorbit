import { readFile } from 'fs/promises';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const pluginRoot = join(process.cwd(), '..', 'koreader-plugin', 'bookorbit.koplugin');

async function readPluginFile(name: string): Promise<string> {
  return readFile(join(pluginRoot, name), 'utf8');
}

describe('KOReader plugin update source wiring', () => {
  it('keeps update status on the first BookOrbit menu page and groups advanced settings', async () => {
    const main = await readPluginFile('main.lua');
    const dashboardIndex = main.indexOf('text = _("Open dashboard")');
    const updateRowIndex = main.indexOf('return self:updateCheckMenuText()');
    const lastSyncIndex = main.indexOf('return T(_("Last sync: %1")');
    const syncThisIndex = main.indexOf('text = _("Sync this book now")');
    const syncAllIndex = main.indexOf('text = _("Sync all books now")');
    const autoSyncIndex = main.indexOf('text = _("Auto sync this book")');
    const twoWayIndex = main.indexOf('text = _("Two-way highlight sync")');
    const syncSettingsIndex = main.indexOf('text = _("Sync settings")');
    const accountIndex = main.indexOf('text = _("Account & setup")');
    const syncSettingsBlock = main.slice(syncSettingsIndex, accountIndex);
    const autoSyncBlock = main.slice(autoSyncIndex, syncSettingsIndex);

    expect(main).toContain('function BookOrbit:updateCheckMenuText()');
    expect(dashboardIndex).toBeGreaterThan(0);
    expect(updateRowIndex).toBeGreaterThan(dashboardIndex);
    expect(updateRowIndex).toBeLessThan(lastSyncIndex);
    expect(lastSyncIndex).toBeLessThan(syncThisIndex);
    expect(syncThisIndex).toBeLessThan(syncAllIndex);
    expect(syncAllIndex).toBeLessThan(autoSyncIndex);
    expect(autoSyncIndex).toBeLessThan(twoWayIndex);
    expect(twoWayIndex).toBeLessThan(syncSettingsIndex);
    expect(syncSettingsIndex).toBeLessThan(accountIndex);
    expect(autoSyncBlock).toContain('separator = true');
    expect(syncSettingsBlock).toContain('return T(_("Open dashboard on startup (%1)"), self:catalogAutoOpenLabel())');
    expect(syncSettingsBlock).toContain('return T(_("Periodically sync every # pages (%1)")');
    expect(syncSettingsBlock).toContain('return T(_("Sync to a newer state (%1)"), getNameStrategy(self.settings.sync_forward))');
    expect(syncSettingsBlock).toContain('return T(_("Sync to an older state (%1)"), getNameStrategy(self.settings.sync_backward))');
    expect(
      main
        .slice(main.indexOf('return T(_("Periodically sync every # pages (%1)")'), main.indexOf('return T(_("Sync to a newer state (%1)")'))
        .includes('separator = true'),
    ).toBe(false);

    expect(main.indexOf('keep_menu_open = true,\n                callback = function()\n                    self:checkForUpdate()')).toBeGreaterThan(
      0,
    );
    expect(main).toContain('return T(_("Plugin update available: v%1 -> v%2"), PLUGIN_VERSION, self.settings.update_latest_version)');
    expect(main).toContain('return T(_("Installed plugin: v%1 (Check for update)"), PLUGIN_VERSION)');
    expect(main).toContain('return T(_("Installed plugin: v%1 (Login required)"), PLUGIN_VERSION)');
    expect(main).not.toContain('return T(_("Installed plugin: v%1"), PLUGIN_VERSION)');
  });

  it('keeps manual sync actions above advanced sync settings', async () => {
    const main = await readPluginFile('main.lua');
    const syncSettingsBlock = main.slice(
      main.indexOf('return T(_("Periodically sync every # pages (%1)")'),
      main.indexOf('text = _("Account & setup")'),
    );

    expect(main.indexOf('text = _("Sync this book now")')).toBeLessThan(main.indexOf('text = _("Sync settings")'));
    expect(main.indexOf('text = _("Sync all books now")')).toBeLessThan(main.indexOf('text = _("Sync settings")'));
    expect(syncSettingsBlock).not.toContain('text = _("Sync this book now")');
    expect(syncSettingsBlock).not.toContain('text = _("Sync all books now")');
  });

  it('keeps the primary detail download as a default download and puts customization in options', async () => {
    const catalog = await readPluginFile('bookorbit_catalog.lua');
    const download = await readPluginFile('bookorbit_catalog_download.lua');
    const detailActionsBlock = catalog.slice(
      catalog.indexOf('function BookOrbitCatalog:showDetailActions()'),
      catalog.indexOf('function BookOrbitCatalog:showSetStatusDialog'),
    );
    const detailHeaderBlock = catalog.slice(
      catalog.indexOf('function BookOrbitCatalog:buildDetailHeader'),
      catalog.indexOf('function BookOrbitCatalog:updateDetailItems'),
    );

    expect(detailActionsBlock).toContain('text = _("Download options")');
    expect(detailActionsBlock).toContain('self:showDownloadOptions(detail)');
    expect(detailHeaderBlock).toContain('if #supported_files == 1 then');
    expect(detailHeaderBlock).toContain('self:downloadDefaultFile(detail, supported_files[1])');
    expect(detailHeaderBlock).toContain('self:showFileChoices(detail)');
    expect(download).toContain('function Catalog:downloadDefaultFile(detail, file)');
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
