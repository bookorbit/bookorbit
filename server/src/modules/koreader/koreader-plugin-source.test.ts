import { readFile } from 'fs/promises';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const pluginRoot = join(process.cwd(), '..', 'koreader-plugin', 'bookorbit.koplugin');

async function readPluginFile(name: string): Promise<string> {
  const source = await readFile(join(pluginRoot, name), 'utf8');
  return source.replace(/\r\n/g, '\n');
}

describe('KOReader plugin update source wiring', () => {
  it("opens BookOrbit from KOReader's menu bar and keeps Tools to two rows", async () => {
    const menu = await readPluginFile('bookorbit_main_menu.lua');
    const pin = await readPluginFile('bookorbit_menu_pin.lua');
    const updater = await readPluginFile('bookorbit_updater.lua');
    const toolsBlock = menu.slice(
      menu.indexOf('function MainMenu:addToMainMenu(menu_items)'),
      menu.indexOf('-- ----------------------------------------------------------------- openers'),
    );

    expect(toolsBlock).toContain('id = "open_dashboard"');
    expect(toolsBlock).toContain('text = _("Open BookOrbit")');
    expect(toolsBlock).toContain('id = "this_book"');
    expect(toolsBlock).toContain('id = "settings"');
    expect(toolsBlock).toContain('sorting_hint = "tools"');
    expect(toolsBlock).toContain('menu_items.bookorbit_tab = {');
    expect(toolsBlock).toContain('remember = false');
    expect(toolsBlock).toContain('callback = function() self:onMenuBarIcon() end');
    expect(toolsBlock).toContain('if self:menuBarIconEnabled() then');
    expect(menu).toContain('UIManager:tickAfterNext(function()');
    expect(menu).toContain('return string.rep("../", 32) .. path:gsub("^/+", ""):gsub("%.svg$", "")');
    expect(menu).not.toContain('Account & setup');
    expect(menu).not.toContain('Open dashboard');
    expect(menu).not.toContain('function MainMenu:dashboardMenuItems');
    expect(menu).not.toContain('function MainMenu:showDashboardMenu');

    expect(pin).toContain('local TAB_ID = "bookorbit_tab"');
    expect(pin).toContain('local function normalizeButtons(buttons, with_tab)');
    expect(pin).toContain('local function normalizeRuntimeOrder(order)');
    expect(pin).toContain('local function migrateOverride(prefix)');
    expect(pin).toContain('normalizeRuntimeOrder(order)');
    expect(pin).not.toContain('order[BUTTONS] = copyList');

    expect(updater).toContain('function UpdateCheck:updateCheckMenuText()');
    expect(updater).toContain('return T(_("Plugin update available: v%1 -> v%2"), PLUGIN_VERSION, self.settings.update_latest_version)');
    expect(updater).toContain('return T(_("Installed plugin: v%1 (Check for update)"), PLUGIN_VERSION)');
    expect(updater).toContain('return T(_("Installed plugin: v%1 (Login required)"), PLUGIN_VERSION)');
    expect(updater).not.toContain('return T(_("Installed plugin: v%1"), PLUGIN_VERSION)');
  });

  it("keeps every setting one level deep on BookOrbit's own settings page", async () => {
    const settings = await readPluginFile('bookorbit_settings_page.lua');
    const sheet = await readPluginFile('bookorbit_menu_sheet.lua');
    const menu = await readPluginFile('bookorbit_main_menu.lua');

    expect(settings).toContain('function Settings.open(plugin, catalog, view)');
    expect(settings).toContain('{ kind = "toggle-auto" }');
    expect(settings).toContain('{ kind = "flag", key = "skip_sync_when_offline" }');
    expect(settings).toContain('{ kind = "flag", key = "annotation_sync" }');
    expect(settings).toContain('act("sync_forward")');
    expect(settings).toContain('act("sync_backward")');
    expect(settings).toContain('settings.catalog_auto_open = action.mode');
    expect(settings).toContain('"home"');
    expect(settings).toContain('plugin:checkForUpdate()');
    expect(settings).toContain('plugin:showDiagnostics()');
    expect(sheet).toContain('{ kind = "settings" }');
    expect(sheet).toContain('{ kind = "status" }');
    expect(menu).toContain('function MainMenu:diagnosticsRows()');
  });

  it("puts this book's sync in the This book sheet", async () => {
    const sheet = await readPluginFile('bookorbit_book_sheet.lua');
    const main = await readPluginFile('main.lua');
    const progress = await readPluginFile('bookorbit_progress_sync.lua');

    expect(sheet).toContain('plugin:onBookOrbitSyncBook({');
    expect(sheet).toContain('quiet = true');
    expect(sheet).toContain('plugin:onBookOrbitToggleAutoSync(nil, true, true)');
    expect(sheet).toContain('plugin:syncToProgress(remote.progress, remote.percentage)');
    expect(main).toContain('event = "BookOrbitThisBook"');
    expect(main).toContain('title = _("BookOrbit: open")');
    expect(progress).toContain('function ProgressSync:fetchRemoteProgress(digest, on_done, force)');
    expect(progress).toContain('self:rememberRemoteProgress(digest, body)');
  });

  it('renders the canonical account reading streak on the device dashboard', async () => {
    const boardData = await readPluginFile('bookorbit_board_data.lua');
    const catalogUtil = await readPluginFile('bookorbit_catalog_util.lua');

    expect(catalogUtil).toContain('function CatalogUtil.readingStreakDays(dashboard, fallback)');
    expect(catalogUtil).toContain('dashboard and dashboard.readingStreak');
    expect(catalogUtil).toContain('reading_streak and tonumber(reading_streak.currentStreak)');
    expect(boardData).toContain('current = CatalogUtil.readingStreakDays(body, 0),');
    expect(boardData).not.toContain('streak_days');
  });

  it('fits the book detail page to the screen with the shelf on the main page', async () => {
    const view = await readPluginFile('bookorbit_detail_view.lua');
    const data = await readPluginFile('bookorbit_detail_data.lua');

    expect(view).toContain('function DetailView.build(ctx)');
    expect(view).toContain('local order = { spec = 1, about = 2, chips = 3, series = 4, similar = 5 }');
    expect(view).toContain('local function fill(avail, gap, parts)');
    expect(view).toContain('local pager = page == 1 and DetailView.pager(d, w) or nil');
    expect(data).toContain('local tagged = #(detail.genres or {}) + #(detail.tags or {}) > 0');
    expect(data).toContain('function DetailData.mainShelf(detail, shelves, author, chosen)');
    expect(data).toContain('DetailData.mainShelf(detail, shelves, d.author_first, context.detail_shelf)');
    expect(data).toContain('type(detail.seriesMembers) == "table"');
  });

  it('names read-along EPUBs only when they carry narration', async () => {
    const detail = await readPluginFile('bookorbit_catalog_detail.lua');
    const data = await readPluginFile('bookorbit_detail_data.lua');

    expect(detail).toContain('return file.downloadVariant == "audioless_epub" and file.sourceMediaOverlayAvailable == true');
    expect(detail).toContain('label = T(_("%1 (text only)"), label)');
    expect(detail).not.toContain('Read Along (audio removed)');
    expect(data).toContain('local read_along = fmt == "epub" and file.sourceMediaOverlayAvailable == true');
    expect(data).toContain('if bytes == nil and not read_along then bytes = file.sourceSizeBytes end');
  });

  it('syncs book data first and asks about remote progress before the position goes up', async () => {
    const main = await readPluginFile('main.lua');
    const menu = await readPluginFile('bookorbit_main_menu.lua');
    const progress = await readPluginFile('bookorbit_progress_sync.lua');
    const bookSync = await readPluginFile('bookorbit_book_sync.lua');

    expect(progress).toContain('function ProgressSync:reconcileProgressBeforeBookSync(digest, on_done)');
    expect(progress).toContain('client:getProgress(digest)');
    expect(progress).toContain('local local_timestamp = self.last_page_turn_timestamp or 0');
    expect(progress).toContain('openPrompt(self, body, remote_newer, true, function()');
    expect(progress).toContain('on_done(remote_newer)');
    expect(main).toContain('self:syncBookThenProgress(snap.digest, run_book_sync)');
    expect(progress).toContain('run_book_sync(true, function()');
    expect(progress).toContain('if not skip_progress then self:pushProgressAfterBookSync(digest) end');
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
    const peek = await readPluginFile('bookorbit_book_peek.lua');
    const detailActionsBlock = detail.slice(
      detail.indexOf('function CatalogDetail:showBookActionSheet(detail, opts)'),
      detail.indexOf('function CatalogDetail:showBookActionSheetForEntry(item)'),
    );
    const primaryBlock = detail.slice(
      detail.indexOf('function CatalogDetail:detailPrimary(d, detail, from_cover)'),
      detail.indexOf('function CatalogDetail:showDetailHighlights(d)'),
    );

    // The long-press sheet downloads the file it names; the choices live in
    // the download sheet behind Download options.
    expect(detailActionsBlock).toContain('require("bookorbit_book_peek").open(self, detail, { allow_select = opts.allow_select })');
    expect(peek).toContain('catalog:downloadDefaultFile(detail, d.file)');
    expect(peek).toContain('label = _("Download options")');
    expect(peek).toContain('catalog:showDownloadOptions(detail)');
    // The page's action downloads the file it names; the choices live in the menu.
    expect(primaryBlock).toContain('return self:downloadDefaultFile(detail, p.entry.file)');
    expect(primaryBlock).not.toContain('self:showFileChoices(detail)');
    expect(detail).toContain('action = { kind = "download-options" }');
    expect(download).toContain('function Catalog:downloadDefaultFile(detail, file)');
    expect(download).toContain('DownloadSheet.open(self, detail)');
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
    const sheet = await readPluginFile('bookorbit_update_sheet.lua');

    expect(updater).toContain('local server_ver = tostring(body.serverVersion or "unknown"):gsub("^v", "")');
    expect(updater).toContain('BookOrbit is up to date, v%1"), tostring(PLUGIN_VERSION):gsub("^v", "")');
    expect(updater).toContain(
      'require("bookorbit_update_sheet").open(self, { current = PLUGIN_VERSION, latest = plugin_latest, server = server_ver })',
    );
    // Every version the update sheet shows gets exactly one v.
    expect(sheet).toContain('return "v" .. version:gsub("^v", "")');
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
    const sheet = await readPluginFile('bookorbit_menu_sheet.lua');
    const bulkSheet = await readPluginFile('bookorbit_bulk_sheet.lua');
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
    // Download... opens one plan sheet offering the selection, the page and
    // the whole list.
    expect(catalog).toContain('label = _("The books you selected")');
    expect(catalog).toContain('label = _("This page")');
    expect(catalog).toContain('label = _("Everything in this list")');
    expect(catalog).toContain('require("bookorbit_bulk_sheet").openPlan(self, {');
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
    expect(bulkSheet).toContain('_("Stop after this book")');
    expect(bulkSheet).toContain('MenuUI.pill(_("Retry failed")');
    expect(bulk).toContain('label = _("EPUB first")');
    expect(bulk).toContain('label = _("PDF first")');
    expect(bulk).toContain('label = _("Comics first")');
    expect(bulk).toContain('label = _("Skip existing")');
    expect(bulk).not.toContain('function Catalog:showDashboardActions()');
    expect(bulk).not.toContain('Download Continue reading');
    expect(bulk).not.toContain('Download Discover');
    expect(bulk).not.toContain('Download dashboard books');

    expect(bulk).toContain('local MANIFEST_FEATURE = "catalogBulkManifest"');
    expect(bulk).toContain('self.client:catalogManifest(params)');
    expect(bulk).toContain('function Catalog:bulkCommitCheckpoint(ctx)');
    expect(bulk).toContain('BookOrbitStateManager.linkFiles(links)');
    expect(bulk).not.toContain('MAX_PAGES = 200');

    expect(download).toContain('local on_catalog_page = (self.bookMode and self:bookMode())');
    expect(download).toContain('elseif self.updateItems and on_catalog_page then');
    expect(download).toContain('local Transfer = require("bookorbit_download_transfer")');

    expect(sheet).toContain('_("Close BookOrbit")');
    expect(menu).toContain('catalog:onCloseAllMenus()');
    expect(main).toContain('path = self.path');
    expect(main).toContain('catalog_mosaic_show_titles = false');

    expect(widgets).toContain('function CatalogWidgets.buildSelectionBadge(max_width)');
    expect(widgets).toContain('function CatalogWidgets.buildDownloadedBadge(max_width)');
    expect(widgets).toContain('local opts = iconOrFile("appbar.filebrowser", CatalogWidgets.assetIconFile("on_device"))');
    expect(widgets).toContain('function CatalogWidgets.buildCoverWithStateBadges');
    expect(widgets).toContain('local show_label = self.menu.mosaic_show_titles == true');
    expect(widgets).toContain('local label_text = shortText(book and book.title or _("Untitled"), 30)');
    expect(widgets).not.toContain('local label_text = self.menu:cellLabel(book)');
    expect(widgets).toContain('local function mosaicLabelFontSize(text, width, height)');
    expect(widgets).toContain('face = BoardMetrics.namedFace("cfont", mosaicLabelFontSize(label_text, label_w, label_h))');
    expect(widgets).toContain('local SELECTED_BACKGROUND = Blitbuffer.COLOR_LIGHT_GRAY');
    expect(widgets).toContain('fgcolor = selectedTextColor(selected)');
    expect(widgets).toContain('bgcolor = selectedTextBgColor(selected)');
    expect(widgets).toContain('background = selectedBackground(selected)');
    expect(detail).toContain('return self:showBookActionSheetForEntry({ kind = "dashboard-book", book_id = action.book_id })');
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
    // Identity is primed after reader ready so the lifecycle handlers open no
    // database; a cold cache still resolves through the same lookup.
    expect(bookSync).toContain('local metadata, cached = BookOrbitStatsReader.cachedIdentity(digest)');
    expect(bookSync).toContain('metadata = BookOrbitStatsReader.primeIdentity(digest)');
    expect(statsReader).toContain('function BookOrbitStatsReader.primeIdentity(md5)');
    expect(statsReader).toContain('local book = BookOrbitStatsReader.getBook(md5)');
    expect(bookSync).toContain('local current_stats_id = stats and tonumber(stats.id_curr_book) or nil');
    expect(bookSync).toContain('local stats_ambiguous = current_stats_id == nil and metadata.stats_ambiguous == true');
    expect(bookSync).toContain('table.insert(stats_ids, current_stats_id)');
    expect(bookSync).toContain('title = stats_ambiguous and titleFromFile(file) or (metadata.title or titleFromFile(file))');
    expect(bookSync).toContain('authors = stats_ambiguous and nil or metadata.authors');
    expect(bookSync).toContain('last_open = metadata.last_open or ts');
    expect(bookSync).toContain('metadata_ambiguous = false');
    expect(bookSync).toContain('stats_metadata_ambiguous = stats_ambiguous');
    expect(bookSync).toContain('stats_row_ambiguous = current_stats_row ~= nil and metadata.stats_ambiguous == true');
    expect(bookSync).toContain('and not ctx.snap.stats_row_ambiguous');
    expect(bookSync).toContain('local body, err = ctx.client:matchCheck({ ctx.snap.digest }, {');
    expect(bookSync).toContain('title = ctx.snap.title');
    expect(bookSync).toContain('authors = ctx.snap.authors');
    expect(bookSync).toContain('last_open = ctx.snap.last_open');
    expect(bookSync).toContain('source = "current_file"');
    expect(bookSync).toContain('book_file_id = matchedFileCandidate(ctx, book)');
    expect(bookSync).toContain('if not ctx.snap.stats_row_ambiguous then return book and book.fileId or nil end');
    expect(bookSync).toContain('metadata_ambiguous = ctx.snap.metadata_ambiguous');
    expect(bookSync).toContain('if ctx.snap.stats_metadata_ambiguous then');
    expect(bookSync).toContain('ctx.state:setMatched(match.hash, match.bookFileId, match.bookId, ctx.snap.file)');
    expect(bookSync).toContain('if ctx.snap.stats_row_ambiguous then upload.bookFileId = stats_target.bookFileId end');
    expect(bookSync).not.toContain(
      'if book then\n        if ctx.snap.file and not book.file then\n            book.file = ctx.snap.file\n        end\n        return step(ctx, stepStats)\n    end',
    );
  });

  it('rechecks matched local hashes during full-library revalidation', async () => {
    const sweep = await readPluginFile('bookorbit_sweep.lua');

    expect(sweep).toContain('if ctx.full_recheck then\n            queue(md5)\n        else\n            local book = ctx.state:getBook(md5)');
    expect(sweep).toContain('for md5 in pairs(ctx.state.books) do\n            queue(md5)\n        end');
  });

  it('marks unmatched match-check candidates by source and ambiguity', async () => {
    const api = await readPluginFile('bookorbit_api.lua');
    const sweep = await readPluginFile('bookorbit_sweep.lua');
    const statsReader = await readPluginFile('bookorbit_stats_reader.lua');

    expect(api).toContain('title = boundedUtf8(cand.title, MATCH_TITLE_MAX_BYTES)');
    expect(api).toContain('authors = boundedUtf8(cand.authors, MATCH_AUTHORS_MAX_BYTES)');
    expect(api).toContain('lastOpen = nonNegativeInteger(cand.last_open)');
    expect(api).toContain('source = validMatchSource(cand.source)');
    expect(api).toContain('metadataAmbiguous = optionalBoolean(cand.metadata_ambiguous)');
    expect(statsReader).toContain('entry.metadata_ambiguous = (entry._variant_count or 0) > 1');
    expect(statsReader).toContain('entry.stats_ambiguous = #entry.ids > 1');
    expect(sweep).toContain('source = "statistics"');
    expect(sweep).toContain('metadata_ambiguous = entry.metadata_ambiguous');
    expect(sweep).toContain('stats_metadata_ambiguous = entry.stats_ambiguous');
    expect(sweep).toContain('local file_exists = lfs.attributes(file, "mode") == "file"');
    expect(sweep).toContain('cand.source = "file"');
    expect(sweep).toContain('cand.metadata_ambiguous = false');
    expect(sweep).toContain('for _, row in ipairs(cand.stats_rows or {}) do');
    expect(sweep).toContain('if item.book_file_id then upload.bookFileId = item.book_file_id end');
    expect(sweep).toContain('%1 books need to be opened and synced once to recover their reading history.');
  });

  it('takes account fields and list filters in the BookOrbit text panel', async () => {
    const signIn = await readPluginFile('bookorbit_signin_page.lua');
    const menu = await readPluginFile('bookorbit_main_menu.lua');
    const catalog = await readPluginFile('bookorbit_catalog.lua');
    const entry = await readPluginFile('bookorbit_text_entry.lua');

    for (const source of [signIn, menu, catalog]) {
      expect(source).not.toContain('InputDialog:new');
    }
    expect(entry).toContain('show_password_toggle = false');
    expect(entry).toContain('{ kind = "reveal" }');
    expect(signIn).toContain('password = { title = _("Password"), icon = "key-round", password = true }');
    expect(menu).toContain('require("bookorbit_text_entry").open{');
    expect(catalog).toContain('title = _("Filter this list")');
  });
});
