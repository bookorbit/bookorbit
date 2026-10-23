--[[--
Main menu mixin for the BookOrbit plugin.

KOReader's side of BookOrbit: an icon in KOReader's top menu bar that opens
BookOrbit in one tap (in a book, the This book sheet), a trimmed Tools entry
for anyone who turns the icon off, and the openers for BookOrbit's own menu
sheet, settings, sync status and sign-in pages. Those pages load on first
use. Installed onto the plugin controller as regular methods.
]]

local Device = require("device")
local InfoMessage = require("ui/widget/infomessage")
local NetworkMgr = require("ui/network/manager")
local UIManager = require("ui/uimanager")
local md5 = require("ffi/sha2").md5
local T = require("ffi/util").template
local _ = require("gettext")

local BookOrbitApi = require("bookorbit_api")
local BookOrbitHighlightDiagnostics = require("bookorbit_highlight_diagnostics")
local BookOrbitSweep = require("bookorbit_sweep")
local BoardStore = require("bookorbit_board_store")

local MainMenu = {}

local function formatBool(value)
    return value and _("On") or _("Off")
end

local function formatTime(ts)
    ts = tonumber(ts)
    if not ts or ts <= 0 then return _("never") end
    return os.date("%Y-%m-%d %H:%M", ts)
end

local function formatShortTime(ts)
    ts = tonumber(ts)
    if not ts or ts <= 0 then return _("never") end
    return os.date("%H:%M", ts)
end

local function deviceIdPrefix(device_id)
    if type(device_id) ~= "string" or device_id == "" then return _("unknown") end
    return device_id:sub(1, 8)
end

local function versionText(version)
    if type(version) ~= "string" or version == "" then return _("unknown") end
    return "v" .. version:gsub("^v", "")
end

local function recordText(entry)
    if type(entry) ~= "table" then return _("none") end
    local when = formatTime(entry.at)
    local message = entry.message or entry.event or _("unknown")
    return T(_("%1 at %2"), tostring(message), when)
end

local function highlightRecordText(entry)
    return BookOrbitHighlightDiagnostics.lastSyncText(entry, formatShortTime)
end

local function jobText(job)
    if type(job) ~= "table" then return _("none") end
    return tostring(job.label or job.family or _("unknown"))
end

local function jobStartedText(job)
    if type(job) ~= "table" then return _("none") end
    return formatTime(job.started_at)
end

local function safeDocumentDigest(plugin, has_open_book)
    if not has_open_book or not plugin.getDocumentDigest then return nil end
    local ok, digest = pcall(plugin.getDocumentDigest, plugin)
    if ok then return digest end
end

local function hasReaderBook(plugin)
    return plugin.ui and plugin.ui.document ~= nil
end

local function hasCredentials(settings)
    return settings.server_url ~= nil and settings.username ~= nil and settings.userkey ~= nil
end

