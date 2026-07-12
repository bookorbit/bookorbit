import { readFile } from 'fs/promises';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const pluginRoot = join(process.cwd(), '..', 'koreader-plugin', 'bookorbit.koplugin');

async function readPluginFile(name: string): Promise<string> {
  return readFile(join(pluginRoot, name), 'utf8');
}

describe('KOReader plugin update source wiring', () => {
  it('keeps top-level actions separate from nested settings', async () => {
    const menu = await readPluginFile('bookorbit_main_menu.lua');
    const updater = await readPluginFile('bookorbit_updater.lua');
    const dashboardIndex = menu.indexOf('id = "open_dashboard"');
    const updateRowIndex = menu.indexOf('self:updateCheckMenuText()');
    const syncThisIndex = menu.indexOf('text = _("Sync current book now")');
    const autoSyncIndex = menu.indexOf('text = _("Auto sync current book")');
    const syncAllIndex = menu.indexOf('text = _("Sync all books now")');
    const topLevelSettingsIndex = menu.indexOf('text = _("Settings")', dashboardIndex);
    const settingsMenuIndex = menu.indexOf('function MainMenu:settingsMenu');
    const dashboardSettingsIndex = menu.indexOf('text = _("Dashboard")', settingsMenuIndex);
    const syncSettingsIndex = menu.indexOf('text = _("Sync")', settingsMenuIndex);
    const pluginSettingsIndex = menu.indexOf('text = _("Plugin")', settingsMenuIndex);
    const accountIndex = menu.indexOf('text = _("Account & setup")');
    const topLevelActionBlock = menu.slice(dashboardIndex, topLevelSettingsIndex);
    const dashboardMenuBlock = menu.slice(menu.indexOf('function MainMenu:dashboardMenuItems'), menu.indexOf('function MainMenu:showDashboardMenu'));
    const dashboardSettingsBlock = menu.slice(
      menu.indexOf('function MainMenu:dashboardSettingsMenu'),
      menu.indexOf('function MainMenu:syncSettingsMenu'),
    );
    const syncSettingsBlock = menu.slice(menu.indexOf('function MainMenu:syncSettingsMenu'), menu.indexOf('function MainMenu:pluginSettingsMenu'));
    const pluginSettingsBlock = menu.slice(menu.indexOf('function MainMenu:pluginSettingsMenu'), settingsMenuIndex);

    expect(updater).toContain('function UpdateCheck:updateCheckMenuText()');
    expect(dashboardIndex).toBeGreaterThan(0);
    expect(dashboardIndex).toBeLessThan(syncThisIndex);
    expect(syncThisIndex).toBeLessThan(autoSyncIndex);
    expect(autoSyncIndex).toBeLessThan(syncAllIndex);
    expect(syncThisIndex).toBeLessThan(syncAllIndex);
    expect(syncAllIndex).toBeLessThan(topLevelSettingsIndex);
    expect(topLevelSettingsIndex).toBeLessThan(accountIndex);
    expect(dashboardSettingsIndex).toBeGreaterThan(settingsMenuIndex);
    expect(dashboardSettingsIndex).toBeLessThan(syncSettingsIndex);
    expect(syncSettingsIndex).toBeLessThan(pluginSettingsIndex);
    expect(topLevelActionBlock).not.toContain('self:updateCheckMenuText()');
    expect(topLevelActionBlock).toContain('id = "sync_current_book"');
    expect(topLevelActionBlock).toContain('id = "auto_sync_current_book"');
    expect(topLevelActionBlock).toContain('text = _("Auto sync current book")');
    expect(topLevelActionBlock).toContain('self:onBookOrbitToggleAutoSync(nil, true)');
    expect(dashboardSettingsBlock).toContain('return T(_("Open dashboard on startup (%1)"), self:catalogAutoOpenLabel())');
    expect(syncSettingsBlock).not.toContain('text = _("Auto sync current book")');
    expect(syncSettingsBlock).toContain('text = _("Two-way highlight sync")');
    expect(syncSettingsBlock).toContain('text = _("Skip auto-sync when offline")');
    expect(syncSettingsBlock).not.toContain('return T(_("Open dashboard on startup (%1)"), self:catalogAutoOpenLabel())');
    expect(syncSettingsBlock).toContain('return T(_("Periodically sync every # pages (%1)")');
    expect(syncSettingsBlock).toContain('return T(_("Sync to a newer state (%1)"), getNameStrategy(self.settings.sync_forward))');
    expect(syncSettingsBlock).toContain('return T(_("Sync to an older state (%1)"), getNameStrategy(self.settings.sync_backward))');
    expect(updateRowIndex).toBeGreaterThan(menu.indexOf('function MainMenu:pluginSettingsMenu'));
    expect(pluginSettingsBlock).toContain('self:updateCheckMenuText()');
    expect(pluginSettingsBlock).toContain('self:checkForUpdate()');
    expect(dashboardMenuBlock).toContain('local plugin_update = self:pluginSettingsMenu()[1]');
    expect(dashboardMenuBlock).toContain('plugin_update.separator = true');
    expect(dashboardMenuBlock).toContain('item.id ~= "sync_current_book"');
    expect(dashboardMenuBlock).toContain('item.id ~= "auto_sync_current_book"');
    expect(dashboardMenuBlock).toContain('include_plugin = false');

    expect(menu.indexOf('self:checkForUpdate()')).toBeGreaterThan(0);
    expect(updater).toContain('return T(_("Plugin update available: v%1 -> v%2"), PLUGIN_VERSION, self.settings.update_latest_version)');
    expect(updater).toContain('return T(_("Installed plugin: v%1 (Check for update)"), PLUGIN_VERSION)');
    expect(updater).toContain('return T(_("Installed plugin: v%1 (Login required)"), PLUGIN_VERSION)');
    expect(updater).not.toContain('return T(_("Installed plugin: v%1"), PLUGIN_VERSION)');
  });

  it('keeps manual sync actions above advanced sync settings', async () => {
    const menu = await readPluginFile('bookorbit_main_menu.lua');
    const dashboardIndex = menu.indexOf('id = "open_dashboard"');
    const settingsIndex = menu.indexOf('text = _("Settings")', dashboardIndex);
    const syncSettingsBlock = menu.slice(menu.indexOf('function MainMenu:syncSettingsMenu'), menu.indexOf('function MainMenu:pluginSettingsMenu'));

    expect(menu.indexOf('text = _("Sync current book now")')).toBeLessThan(settingsIndex);
    expect(menu.indexOf('text = _("Auto sync current book")')).toBeLessThan(settingsIndex);
    expect(menu.indexOf('text = _("Sync all books now")')).toBeLessThan(settingsIndex);
    expect(syncSettingsBlock).not.toContain('text = _("Sync current book now")');
    expect(syncSettingsBlock).not.toContain('text = _("Auto sync current book")');
    expect(syncSettingsBlock).not.toContain('text = _("Sync all books now")');
  });

  it('keeps tall dashboard adaptation scoped to measured Discover rows', async () => {
    const dashboard = await readPluginFile('bookorbit_catalog_dashboard.lua');

    expect(dashboard).toContain('local DASHBOARD_TALL_ASPECT_RATIO = 1.55');
    expect(dashboard).toContain('local DISCOVER_COMPACT_GAP = 6');
    expect(dashboard).toContain('local DISCOVER_MAX_ROWS = 2');
    expect(dashboard).toContain('local STATS_MIN_BODY_HEIGHT = 56');
    expect(dashboard).toContain('function CatalogDashboard:dashboardTallLayout()');
    expect(dashboard).toContain('function CatalogDashboard:addDashboardCoverGrid(');
    expect(dashboard).toContain('math.floor((self.content_w - (slots - 1) * gap) / slots)');
    expect(dashboard).toContain('local card_gap = slots > 1 and math.floor(math.max(0, self.content_w - slots * card_w) / (slots - 1)) or 0');
    expect(dashboard).toContain('if slot > 1 then');
    expect(dashboard).not.toContain('(slots + 1) * gap');
    expect(dashboard).toContain('discover_slots, discover_card_w, discover_row_h = self:discoverRowMetrics(#discover_books, discover_gap)');
    expect(dashboard).toContain('if fixedHeight() > avail then');
    expect(dashboard).toContain('discover_rows * discover_row_h + math.max(0, discover_rows - 1) * inner_gap');
    expect(dashboard).toContain('show_discover and self:dashboardTallLayout() and discover_slots > 0');
    expect(dashboard).toContain('local discover_page_size = math.max(1, discover_slots * discover_rows)');
    expect(dashboard).not.toContain('catalog_dashboard_max_height');
  });

  it('uses tall detail space for measured related-book grids', async () => {
    const detail = await readPluginFile('bookorbit_catalog_detail.lua');

    expect(detail).toContain('local DETAIL_RELATED_TALL_ASPECT_RATIO = 1.55');
    expect(detail).toContain('local DETAIL_RELATED_MAX_ROWS = 2');
    expect(detail).toContain('function CatalogDetail:detailTallLayout()');
    expect(detail).toContain('if self:detailTallLayout() then');
    expect(detail).toContain('local book_rows = math.ceil(#books / slots)');
    expect(detail).toContain('rows = math.min(DETAIL_RELATED_MAX_ROWS, math.max(1, book_rows))');
    expect(detail).toContain('while layout.rows > 1 and layout.total_h > height do');
    expect(detail).toContain('local page_count = math.max(1, math.ceil(#books / layout.page_size))');
    expect(detail).toContain('local focus_rows = { is_grid = true }');
    expect(detail).toContain('if section_focus.is_grid then');
  });

  it('reconciles remote progress before manual book sync uploads progress', async () => {
    const main = await readPluginFile('main.lua');
    const menu = await readPluginFile('bookorbit_main_menu.lua');
    const progress = await readPluginFile('bookorbit_progress_sync.lua');
    const bookSync = await readPluginFile('bookorbit_book_sync.lua');

    expect(progress).toContain('function ProgressSync:reconcileProgressBeforeBookSync(digest, on_done)');
    expect(progress).toContain('client:getProgress(digest)');
    expect(progress).toContain('local local_timestamp = self.last_page_turn_timestamp or 0');
    expect(progress).toContain('cancel_callback = function()');
    expect(progress).toContain('on_done(remote_newer)');
    expect(main).toContain('self:reconcileProgressBeforeBookSync(snap.digest, run_book_sync)');
    expect(main).toContain('local latest_snap = BookOrbitBookSync.capture(self)');
    expect(main).toContain('skip_progress = skip_progress');
    expect(main).toContain('event = "BookOrbitPullProgress"');
    expect(menu).not.toContain('text = _("Pull progress now")');
    expect(main).toContain('self.onPageUpdate = self._onPageUpdate\n    if self.settings.auto_sync then');
    expect(main).toContain('if self.settings.auto_sync and (self.periodic_push_scheduled');

    expect(bookSync).toContain('skip_progress = opts.skip_progress == true');
    expect(bookSync).toContain('if ctx.skip_progress then');
    expect(bookSync).toContain('Progress was not changed.');
  });

  it('keeps book action downloads compact without duplicating download options', async () => {
    const detail = await readPluginFile('bookorbit_catalog_detail.lua');
    const download = await readPluginFile('bookorbit_catalog_download.lua');
    const detailActionsBlock = detail.slice(
      detail.indexOf('function CatalogDetail:showBookActionSheet(detail, opts)'),
      detail.indexOf('function CatalogDetail:showDetailActions()'),
    );
    const detailHeaderBlock = detail.slice(
      detail.indexOf('function CatalogDetail:buildDetailButtons'),
      detail.indexOf('function CatalogDetail:updateDetailItems'),
    );

    expect(detailActionsBlock).toContain('text = self:downloadButtonLabel(supported_files)');
    expect(detailActionsBlock).toContain('self:downloadDefaultFile(detail, supported_files[1])');
    expect(detailActionsBlock).toContain('self:showFileChoices(detail)');
    expect(detailActionsBlock).toContain('text = _("Download options")');
    expect(detailActionsBlock).toContain('self:showDownloadOptions(detail)');
    expect(detailHeaderBlock).not.toContain('if #supported_files == 1 then');
    expect(detailHeaderBlock).not.toContain('self:downloadDefaultFile(detail, supported_files[1])');
    expect(detailHeaderBlock).not.toContain('self:showFileChoices(detail)');
    expect(detailHeaderBlock).toContain('self:showDownloadOptions(detail)');
    expect(download).toContain('function Catalog:downloadDefaultFile(detail, file)');
  });

  it('throttles automatic update prompts and does not interrupt the catalog browser', async () => {
    const main = await readPluginFile('main.lua');
    const updater = await readPluginFile('bookorbit_updater.lua');

    expect(updater).toContain('local UPDATE_CHECK_INTERVAL = 24 * 60 * 60');
    expect(main).toContain('update_check_last_at = 0');
    expect(updater).toContain('function UpdateCheck:maybeCheckForUpdate(interactive)');
    expect(updater).toContain('self:handleUpdateVersionResponse(body, interactive, interactive or self.catalog_browser == nil)');
    expect(updater).toContain('if not prompt_allowed then');
    expect(updater).toContain('self.settings.update_dismissed_version = plugin_latest');
  });

  it('renders the server version with exactly one v prefix in update dialogs', async () => {
    const updater = await readPluginFile('bookorbit_updater.lua');

    expect(updater).toContain('local server_ver = tostring(body.serverVersion or "unknown"):gsub("^v", "")');
    expect(updater).toContain('Plugin is up to date (v%1).\\nServer: v%2');
    expect(updater).toContain('Update available: v%1 -> v%2\\nServer: v%3');
  });

  it('runs a throttled update check after successful full-library sweeps', async () => {
    const main = await readPluginFile('main.lua');
    const sweep = await readPluginFile('bookorbit_sweep.lua');

    expect(main).toContain('self:requestUpdateCheck(false, "sweep_done")');
    expect(sweep).toContain('on_finish = opts.on_finish');
    expect(sweep).toContain('pcall(ctx.on_finish, err)');
  });

  it('wires bulk catalog downloads through a dedicated mixin and selection UI hooks', async () => {
    const catalog = await readPluginFile('bookorbit_catalog.lua');
    const detail = await readPluginFile('bookorbit_catalog_detail.lua');
    const bulk = await readPluginFile('bookorbit_catalog_bulk_download.lua');
    const download = await readPluginFile('bookorbit_catalog_download.lua');
    const menu = await readPluginFile('bookorbit_main_menu.lua');
    const main = await readPluginFile('main.lua');
    const widgets = await readPluginFile('bookorbit_catalog_widgets.lua');
    const downloadIcon = await readPluginFile('assets/bookorbit.download.svg');
    const refreshTapBlock = catalog.slice(
      catalog.indexOf('function BookOrbitCatalog:onRefreshButtonTap()'),
      catalog.indexOf('function BookOrbitCatalog:dashboardMode()'),
    );

    expect(catalog).toContain('local CatalogBulkDownload = require("bookorbit_catalog_bulk_download")');
    expect(catalog).toContain('CatalogBulkDownload.install(BookOrbitCatalog)');
    expect(catalog).toContain('self:initBulkDownloadState()');
    expect(catalog).toContain('text = _("Select books")');
    expect(catalog).toContain('text = _("Download...")');
    expect(catalog).toContain('function BookOrbitCatalog:showDownloadActions()');
    expect(catalog).toContain('text = _("Download selected")');
    expect(catalog).toContain('text = _("Download this page")');
    expect(catalog).toContain('text = _("Download all in this list")');
    expect(catalog).toContain('text = _("Settings")');
    expect(catalog).toContain('catalog_mosaic_show_titles');
    expect(catalog).toContain('function BookOrbitCatalog:setMosaicShowTitles(show_titles)');
    expect(catalog).toContain('text = titles_label');
    expect(catalog).toContain('self:showBulkSelectionActions()');
    expect(catalog).toContain('function BookOrbitCatalog:onMenuHoldSelect(item)');
    expect(detail).toContain('function CatalogDetail:showBookActionSheet(detail, opts)');
    expect(detail).toContain('function CatalogDetail:showBookActionSheetForEntry(item)');
    expect(catalog).toContain('function BookOrbitCatalog:isBulkSelectionActive()');
    expect(catalog).toContain('self:bulkHandleContextChange(self.current_context)');
    expect(catalog).toContain('function BookOrbitCatalog:titleBarSearchIcon()');
    expect(catalog).toContain('local DOWNLOAD_ICON = "appbar.filebrowser"');
    expect(catalog).toContain('local DOWNLOAD_ICON_FILE = "bookorbit.download.svg"');
    expect(catalog).toContain('local BookOrbitIconButton = IconButton:extend{ file = nil }');
    expect(catalog).toContain('file = self.search_icon_file');
    expect(catalog).toContain('function BookOrbitCatalog:titleBarSearchIconFile()');
    expect(catalog).toContain('search_icon_file = self:titleBarSearchIconFile()');
    expect(catalog).toContain('if self:detailMode() then return nil end');
    expect(catalog).toContain('return self:isBulkSelectionActive() and DOWNLOAD_ICON or "appbar.search"');
    expect(catalog).toContain('function BookOrbitCatalog:titleBarRefreshIcon()');
    expect(catalog).not.toContain('"move.down"');
    expect(catalog).toContain('search_icon_enabled = self:titleBarSearchEnabled()');
    expect(catalog).toContain('self:confirmBulkBooks(self:bulkSelectedBooks(), _("Selected books")');
    expect(refreshTapBlock).toContain('self:bulkExitSelectionMode()');
    expect(refreshTapBlock).not.toContain('self:bulkClearSelectedBooks(true)');
    expect(catalog).toContain('self:showBookActionSheetForEntry(item)');
    expect(detail).toContain('allow_select = item.kind == "book" and self:bookMode()');
    expect(catalog).toContain('text = _("Close BookOrbit")');
    expect(catalog).not.toContain('"appbar.download"');
    expect(catalog).not.toContain('close_callback = function() self:onClose() end');

    expect(bulk).toContain('function Catalog:confirmBulkAllMatching()');
    expect(bulk).toContain('function Catalog:bulkClearSelectedBooks(redraw)');
    expect(bulk).toContain('function Catalog:bulkQueueStep(ctx)');
    expect(bulk).toContain('text = _("Cancel after current file")');
    expect(bulk).toContain('text = _("Retry failed")');
    expect(bulk).toContain('label = _("EPUB first")');
    expect(bulk).toContain('label = _("PDF first")');
    expect(bulk).toContain('label = _("Comics first")');
    expect(bulk).toContain('label = _("Skip existing")');
    expect(bulk).toContain('text = _("Close BookOrbit")');
    expect(bulk).not.toContain('function Catalog:showDashboardActions()');
    expect(bulk).not.toContain('Download Continue reading');
    expect(bulk).not.toContain('Download Discover');
    expect(bulk).not.toContain('Download dashboard books');

    expect(download).toContain('local on_catalog_page = (self.bookMode and self:bookMode())');
    expect(download).toContain('elseif self.updateItems and on_catalog_page then');

    expect(menu).toContain('text = _("Close BookOrbit")');
    expect(menu).toContain('catalog:onCloseAllMenus()');
    expect(main).toContain('path = self.path');
    expect(main).toContain('catalog_mosaic_show_titles = false');

    expect(widgets).toContain('function CatalogWidgets.buildSelectionBadge(max_width)');
    expect(widgets).toContain('function CatalogWidgets.buildDownloadedBadge(max_width)');
    expect(widgets).toContain('icon = "appbar.filebrowser"');
    expect(widgets).toContain('function CatalogWidgets.buildCoverWithStateBadges');
    expect(widgets).toContain('local show_label = self.menu.mosaic_show_titles == true');
    expect(widgets).toContain('local label_text = shortText(book and book.title or _("Untitled"), 30)');
    expect(widgets).not.toContain('local label_text = self.menu:cellLabel(book)');
    expect(widgets).toContain('local function mosaicLabelFontSize(text, width, height)');
    expect(widgets).toContain('face = Font:getFace("cfont", mosaicLabelFontSize(label_text, label_w, label_h))');
    expect(widgets).toContain('local SELECTED_BACKGROUND = Blitbuffer.COLOR_LIGHT_GRAY');
    expect(widgets).toContain('fgcolor = selectedTextColor(selected)');
    expect(widgets).toContain('bgcolor = selectedTextBgColor(selected)');
    expect(widgets).toContain('background = selectedBackground(selected)');
    expect(widgets).toContain('function DashboardCoverCard:onHoldSelect()');
    expect(widgets).toContain('self.menu:onMenuHoldSelect(self.entry)');
    expect(widgets).toContain('self.menu:bulkIsBookSelected(book)');
    expect(widgets).toContain('self.menu:isOnDevice(book)');
    expect(downloadIcon).toContain('<svg');
    expect(downloadIcon).toContain('M24 7v24');
  });

  it('revalidates current-book matches and sends metadata when checking live books', async () => {
    const bookSync = await readPluginFile('bookorbit_book_sync.lua');
    const statsReader = await readPluginFile('bookorbit_stats_reader.lua');

    expect(statsReader).toContain('function BookOrbitStatsReader.getBook(md5)');
    expect(statsReader).toContain('if title == "" then title = nil end');
    expect(statsReader).toContain('if authors == "" then authors = nil end');
    expect(statsReader).toContain('if title then entry.title = title end');
    expect(statsReader).toContain('if authors then entry.authors = authors end');
    expect(bookSync).toContain('local metadata = BookOrbitStatsReader.getBook(digest) or {}');
    expect(bookSync).toContain('local stats_ambiguous = metadata.metadata_ambiguous == true');
    expect(bookSync).toContain('title = stats_ambiguous and titleFromFile(file) or (metadata.title or titleFromFile(file))');
    expect(bookSync).toContain('authors = stats_ambiguous and nil or metadata.authors');
    expect(bookSync).toContain('last_open = metadata.last_open or ts');
    expect(bookSync).toContain('metadata_ambiguous = false');
    expect(bookSync).toContain('stats_metadata_ambiguous = stats_ambiguous');
    expect(bookSync).toContain('local body, err = ctx.client:matchCheck({ ctx.snap.digest }, {');
    expect(bookSync).toContain('title = ctx.snap.title');
    expect(bookSync).toContain('authors = ctx.snap.authors');
    expect(bookSync).toContain('last_open = ctx.snap.last_open');
    expect(bookSync).toContain('source = "current_file"');
    expect(bookSync).toContain('metadata_ambiguous = ctx.snap.metadata_ambiguous');
    expect(bookSync).toContain('if ctx.snap.stats_metadata_ambiguous then');
    expect(bookSync).toContain('ctx.state:setMatched(match.hash, match.bookFileId, match.bookId, ctx.snap.file)');
    expect(bookSync).not.toContain(
      'if book then\n        if ctx.snap.file and not book.file then\n            book.file = ctx.snap.file\n        end\n        return step(ctx, stepStats)\n    end',
    );
  });

  it('rechecks matched local hashes during full-library revalidation', async () => {
    const sweep = await readPluginFile('bookorbit_sweep.lua');

    expect(sweep).toContain('if ctx.full_recheck then\n            queue(md5)\n        elseif not ctx.state:getBook(md5) then');
    expect(sweep).toContain('for md5 in pairs(ctx.state.books) do\n            queue(md5)\n        end');
  });

  it('marks unmatched match-check candidates by source and ambiguity', async () => {
    const api = await readPluginFile('bookorbit_api.lua');
    const sweep = await readPluginFile('bookorbit_sweep.lua');
    const statsReader = await readPluginFile('bookorbit_stats_reader.lua');

    expect(api).toContain('source = cand.source');
    expect(api).toContain('metadataAmbiguous = cand.metadata_ambiguous');
    expect(statsReader).toContain('entry.metadata_ambiguous = (entry._variant_count or 0) > 1');
    expect(sweep).toContain('source = "statistics"');
    expect(sweep).toContain('metadata_ambiguous = entry.metadata_ambiguous');
    expect(sweep).toContain('stats_metadata_ambiguous = entry.metadata_ambiguous');
    expect(sweep).toContain('local file_exists = lfs.attributes(file, "mode") == "file"');
    expect(sweep).toContain('cand.source = "file"');
    expect(sweep).toContain('cand.metadata_ambiguous = false');
    expect(sweep).toContain('if cand.stat_ids and not cand.stats_metadata_ambiguous and ctx.state:getBook(md5) then');
  });
});