-- What the sync knows, in sections for the Technical details page. Each
-- section: title and rows ({ label, value }); actions: { kind, label, icon }.
function MainMenu:diagnosticsSections()
    local status = BookOrbitSweep.syncStatus()
    local sync_status = self.getSyncCoordinatorStatus and self:getSyncCoordinatorStatus() or { pending_count = 0 }
    local outbox_status = self.getLifecycleOutboxStatus and self:getLifecycleOutboxStatus()
        or { count = 0, bytes = 0, blocked = 0 }
    local has_open_book = hasReaderBook(self)
    local digest = safeDocumentDigest(self, has_open_book)
    local scheduler = self.open_annotation_scheduler and self.open_annotation_scheduler:status() or nil
    local logged_in = self:isLoggedIn()
    local DeviceNames = require("bookorbit_device_names")
    local model = Device.model
    local device_name = DeviceNames.label(model) or _("unknown")
    if model and device_name ~= model then device_name = T(_("%1 (%2)"), device_name, model) end

    local sections = {
        { title = _("This device"), rows = {
            { _("Device"), device_name },
            { _("Device ID"), deviceIdPrefix(self.device_id) },
            { _("Plugin"), versionText(self.PLUGIN_VERSION) },
            { _("Latest plugin"), versionText(self.settings.update_latest_version) },
        } },
        { title = _("Account"), rows = {
            { _("Server"), self.settings.server_url or _("not set") },
            { _("Username"), self.settings.username or _("not set") },
            { _("Login"), logged_in and _("configured") or _("not configured") },
        } },
    }
    local actions = {}

    if not logged_in then
        if self.settings.last_error then
            table.insert(sections, { title = _("Last results"), rows = { { _("Last error"), recordText(self.settings.last_error) } } })
        end
        if hasCredentials(self.settings) then
            table.insert(actions, { kind = "test", label = _("Test connection"), icon = "wifi" })
        end
        return { sections = sections, actions = actions }
    end

    -- Short sections first, so the first page is full.
    table.insert(sections, { title = _("Last results"), rows = {
        { _("Last sync"), recordText(self.settings.last_sync) },
        { _("Last error"), recordText(self.settings.last_error) },
    } })

    table.insert(sections, { title = _("Library"), rows = {
        { _("Last sweep"), formatTime(status.lastSweepAt) },
        { _("Matched local books"), tostring(status.matched or 0) },
        { _("Unmatched local books"), tostring(status.unmatched or 0) },
    } })
    table.insert(sections, { title = _("Sync"), rows = {
        { _("Auto sync"), formatBool(self.settings.auto_sync) },
        { _("Two-way highlights & bookmarks"), formatBool(self.settings.annotation_sync) },
        { _("Skip offline auto-sync"), formatBool(self.settings.skip_sync_when_offline) },
        { _("Current sync"), jobText(sync_status.current) },
        { _("Current sync started"), jobStartedText(sync_status.current) },
        { _("Next sync"), jobText(sync_status.next) },
        { _("Pending syncs"), tostring(sync_status.pending_count or 0) },
        { _("Pending lifecycle syncs"), tostring(outbox_status.count or 0) },
        { _("Parked lifecycle syncs"), tostring(outbox_status.blocked or 0) },
        { _("Lifecycle sync storage"), tostring(outbox_status.bytes or 0) .. " B" },
    } })
    table.insert(sections, { title = _("Highlights"), rows = {
        { _("Open highlights"), BookOrbitHighlightDiagnostics.openHighlightsText{
            annotation_sync = self.settings.annotation_sync,
            has_open_book = has_open_book,
            matched = self.isOpenBookMatched and self:isOpenBookMatched(digest) or false,
            scheduler_status = scheduler,
            last_highlight_sync = self.settings.last_highlight_sync,
        } },
        { _("Highlight apply retry"), BookOrbitHighlightDiagnostics.retryText(self.open_highlight_retry_status) },
        { _("Last highlight sync"), highlightRecordText(self.settings.last_highlight_sync) },
        { _("Last bookmark sync"), BookOrbitHighlightDiagnostics.lastBookmarkSyncText(self.settings.last_highlight_sync, formatShortTime) },
    } })
    if has_open_book then
        if self.settings.annotation_sync then
            table.insert(actions, { kind = "retry-highlights", label = _("Retry highlight sync"), icon = "highlighter" })
        end
        table.insert(actions, { kind = "retry-match", label = _("Retry open-book match"), icon = "book-open" })
    end
    table.insert(actions, { kind = "recheck", label = _("Recheck all book matches"), icon = "refresh-cw" })
    table.insert(actions, { kind = "test", label = _("Test connection"), icon = "wifi" })
    table.insert(actions, { kind = "check-update", label = _("Check for update"), icon = "download" })
    return { sections = sections, actions = actions }
end

-- The same as one flat list: rows, separators between sections and the
-- actions as rows that run them.
function MainMenu:diagnosticsRows()
    local d = self:diagnosticsSections()
    local rows = {}
    for index, section in ipairs(d.sections) do
        if index > 1 then table.insert(rows, "----------------------------") end
        for _i, row in ipairs(section.rows) do table.insert(rows, row) end
    end
    if #d.actions > 0 then table.insert(rows, "----------------------------") end
    local run = {
        test = function() self:testConnection() end,
        ["check-update"] = function() self:checkForUpdate() end,
        recheck = function() self:startMatchRecheck() end,
        ["retry-highlights"] = function() self:retryOpenHighlightSync() end,
        ["retry-match"] = function() self:retryOpenBookMatch() end,
    }
    for _i, a in ipairs(d.actions) do
        table.insert(rows, { a.label, _("Run"), callback = run[a.kind] })
    end
    return rows
end

function MainMenu:showDiagnostics()
    return require("bookorbit_diagnostics_page").open(self)
end

-- on_done(ok, reason): a page that shows the result itself; without it the
-- result is a message.
function MainMenu:testConnection(on_done)
    if not self.settings.server_url then
        require("bookorbit_toast").error(_("Set the BookOrbit server address first."))
        if on_done then on_done(false, _("No server address")) end
        return
    end
    if not self:isLoggedIn() then
        if on_done then on_done(false, _("Not signed in")) end
        self:promptLogin()
        return
    end

    NetworkMgr:runWhenConnected(function()
        local checking
        if not on_done then
            checking = require("bookorbit_toast").loading(_("Testing the connection…"), { dismissable = false })
        end
        local body, err = self:newClient():auth()
        if checking then checking:close() end
        if body then
            self:recordSyncSuccess("connection_test", _("Connection test succeeded"))
        else
            self:recordSyncError("connection_test", err)
        end
        if on_done then
            on_done(body ~= nil, not body and self:errorLabel(err) or nil)
        elseif body then
            require("bookorbit_toast").show(_("Connection works"))
        else
            require("bookorbit_toast").error(T(_("Connection failed: %1"), self:errorLabel(err)))
        end
    end)
end

-- A connection test that reports to the page that started it, on page.test:
-- testing, then ok or the reason it failed. The page repaints "Testing"
-- before the request, which blocks until the server answers.
function MainMenu:startPageTest(page, refresh)
    page.test = { running = true }
    refresh()
    UIManager:tickAfterNext(function()
        self:testConnection(function(ok, reason)
            if page.closed then return end
            page.test = ok and { ok = true } or { err = reason or _("Not reachable") }
            refresh(true)
        end)
    end)
end

-- ----------------------------------------------------------- menu bar icon
function MainMenu:menuBarIconEnabled()
    return self.settings.menu_bar_icon ~= false
end

function MainMenu:menuBarIconPath()
    if not self.path then return nil end
    local path = self.path .. "/assets/bookorbit.tab.svg"
    if path:sub(1, 1) ~= "/" then
        local cwd = require("libs/libkoreader-lfs").currentdir()
        if cwd then path = cwd .. "/" .. path end
    end
    return path
end

-- KOReader's tab bar looks icons up by name under its icon folders. Enough
-- ".." segments climb from any of them to the root, so the shipped SVG is
-- found by its absolute path without copying it anywhere.
function MainMenu:menuBarIconName()
    local path = self:menuBarIconPath()
    if not path then return "appbar.menu" end
    return string.rep("../", 32) .. path:gsub("^/+", ""):gsub("%.svg$", "")
end

function MainMenu:setMenuBarIconEnabled(enabled)
    self.settings.menu_bar_icon = enabled == true
    G_reader_settings:flush()
    require("bookorbit_menu_pin").refresh(enabled == true)
    -- The menu rebuilds from the rewritten order the next time it opens.
    if self.ui and self.ui.menu then self.ui.menu.tab_item_table = nil end
end

local function closeKOReaderMenu(ui)
    local menu = ui and ui.menu
    if not menu then return end
    if menu.onCloseFileManagerMenu then
        menu:onCloseFileManagerMenu()
    elseif menu.onCloseReaderMenu then
        menu:onCloseReaderMenu()
    end
end

-- The menu bar icon: BookOrbit in the file browser, This book in a book, and
-- sign-in for either when signed out. Opened after the menu's own close has
-- been painted, so a sheet's backdrop is the page, not the menu.
function MainMenu:onMenuBarIcon()
    closeKOReaderMenu(self.ui)
    UIManager:tickAfterNext(function()
        if not self:isLoggedIn() then
            self:openSignIn(function() self:onMenuBarIconAfterSignIn() end)
        elseif self.ui and self.ui.document then
            self:openBookSheet()
        else
            self:browseCatalog(false)
        end
    end)
end

function MainMenu:onMenuBarIconAfterSignIn()
    if self.ui and self.ui.document then
        self:openBookSheet()
    else
        self:browseCatalog(false)
    end
end

function MainMenu:addToMainMenu(menu_items)
    local items = {
        {
            -- The id predates the rename; scripts and patches look it up.
            id = "open_dashboard",
            text = _("Open BookOrbit"),
            callback = function()
                UIManager:tickAfterNext(function() self:openBookOrbit() end)
            end,
        },
    }
    if self.ui and self.ui.document then
        table.insert(items, {
            id = "this_book",
            text = _("This book"),
            callback = function()
                UIManager:tickAfterNext(function()
                    if self:isLoggedIn() then self:openBookSheet() else self:openSignIn() end
                end)
            end,
        })
    end
    table.insert(items, {
        id = "settings",
        text = _("Settings"),
        callback = function()
            UIManager:tickAfterNext(function() self:openSettings(self.catalog_browser) end)
        end,
    })
    menu_items.bookorbit = {
        text = _("BookOrbit"),
        -- Fallback placement only: BookOrbitMenuPin normally pins this entry
        -- right below calibre on the first page of the Tools menu.
        sorting_hint = "tools",
        sub_item_table = items,
    }
    if self:menuBarIconEnabled() then
        -- A tab that acts as a button, like the reader's file browser tab.
        -- BookOrbitMenuPin lists it in KOReader's menu bar order.
        menu_items.bookorbit_tab = {
            icon = self:menuBarIconName(),
            remember = false,
            callback = function() self:onMenuBarIcon() end,
        }
    end
end

-- ----------------------------------------------------------------- openers
function MainMenu:openBookOrbit()
    if not self:isLoggedIn() then
        self:openSignIn(function() self:browseCatalog(false) end)
        return
    end
    self:browseCatalog(false)
end

function MainMenu:openSignIn(on_signed_in)
    return require("bookorbit_signin_page").open(self, on_signed_in)
end

function MainMenu:openMenuSheet(catalog)
    return require("bookorbit_menu_sheet").open(self, catalog, function(page, action)
        return self:onMenuSheetAction(page, catalog, action)
    end)
end

function MainMenu:openSettings(catalog, view)
    return require("bookorbit_settings_page").open(self, catalog, view)
end

function MainMenu:openSyncStatus()
    return require("bookorbit_status_page").open(self)
end

function MainMenu:openBookSheet()
    if not (self.ui and self.ui.document) then return end
    return require("bookorbit_book_sheet").open(self)
end

-- The open book's title, for the sheet's Back to book tile.
function MainMenu:openBookTitle()
    local ui = self.ui
    if not (ui and ui.document) then return nil end
    local props = ui.doc_props or {}
    local title = props.display_title or props.title
    if title and title ~= "" then return title end
    local file = ui.document.file or ""
    return (file:gsub(".*/", ""):gsub("%.[^%.]+$", ""))
end

function MainMenu:openBookDetails(book_id)
    if not book_id then return end
    self:browseCatalog(false)
    local catalog = self.catalog_browser
    if catalog and catalog.loadBookDetail then
        UIManager:nextTick(function() catalog:loadBookDetail(book_id) end)
    end
end

-- What the sheet does with a tap it does not handle itself.
function MainMenu:onMenuSheetAction(page, catalog, action)
    local kind = action.kind
    local after = function(fn)
        page:close()
        UIManager:nextTick(fn)
    end
    if kind == "sync" or kind == "connect" then
        -- The sheet stays open and its Sync tile follows the run.
        local start = function()
            self:startSheetSync(page, catalog)
        end
        if kind == "connect" then NetworkMgr:runWhenConnected(start) else start() end
    elseif kind == "sync-stop" then
        self:confirmStopSync()
    elseif kind == "customize" then
        page:close()
        self:customizeHome(catalog)
    elseif kind == "home" then
        after(function() if catalog and catalog.goDashboard then catalog:goDashboard() end end)
    elseif kind == "exit" then
        after(function() if catalog then catalog:onCloseAllMenus() end end)
    elseif kind == "search" then
        after(function() if catalog then catalog:onSearchButtonTap() end end)
    elseif kind == "link" then
        after(function() if catalog and catalog.boardOpenLink then catalog:boardOpenLink(action.link) end end)
    elseif kind == "list-options" then
        after(function()
            if not catalog then return end
            if catalog.listMode and catalog:listMode() then return catalog:listOpenSheet("sort") end
            catalog:showBookActions()
        end)
    elseif kind == "settings" then
        after(function() self:openSettings(catalog) end)
    elseif kind == "status" then
        after(function() self:openSyncStatus() end)
    elseif kind == "about" then
        after(function() self:openSettings(catalog, "about") end)
    elseif kind == "update" then
        after(function() self:applyUpdate(self.settings.update_latest_version) end)
    end
    return true
end

-- ------------------------------------------------------------- page syncs
-- Short words for how a sync started from a page ended.
function MainMenu:syncErrorLabel(err)
    if err == "cancelled" then return _("Stopped") end
    if err == "not_started" then return _("Another sync is running") end
    if err == "unmatched" then return _("Not in your BookOrbit library") end
    if err == "capture" or err == "changed" then return _("Could not read this book") end
    return self:errorLabel(err)
end

function MainMenu:confirmStopSync()
    require("bookorbit_dialog_ui").confirm{
        title = _("Stop syncing?"),
        text = _("What has synced so far is kept. The rest syncs next time."),
        ok_label = _("Stop"),
        on_ok = function() BookOrbitSweep.cancel("user") end,
    }
end

-- A library sync that reports to the page that started it: progress on
-- page.sync while it runs, then the outcome. A page closed in the meantime
-- hands the outcome to a notification instead.
-- opts.full_recheck runs Recheck all books instead.
function MainMenu:startPageSync(page, refresh, opts)
    if not self:isLoggedIn() then
        self:promptLogin()
        return
    end
    local recheck = opts and opts.full_recheck
    page.sync = { running = true, text = recheck and _("Rechecking") or _("Starting"), recheck = recheck }
    refresh()
    local start = recheck and self.startMatchRecheck or self.startSweep
    start(self, {
        quiet = true,
        on_progress = function(text)
            if page.closed then return end
            page.sync = { running = true, text = text, recheck = recheck }
            refresh()
        end,
        on_done = function(err)
            local outcome = err and { err = self:syncErrorLabel(err), recheck = recheck } or { done = true, recheck = recheck }
            if page.closed then
                local Toast = require("bookorbit_toast")
                if err then
                    Toast.error(T(_("Sync stopped: %1"), outcome.err))
                else
                    Toast.show(recheck and _("Books rechecked") or _("Library synced"))
                end
                return
            end
            page.sync = outcome
            refresh(true)
        end,
    })
end

function MainMenu:startSheetSync(page, catalog)
    local MenuSheet = require("bookorbit_menu_sheet")
    self:startPageSync(page, function(reload)
        if reload then page.sheet_data = MenuSheet.data(self, catalog) end
        page.sheet_data.sync = page.sync
        page:refresh()
    end)
end

-- ------------------------------------------------------------------ Home
function MainMenu:customizeHome(catalog)
    if not catalog then
        self:openCatalogBrowser(false)
        catalog = self.catalog_browser
    end
    if not catalog then return end
    UIManager:nextTick(function()
        if catalog.goDashboard and not catalog:dashboardMode() then catalog:goDashboard() end
        if catalog.boardEnterEdit then catalog:boardEnterEdit() end
    end)
end

-- Writes a board setting through the open catalog, so the board redraws, or
-- straight to the settings when it is closed.
function MainMenu:applyBoardSetting(catalog, change)
    local state = change(self.settings)
    if catalog and catalog.persistSetting then
        catalog:persistSetting(BoardStore.SETTING_KEY, state)
        catalog.board_edit = nil
        if catalog:dashboardMode() then
            catalog.current_context.board_page = 1
            catalog:boardRefreshIfMissing()
        end
    else
        self.settings[BoardStore.SETTING_KEY] = state
        G_reader_settings:flush()
    end
end

function MainMenu:applyBoardTiles(catalog, tiles)
    if catalog and catalog.boardSetTiles then
        catalog:boardSetTiles(tiles)
    else
        self.settings[BoardStore.SETTING_KEY] = BoardStore.withTiles(self.settings, tiles)
        G_reader_settings:flush()
    end
end

function MainMenu:chooseDownloadFolder(catalog, on_done)
    if catalog and catalog.chooseDownloadDir then
        catalog:chooseDownloadDir(on_done)
        return
    end
    require("ui/downloadmgr"):new{
        onConfirm = function(path)
            G_reader_settings:saveSetting("download_dir", path)
            G_reader_settings:flush()
            if on_done then UIManager:nextTick(on_done) end
        end,
    }:chooseDir(require("bookorbit_download_root").get())
end

-- ---------------------------------------------------------------- shortcut
function MainMenu:gesturesData()
    local gestures = self.ui and self.ui.gestures
    return gestures and gestures.data or nil
end

function MainMenu:applyShortcut(id)
    local ok = require("bookorbit_shortcut").apply(self.ui and self.ui.gestures, id)
    if not ok then
        require("bookorbit_toast").error(_("Turn on KOReader's Gestures plugin first: Settings, Taps and gestures."))
    end
    return ok
end

function MainMenu:refreshActiveCatalogApi(refresh)
    local api = self:apiOpts(true)
    if not self.catalog_browser then return end
    self.catalog_browser:setApi(api)
    if refresh then self.catalog_browser:refreshCurrent() end
end

function MainMenu:applyServerAddress(server_url)
    if self.settings.server_url ~= server_url then
        self:clearAccountCaches()
    end
    self.settings.server_url = server_url
    self:refreshActiveCatalogApi(false)
end

-- The server address in the BookOrbit text panel; a value that is not a web
-- address keeps the panel open with the reason under the field.
function MainMenu:setServerAddress(on_done)
    local DialogUI = require("bookorbit_dialog_ui")
    local INK = require("bookorbit_board_metrics").INK
    local current = self.settings.server_url
    require("bookorbit_text_entry").open{
        title = _("Server address"),
        value = current and (current:gsub("/api/v1/?$", "")) or "https://",
        hint = "https://books.example.com",
        icon = "globe",
        validate = function(value)
            if not BookOrbitApi.normalizeServerUrl(value) then return _("Enter a valid http:// or https:// server address.") end
        end,
        below = function(_page, w)
            return {
                DialogUI.note(w, "info", _("The address you open BookOrbit at in a browser."), { col = INK.g3 }),
                DialogUI.pillRow(w, {
                    { label = _("Cancel"), kind = "outline", action = { kind = "close" } },
                    { label = _("Save"), icon = "check", action = { kind = "submit" } },
                }),
            }
        end,
        on_submit = function(value)
            local normalized = BookOrbitApi.normalizeServerUrl(value)
            self:applyServerAddress(normalized)
            require("bookorbit_toast").show(T(_("Server set to %1"), require("bookorbit_menu_ui").serverHost(normalized) or normalized))
            if on_done then on_done() end
        end,
    }
end

function MainMenu:doLogin(username, password, menu)
    Device:setIgnoreInput(true)
    local userkey = md5(password)
    local opts = self:apiOpts()
    opts.username = username
    opts.userkey = userkey
    local client = BookOrbitApi.new(opts)
    local body, err = client:auth()
    Device:setIgnoreInput(false)

    if body then
        if self.settings.username ~= username then self:clearAccountCaches() end
        self.settings.username = username
        self.settings.userkey = userkey
        self:refreshActiveCatalogApi(true)
        if menu then menu:updateItems() end
        UIManager:show(InfoMessage:new{ text = _("Logged in to BookOrbit.") })
        UIManager:scheduleIn(1, function()
            if self.requestUpdateCheck then
                self:requestUpdateCheck(false, "login")
            else
                self:maybeCheckForUpdate(false)
            end
        end)
    elseif err == 401 or err == 403 then
        UIManager:show(InfoMessage:new{
            text = _("Login failed. Create or check your KOReader credentials in BookOrbit web settings."),
        })
    else
        UIManager:show(InfoMessage:new{ text = T(_("Could not reach the BookOrbit server: %1"), tostring(err)) })
    end
end

function MainMenu:clearAccountCaches()
    self.settings.catalog_dashboard_cache = nil
    self.settings.catalog_detail_cache = nil
end

function MainMenu:logout(menu)
    self:clearAccountCaches()
    self.settings.userkey = nil
    self:refreshActiveCatalogApi(false)
    if menu then menu:updateItems() end
end


-- Stores credentials the sign-in page verified.
function MainMenu:completeSignIn(server_url, username, userkey)
    if self.settings.server_url ~= server_url or self.settings.username ~= username then
        self:clearAccountCaches()
    end
    self.settings.server_url = server_url
    self.settings.username = username
    self.settings.userkey = userkey
    G_reader_settings:flush()
    self:refreshActiveCatalogApi(true)
    require("bookorbit_toast").show(_("Signed in to BookOrbit"))
    UIManager:scheduleIn(1, function()
        if self.requestUpdateCheck then
            self:requestUpdateCheck(false, "login")
        end
    end)
end

function MainMenu:signOut(catalog)
    self:logout()
    G_reader_settings:flush()
    if catalog then catalog:onCloseAllMenus() end
end

function MainMenu.install(BookOrbit)
    for name, fn in pairs(MainMenu) do
        if name ~= "install" then
            BookOrbit[name] = fn
        end
    end
end

return MainMenu
