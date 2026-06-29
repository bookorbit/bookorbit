--[[--
BookOrbit Sync plugin.

Live progress sync mirrors the stock kosync plugin (pull on open with
conflict strategies, periodic push every N page turns, push on close and
suspend, 25 second debounce) against BookOrbit's kosync-compatible endpoints.
Closing or suspending additionally snapshots the open book from live memory
(progress, highlights, status/rating, page stats) and uploads it per book.
The full-library sweep is manual-only.
]]

local ConfirmBox = require("ui/widget/confirmbox")
local Device = require("device")
local Dispatcher = require("dispatcher")
local Event = require("ui/event")
local InfoMessage = require("ui/widget/infomessage")
local InputDialog = require("ui/widget/inputdialog")
local Math = require("optmath")
local MultiInputDialog = require("ui/widget/multiinputdialog")
local NetworkMgr = require("ui/network/manager")
local Notification = require("ui/widget/notification")
local PluginShare = require("pluginshare")
local UIManager = require("ui/uimanager")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local logger = require("logger")
local md5 = require("ffi/sha2").md5
local time = require("ui/time")
local util = require("util")
local T = require("ffi/util").template
local _ = require("gettext")

local BookOrbitAnnotations = require("bookorbit_annotations")
local BookOrbitApi = require("bookorbit_api")
local BookOrbitBookSync = require("bookorbit_book_sync")
local BookOrbitCatalog = require("bookorbit_catalog")
local BookOrbitState = require("bookorbit_state")
local BookOrbitMenuPin = require("bookorbit_menu_pin")
local BookOrbitSweep = require("bookorbit_sweep")
local BookOrbitUpdater = require("bookorbit_updater")

local PLUGIN_VERSION = "1.0.1"

local SYNC_STRATEGY = {
    PROMPT = 1,
    SILENT = 2,
    DISABLE = 3,
}

local API_CALL_DEBOUNCE_DELAY = time.s(25)
local UPDATE_CHECK_INTERVAL = 24 * 60 * 60

local BookOrbit = WidgetContainer:extend{
    name = "bookorbit",
    title = _("Login to BookOrbit"),

    push_timestamp = nil,
    pull_timestamp = nil,
    last_page = nil,
    last_page_turn_timestamp = nil,

    settings = nil,
}

BookOrbit.default_settings = {
    settings_version = 1,
    server_url = nil,
    username = nil,
    userkey = nil,
    auto_sync = false,
    annotation_sync = true,
    pages_before_update = 10,
    sync_forward = SYNC_STRATEGY.PROMPT,
    sync_backward = SYNC_STRATEGY.DISABLE,
    catalog_view_mode = "mosaic",
    catalog_sort = "recently_added",
    catalog_grid_cols = 3,
    catalog_grid_rows = 3,
    catalog_recent_searches = {},
    catalog_auto_open = "off",
    catalog_dashboard_cache = nil,
    update_check_last_at = 0,
}

function BookOrbit:init()
    self.push_timestamp = 0
    self.pull_timestamp = 0
    self.last_page = -1
    self.last_page_turn_timestamp = 0
    self.page_update_counter = 0
    self.periodic_push_scheduled = false
    self.provision_applied = false
    self.periodic_push_task = function()
        self.periodic_push_scheduled = false
        self.page_update_counter = 0
        -- Push only, no pull, no network nagging: relies on the connection
        -- being already up, like the stock kosync periodic push.
        if self.settings.auto_sync and (self.settings.pages_before_update or 0) > 0 then
            self:updateProgress(false, false)
        end
    end

    self.settings = G_reader_settings:readSetting("bookorbit", self.default_settings)
    self.device_id = G_reader_settings:readSetting("device_id")

    -- Detect settings from the old bookorbit-koplugin, which used the same
    -- "bookorbit" key but a different structure. Reset behavior keys to
    -- defaults while preserving any existing credentials so users aren't
    -- logged out.
    if not self.settings.settings_version then
        local server_url = self.settings.server_url
        local username = self.settings.username
        local userkey = self.settings.userkey
        local provision_fingerprint = self.settings.provision_fingerprint
        self.settings = {}
        for k, v in pairs(self.default_settings) do
            self.settings[k] = type(v) == "table" and {} or v
        end
        self.settings.server_url = server_url
        self.settings.username = username
        self.settings.userkey = userkey
        self.settings.provision_fingerprint = provision_fingerprint
        G_reader_settings:saveSetting("bookorbit", self.settings)
        G_reader_settings:flush()
        logger.info("BookOrbit: migrated settings from previous schema")
    end

    -- v1 settings cleanup: full sweeps are manual-only since 0.2.0.
    self.settings.sweep_on_close = nil
    self.settings.sweep_on_suspend = nil
    if self.settings.pages_before_update == nil then
        self.settings.pages_before_update = 10
    end
    if self.settings.annotation_sync == nil then
        self.settings.annotation_sync = true
    end
    if self.settings.update_check_last_at == nil then
        self.settings.update_check_last_at = 0
    end
    if self.settings.catalog_auto_open == nil then
        self.settings.catalog_auto_open = "off"
    end

    self:applyProvision()

    if self.settings.auto_sync and Device:hasSeamlessWifiToggle() and G_reader_settings:readSetting("wifi_enable_action") ~= "turn_on" then
        self.settings.auto_sync = false
        logger.warn("BookOrbit: auto sync disabled because wifi_enable_action is not turn_on")
    end

    pcall(BookOrbitMenuPin.ensure)
    self:onDispatcherRegisterActions()
    self.ui.menu:registerToMainMenu(self)
    self:onStart()
    UIManager:scheduleIn(5, function()
        self:maybeCheckForUpdate(false)
    end)
end

local PROVISION_FILE = "bookorbit_provision.lua"

-- Applies the connection settings bundled by "Download preconfigured plugin"
-- in BookOrbit web settings. The fingerprint ties one download to one apply:
-- a freshly generated zip always (re)configures, while reinstalling an old
-- one never overrides a logout.
function BookOrbit:applyProvision()
    if not self.path then return end
    local provision_path = self.path .. "/" .. PROVISION_FILE
    local chunk = loadfile(provision_path)
    if not chunk then return end

    setfenv(chunk, {})
    local ok, provision = pcall(chunk)
    if not ok or type(provision) ~= "table" then
        logger.warn("BookOrbit: ignoring unreadable provision file", provision_path)
        return
    end

    local server_url = BookOrbitApi.normalizeServerUrl(provision.server_url)
    if not server_url or type(provision.username) ~= "string" or type(provision.userkey) ~= "string" then
        logger.warn("BookOrbit: ignoring incomplete provision file", provision_path)
        return
    end

    local fingerprint = md5(table.concat({
        server_url, provision.username, provision.userkey, tostring(provision.generated_at),
    }, "\0"))
    if self.settings.provision_fingerprint ~= fingerprint then
        self.settings.server_url = server_url
        self.settings.username = provision.username
        self.settings.userkey = provision.userkey
        self.settings.provision_fingerprint = fingerprint
        self.provision_applied = true
        G_reader_settings:flush()
        logger.info("BookOrbit: applied provision file for", provision.username)
        UIManager:nextTick(function()
            UIManager:show(InfoMessage:new{
                text = T(_("BookOrbit sync is set up for %1 as %2."), provision.server_url, provision.username),
                timeout = 5,
            })
        end)
    end
    os.remove(provision_path)
end

function BookOrbit:apiOpts()
    return {
        server_url = self.settings.server_url,
        username = self.settings.username,
        userkey = self.settings.userkey,
        device_id = self.device_id,
        device_model = Device.model,
        plugin_version = PLUGIN_VERSION,
    }
end

function BookOrbit:newClient()
    return BookOrbitApi.new(self:apiOpts())
end

function BookOrbit:isLoggedIn()
    return self.settings.server_url ~= nil and self.settings.username ~= nil and self.settings.userkey ~= nil
end

function BookOrbit:onStart()
    if PluginShare.bookorbit_auto_open_done then return end
    PluginShare.bookorbit_auto_open_done = true

    local mode = self.settings.catalog_auto_open or "off"
    if mode == "off" then return end
    UIManager:scheduleIn(1.2, function()
        self:maybeAutoOpenCatalog(mode)
    end)
end

function BookOrbit:maybeAutoOpenCatalog(mode)
    if mode ~= "filemanager" and mode ~= "always" then return end
    if self.provision_applied then return end
    if not self:isLoggedIn() then return end
    if self.catalog_browser ~= nil then return end
    if mode == "filemanager" and not (self.ui and self.ui.file_chooser ~= nil) then
        return
    end
    self:browseCatalog(true)
end

local function showSyncError()
    UIManager:show(InfoMessage:new{
        text = _("Something went wrong when syncing to BookOrbit, please check your network connection and try again later."),
        timeout = 3,
    })
end

local function promptLogin()
    UIManager:show(InfoMessage:new{
        text = _("Please configure the BookOrbit server and login first."),
        timeout = 3,
    })
end

function BookOrbit:onDispatcherRegisterActions()
    Dispatcher:registerAction("bookorbit_sync_now",
        { category = "none", event = "BookOrbitSyncNow", title = _("BookOrbit: sync all books"), general = true })
    Dispatcher:registerAction("bookorbit_sync_book",
        { category = "none", event = "BookOrbitSyncBook", title = _("BookOrbit: sync this book"), reader = true })
    Dispatcher:registerAction("bookorbit_push_progress",
        { category = "none", event = "BookOrbitPushProgress", title = _("BookOrbit: push progress"), reader = true })
    Dispatcher:registerAction("bookorbit_pull_progress",
        { category = "none", event = "BookOrbitPullProgress", title = _("BookOrbit: pull progress"), reader = true })
    Dispatcher:registerAction("bookorbit_open_dashboard",
        { category = "none", event = "BookOrbitOpenDashboard", title = _("BookOrbit: open dashboard"), general = true, separator = true })
end

function BookOrbit:onReaderReady()
    if self.settings.auto_sync then
        UIManager:nextTick(function()
            self:getProgress(true, false)
        end)
        if self.settings.annotation_sync then
            UIManager:scheduleIn(2, function()
                self:exchangeAnnotationsForOpenBook()
            end)
        end
    end
    self:registerEvents()

    self.last_page = self.ui:getCurrentPage()
end

-- Two-way annotation pull/push for the open book. Runs once per book open;
-- safe to call again manually, guarded against concurrent syncs.
function BookOrbit:exchangeAnnotationsForOpenBook()
    if self.annotation_exchange_running then return end
    if not self:isLoggedIn() or not self.ui or not self.ui.document then return end
    if BookOrbitBookSync.isRunning() or BookOrbitSweep.isRunning() then return end

    local digest = self:getDocumentDigest()
    if not digest then return end
    local state = BookOrbitState.open()
    if not state:getBook(digest) then
        -- Unknown or unmatched book: the close-path snapshot sync matches it.
        return
    end

    self.annotation_exchange_running = true
    local ok, result, err = pcall(BookOrbitAnnotations.exchangeOpenBook, {
        client = self:newClient(),
        state = state,
        digest = digest,
        ui = self.ui,
    })
    state:flush()
    self.annotation_exchange_running = false

    if not ok then
        logger.err("BookOrbit: annotation exchange error:", result)
    elseif result then
        local touched = (result.applied or 0) + (result.deleted or 0)
        if touched > 0 then
            Notification:notify(T(_("BookOrbit: %1 highlight(s) updated"), touched))
        end
    elseif err and err ~= "unmatched" and err ~= "unsupported_server" and err ~= "network" then
        logger.dbg("BookOrbit: annotation exchange skipped:", err)
    end
end

-- Menu

local function getNameStrategy(strategy)
    if strategy == SYNC_STRATEGY.PROMPT then
        return _("Prompt")
    elseif strategy == SYNC_STRATEGY.SILENT then
        return _("Silently")
    else
        return _("Never")
    end
end

function BookOrbit:strategyMenu(getter, setter)
    local function item(text, value)
        return {
            text = text,
            checked_func = function() return getter() == value end,
            callback = function() setter(value) end,
        }
    end
    return {
        item(_("Silently"), SYNC_STRATEGY.SILENT),
        item(_("Prompt"), SYNC_STRATEGY.PROMPT),
        item(_("Never"), SYNC_STRATEGY.DISABLE),
    }
end

function BookOrbit:hasKnownUpdate()
    return BookOrbitUpdater.isNewer(self.settings.update_latest_version, PLUGIN_VERSION) == true
end

function BookOrbit:updateCheckMenuText()
    if self:hasKnownUpdate() then
        return T(_("Plugin update available: v%1 -> v%2"), PLUGIN_VERSION, self.settings.update_latest_version)
    end
    if self:isLoggedIn() then
        return T(_("Installed plugin: v%1 (Check for update)"), PLUGIN_VERSION)
    end
    return T(_("Installed plugin: v%1 (Login required)"), PLUGIN_VERSION)
end

function BookOrbit:catalogAutoOpenLabel()
    local mode = self.settings.catalog_auto_open or "off"
    if mode == "filemanager" then
        return _("File manager only")
    elseif mode == "always" then
        return _("Every startup")
    end
    return _("Off")
end

function BookOrbit:catalogAutoOpenMenu()
    local function item(text, value)
        return {
            text = text,
            checked_func = function() return (self.settings.catalog_auto_open or "off") == value end,
            callback = function()
                self.settings.catalog_auto_open = value
                G_reader_settings:flush()
            end,
        }
    end
    return {
        item(_("Off"), "off"),
        item(_("File manager only"), "filemanager"),
        item(_("Every startup"), "always"),
    }
end

function BookOrbit:addToMainMenu(menu_items)
    menu_items.bookorbit = {
        text = _("BookOrbit"),
        -- Fallback placement only: BookOrbitMenuPin normally pins this entry
        -- right below calibre on the first page of the Tools menu.
        sorting_hint = "tools",
        sub_item_table = {
            {
                text = _("Open dashboard"),
                enabled_func = function()
                    return self:isLoggedIn()
                end,
                callback = function()
                    self:browseCatalog()
                end,
            },
            {
                text_func = function()
                    return self:updateCheckMenuText()
                end,
                enabled_func = function()
                    return self:isLoggedIn()
                        and not BookOrbitSweep.isRunning()
                        and not BookOrbitBookSync.isRunning()
                end,
                keep_menu_open = true,
                callback = function()
                    self:checkForUpdate()
                end,
            },
            {
                text_func = function()
                    local status = BookOrbitSweep.syncStatus()
                    local when = (status.lastSweepAt == 0) and _("never")
                        or os.date("%Y-%m-%d %H:%M", status.lastSweepAt)
                    if status.unmatched > 0 then
                        return T(_("Last sync: %1 (%2 linked, %3 unmatched)"), when, status.matched, status.unmatched)
                    elseif status.matched > 0 then
                        return T(_("Last sync: %1 (%2 linked)"), when, status.matched)
                    end
                    return T(_("Last sync: %1"), when)
                end,
                enabled = false,
                separator = true,
            },
            {
                text = _("Sync this book now"),
                enabled_func = function()
                    return self:isLoggedIn() and self.ui.document ~= nil
                        and not BookOrbitSweep.isRunning() and not BookOrbitBookSync.isRunning()
                end,
                callback = function()
                    self:onBookOrbitSyncBook()
                end,
            },
            {
                text = _("Sync all books now"),
                enabled_func = function()
                    return self:isLoggedIn() and not BookOrbitSweep.isRunning() and not BookOrbitBookSync.isRunning()
                end,
                callback = function()
                    self:startSweep()
                end,
                separator = true,
            },
            {
                text = _("Auto sync this book"),
                checked_func = function() return self.settings.auto_sync end,
                help_text = _([[Pulls progress when a book is opened; pushes progress, highlights, status, rating and reading time when it is closed and on suspend.]]),
                callback = function()
                    self:onBookOrbitToggleAutoSync(nil, true)
                end,
            },
            {
                text = _("Two-way highlight sync"),
                checked_func = function() return self.settings.annotation_sync end,
                help_text = _([[Also applies highlights, notes and deletions made in BookOrbit to this device: on book open, after the manual book sync, and during the full sweep for closed books. Turning this off keeps uploads only.]]),
                callback = function()
                    self.settings.annotation_sync = not self.settings.annotation_sync
                end,
                separator = true,
            },
            {
                text = _("Sync settings"),
                sub_item_table = {
                    {
                        text_func = function()
                            return T(_("Open dashboard on startup (%1)"), self:catalogAutoOpenLabel())
                        end,
                        sub_item_table = self:catalogAutoOpenMenu(),
                    },
                    {
                        text_func = function()
                            return T(_("Periodically sync every # pages (%1)"), self:getSyncPeriod())
                        end,
                        enabled_func = function() return self.settings.auto_sync end,
                        keep_menu_open = true,
                        callback = function(touchmenu_instance)
                            local SpinWidget = require("ui/widget/spinwidget")
                            local items = SpinWidget:new{
                                text = _([[This value determines how many page turns it takes to push book progress.
If set to 0, updating progress based on page turns will be disabled.]]),
                                value = self.settings.pages_before_update or 0,
                                value_min = 0,
                                value_max = 999,
                                value_step = 1,
                                value_hold_step = 10,
                                ok_text = _("Set"),
                                title_text = _("Number of pages before update"),
                                default_value = 10,
                                callback = function(spin)
                                    self:setPagesBeforeUpdate(spin.value)
                                    if touchmenu_instance then touchmenu_instance:updateItems() end
                                end,
                            }
                            UIManager:show(items)
                        end,
                    },
                    {
                        text_func = function()
                            return T(_("Sync to a newer state (%1)"), getNameStrategy(self.settings.sync_forward))
                        end,
                        sub_item_table = self:strategyMenu(
                            function() return self.settings.sync_forward end,
                            function(value) self.settings.sync_forward = value end
                        ),
                    },
                    {
                        text_func = function()
                            return T(_("Sync to an older state (%1)"), getNameStrategy(self.settings.sync_backward))
                        end,
                        sub_item_table = self:strategyMenu(
                            function() return self.settings.sync_backward end,
                            function(value) self.settings.sync_backward = value end
                        ),
                    },
                },
            },
            {
                text = _("Account & setup"),
                sub_item_table = {
                    {
                        text = _("BookOrbit server address"),
                        keep_menu_open = true,
                        callback = function()
                            self:setServerAddress()
                        end,
                    },
                    {
                        text_func = function()
                            return self.settings.userkey and _("Logout") or _("Login")
                        end,
                        enabled_func = function()
                            return self.settings.server_url ~= nil
                        end,
                        keep_menu_open = true,
                        callback_func = function()
                            if self.settings.userkey then
                                return function(menu)
                                    self:logout(menu)
                                end
                            else
                                return function(menu)
                                    self:login(menu)
                                end
                            end
                        end,
                    },
                },
            },
        },
    }
end

function BookOrbit:dashboardMenuItems(catalog)
    local menu_items = {}
    self:addToMainMenu(menu_items)
    local bookorbit_items = menu_items.bookorbit.sub_item_table or {}
    local items = {
        icon = "appbar.menu",
    }
    for index, item in ipairs(bookorbit_items) do
        if index ~= 1 then
            table.insert(items, item)
        end
    end
    return items
end

function BookOrbit:showDashboardMenu(catalog)
    local CenterContainer = require("ui/widget/container/centercontainer")
    local TouchMenu = require("ui/widget/touchmenu")
    if self.dashboard_menu_container then
        local old_container = self.dashboard_menu_container
        self.dashboard_menu_container = nil
        UIManager:close(old_container)
    end
    local menu_container = CenterContainer:new{
        covers_header = true,
        ignore = "height",
        dimen = Device.screen:getSize(),
    }
    local dashboard_menu = TouchMenu:new{
        width = Device.screen:getWidth(),
        last_index = 1,
        tab_item_table = { self:dashboardMenuItems(catalog) },
        show_parent = menu_container,
    }
    local closing = false
    dashboard_menu.close_callback = function()
        if closing then return true end
        closing = true
        if self.dashboard_menu_container == menu_container then
            self.dashboard_menu_container = nil
        end
        UIManager:close(menu_container)
        return true
    end
    menu_container[1] = dashboard_menu
    self.dashboard_menu_container = menu_container
    UIManager:show(menu_container)
end

function BookOrbit:openCatalogBrowser(prefer_cached_dashboard)
    if self.catalog_browser ~= nil then return end
    self.catalog_browser = BookOrbitCatalog:new{
        title = _("BookOrbit"),
        api = self:apiOpts(),
        settings = self.settings,
        prefer_cached_dashboard = prefer_cached_dashboard,
        save_settings = function()
            G_reader_settings:flush()
        end,
        show_dashboard_menu = function(catalog)
            self:showDashboardMenu(catalog)
        end,
        _manager = self,
        close_callback = function()
            UIManager:close(self.catalog_browser)
            self.catalog_browser = nil
        end,
    }
    UIManager:show(self.catalog_browser)
end

function BookOrbit:browseCatalog(allow_offline)
    if not self:isLoggedIn() then
        promptLogin()
        return
    end

    if allow_offline then
        self:openCatalogBrowser(true)
    else
        NetworkMgr:runWhenConnected(function()
            self:openCatalogBrowser(false)
        end)
    end
end

function BookOrbit:setServerAddress()
    local dialog
    dialog = InputDialog:new{
        title = _("BookOrbit server address"),
        input = self.settings.server_url or "https://",
        input_hint = "https://bookorbit.example.com",
        buttons = {
            {
                {
                    text = _("Cancel"),
                    id = "close",
                    callback = function()
                        UIManager:close(dialog)
                    end,
                },
                {
                    text = _("OK"),
                    is_enter_default = true,
                    callback = function()
                        local normalized = BookOrbitApi.normalizeServerUrl(dialog:getInputText())
                        self.settings.server_url = normalized
                        UIManager:close(dialog)
                        if normalized then
                            Notification:notify(T(_("BookOrbit server set to %1"), normalized))
                        end
                    end,
                },
            },
        },
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

function BookOrbit:login(menu)
    if NetworkMgr:willRerunWhenOnline(function() self:login(menu) end) then
        return
    end

    local dialog
    dialog = MultiInputDialog:new{
        title = self.title,
        fields = {
            {
                text = self.settings.username,
                hint = "username",
            },
            {
                hint = "password",
                text_type = "password",
            },
        },
        description = _("Credentials are created in BookOrbit web settings under Settings, KOReader."),
        buttons = {
            {
                {
                    text = _("Cancel"),
                    id = "close",
                    callback = function()
                        UIManager:close(dialog)
                    end,
                },
                {
                    text = _("Login"),
                    is_enter_default = true,
                    callback = function()
                        local username, password = unpack(dialog:getFields())
                        username = util.trim(username or "")
                        if username == "" or not password or password == "" then
                            UIManager:show(InfoMessage:new{ text = _("Please enter a username and password."), timeout = 2 })
                            return
                        end
                        UIManager:close(dialog)
                        UIManager:scheduleIn(0.5, function()
                            self:doLogin(username, password, menu)
                        end)
                        UIManager:show(InfoMessage:new{ text = _("Logging in. Please wait."), timeout = 1 })
                    end,
                },
            },
        },
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

function BookOrbit:doLogin(username, password, menu)
    Device:setIgnoreInput(true)
    local userkey = md5(password)
    local client = BookOrbitApi.new{
        server_url = self.settings.server_url,
        username = username,
        userkey = userkey,
        device_id = self.device_id,
        device_model = Device.model,
        plugin_version = PLUGIN_VERSION,
    }
    local body, err = client:auth()
    Device:setIgnoreInput(false)

    if body then
        self.settings.username = username
        self.settings.userkey = userkey
        if menu then menu:updateItems() end
        UIManager:show(InfoMessage:new{ text = _("Logged in to BookOrbit.") })
        UIManager:scheduleIn(1, function()
            self:maybeCheckForUpdate(false)
        end)
    elseif err == 401 or err == 403 then
        UIManager:show(InfoMessage:new{
            text = _("Login failed. Create or check your KOReader credentials in BookOrbit web settings."),
        })
    else
        UIManager:show(InfoMessage:new{ text = T(_("Could not reach the BookOrbit server: %1"), tostring(err)) })
    end
end

function BookOrbit:logout(menu)
    self.settings.userkey = nil
    if menu then menu:updateItems() end
end

function BookOrbit:getSyncPeriod()
    if not self.settings.auto_sync then
        return _("Not available")
    end
    local period = self.settings.pages_before_update
    if period and period > 0 then
        return period
    end
    return _("Never")
end

function BookOrbit:setPagesBeforeUpdate(value)
    self.settings.pages_before_update = value
end

function BookOrbit:schedulePeriodicPush()
    UIManager:unschedule(self.periodic_push_task)
    -- A sizable delay debounces nicely while skimming.
    UIManager:scheduleIn(10, self.periodic_push_task)
    self.periodic_push_scheduled = true
end

-- Live progress sync (kosync mirror)

function BookOrbit:getLastPercent()
    if self.ui.document.info.has_pages then
        return Math.roundPercent(self.ui.paging:getLastPercent())
    else
        return Math.roundPercent(self.ui.rolling:getLastPercent())
    end
end

function BookOrbit:getLastProgress()
    if self.ui.document.info.has_pages then
        return self.ui.paging:getLastProgress()
    else
        return self.ui.rolling:getLastProgress()
    end
end

-- Always the binary partial MD5: BookOrbit matches on the scanner-computed
-- partial MD5 of the file, so the filename checksum method does not exist here.
function BookOrbit:getDocumentDigest()
    local digest = self.ui.doc_settings:readSetting("partial_md5_checksum")
    if digest then return digest end

    local file = self.ui.document.file
    if not file then return nil end
    local ok, computed = pcall(util.partialMD5, file)
    if not ok or not computed then return nil end
    self.ui.doc_settings:saveSetting("partial_md5_checksum", computed)
    return computed
end

function BookOrbit:syncToProgress(progress)
    logger.dbg("BookOrbit: syncing to progress", progress)
    if self.ui.document.info.has_pages then
        self.ui:handleEvent(Event:new("GotoPage", tonumber(progress)))
    else
        self.ui:handleEvent(Event:new("GotoXPointer", progress))
    end
end

function BookOrbit:updateProgress(ensure_networking, interactive, on_suspend)
    if not self:isLoggedIn() then
        if interactive then promptLogin() end
        return
    end
    if not self.ui or not self.ui.document then return end

    local now = UIManager:getElapsedTimeSinceBoot()
    if not interactive and now - self.push_timestamp <= API_CALL_DEBOUNCE_DELAY then
        logger.dbg("BookOrbit: push debounced")
        return
    end

    if ensure_networking and NetworkMgr:willRerunWhenOnline(function() self:updateProgress(ensure_networking, interactive, on_suspend) end) then
        return
    end

    local digest = self:getDocumentDigest()
    if not digest then return end

    local client = self:newClient()
    local body, err = client:updateProgress(digest, self:getLastPercent(), self:getLastProgress(), os.time())
    if interactive then
        if body then
            UIManager:show(InfoMessage:new{ text = _("Progress has been pushed to BookOrbit."), timeout = 3 })
            if not on_suspend then self:maybeCheckForUpdate(false) end
        else
            showSyncError()
        end
    elseif not body then
        logger.dbg("BookOrbit: push failed:", err)
    elseif not on_suspend then
        self:maybeCheckForUpdate(false)
    end

    if on_suspend and Device:hasWifiManager() then
        NetworkMgr:disableWifi()
    end

    self.push_timestamp = now
end

function BookOrbit:getProgress(ensure_networking, interactive)
    if not self:isLoggedIn() then
        if interactive then promptLogin() end
        return
    end
    if not self.ui or not self.ui.document then return end

    local now = UIManager:getElapsedTimeSinceBoot()
    if not interactive and now - self.pull_timestamp <= API_CALL_DEBOUNCE_DELAY then
        logger.dbg("BookOrbit: pull debounced")
        return
    end

    if ensure_networking and NetworkMgr:willRerunWhenOnline(function() self:getProgress(ensure_networking, interactive) end) then
        return
    end

    local digest = self:getDocumentDigest()
    if not digest then return end

    local client = self:newClient()
    local body, err = client:getProgress(digest)
    self.pull_timestamp = now

    if not body then
        if interactive then showSyncError() end
        logger.dbg("BookOrbit: pull failed:", err)
        return
    end
    self:maybeCheckForUpdate(false)

    if not body.percentage then
        if interactive then
            UIManager:show(InfoMessage:new{ text = _("No progress found for this document."), timeout = 3 })
        end
        return
    end

    if body.device == Device.model and body.device_id == self.device_id then
        if interactive then
            UIManager:show(InfoMessage:new{ text = _("Latest progress is coming from this device."), timeout = 3 })
        end
        return
    end

    body.percentage = Math.roundPercent(body.percentage)
    local progress = self:getLastProgress()
    local percentage = self:getLastPercent()

    if percentage == body.percentage or body.progress == progress then
        if interactive then
            UIManager:show(InfoMessage:new{ text = _("The progress has already been synchronized."), timeout = 3 })
        end
        return
    end

    if interactive then
        self:syncToProgress(body.progress)
        UIManager:show(InfoMessage:new{ text = _("Progress has been synchronized."), timeout = 3 })
        return
    end

    local self_older
    if body.timestamp ~= nil then
        self_older = (body.timestamp > self.last_page_turn_timestamp)
    else
        self_older = (body.percentage > percentage)
    end

    local strategy = self_older and self.settings.sync_forward or self.settings.sync_backward
    if strategy == SYNC_STRATEGY.SILENT then
        self:syncToProgress(body.progress)
        UIManager:show(InfoMessage:new{ text = _("Progress has been synchronized."), timeout = 3 })
    elseif strategy == SYNC_STRATEGY.PROMPT then
        local template = self_older and _("Sync to latest location %1% from device '%2'?")
            or _("Sync to previous location %1% from device '%2'?")
        UIManager:show(ConfirmBox:new{
            text = T(template, Math.round(body.percentage * 100), body.device),
            ok_callback = function()
                self:syncToProgress(body.progress)
            end,
        })
    end
end

-- Manual sync triggers

function BookOrbit:startSweep()
    if not self:isLoggedIn() then
        promptLogin()
        return
    end
    if BookOrbitBookSync.isRunning() then
        UIManager:show(InfoMessage:new{ text = _("BookOrbit is syncing the current book, try again shortly."), timeout = 2 })
        return
    end

    local sweep_opts = {
        api = self:apiOpts(),
        interactive = true,
        annotation_sync = self.settings.annotation_sync,
        on_finish = function(err)
            if not err then self:maybeCheckForUpdate(false) end
        end,
    }
    if NetworkMgr:willRerunWhenOnline(function() BookOrbitSweep.run(sweep_opts) end) then
        return
    end
    BookOrbitSweep.run(sweep_opts)
end

function BookOrbit:onBookOrbitSyncBook()
    if not self:isLoggedIn() then
        promptLogin()
        return
    end
    if not self.ui or not self.ui.document then
        UIManager:show(InfoMessage:new{ text = _("Open a book to sync it."), timeout = 2 })
        return
    end
    if BookOrbitSweep.isRunning() or BookOrbitBookSync.isRunning() then
        UIManager:show(InfoMessage:new{ text = _("BookOrbit sync is already running."), timeout = 2 })
        return
    end

    local snap = BookOrbitBookSync.capture(self)
    if not snap then
        UIManager:show(InfoMessage:new{ text = _("Could not read this book's data."), timeout = 2 })
        return
    end

    local api_opts = self:apiOpts()
    local run = function()
        BookOrbitBookSync.run{ api = api_opts, snap = snap, reason = "manual", interactive = true, plugin = self,
            annotation_sync = self.settings.annotation_sync }
    end
    if NetworkMgr:willRerunWhenOnline(run) then
        return
    end
    run()
end

-- Events

function BookOrbit:_onCloseDocument()
    logger.dbg("BookOrbit: onCloseDocument")
    self.onResume = nil
    self.onSuspend = nil
    UIManager:unschedule(self.periodic_push_task)
    self.periodic_push_scheduled = false

    if BookOrbitSweep.isRunning() or BookOrbitBookSync.isRunning() then
        logger.dbg("BookOrbit: close sync skipped, another sync is running")
        return
    end

    -- Snapshot now: reader objects die after this handler returns. ReaderUI
    -- already flushed the sidecar and statistics before broadcasting
    -- CloseDocument, so memory, sidecar and stats DB agree at this point.
    local snap = BookOrbitBookSync.capture(self)
    if not snap then return end

    local api_opts = self:apiOpts()
    NetworkMgr:goOnlineToRun(function()
        BookOrbitBookSync.run{ api = api_opts, snap = snap, reason = "close", interactive = false,
            annotation_sync = self.settings.annotation_sync }
    end)
end

function BookOrbit:_onPageUpdate(page)
    if page == nil then return end
    if self.last_page ~= page then
        self.last_page = page
        self.last_page_turn_timestamp = os.time()
        self.page_update_counter = self.page_update_counter + 1
        -- A pending periodic push is re-delayed on every page turn so it
        -- only fires once the reader is actually idle.
        if self.periodic_push_scheduled
                or (self.settings.pages_before_update or 0) > 0 and self.page_update_counter >= self.settings.pages_before_update then
            self:schedulePeriodicPush()
        end
    end
end

function BookOrbit:_onResume()
    logger.dbg("BookOrbit: onResume")
    if Device:hasWifiRestore() and NetworkMgr.wifi_was_on and G_reader_settings:isTrue("auto_restore_wifi") then
        return
    end
    UIManager:scheduleIn(1, function()
        self:getProgress(true, false)
    end)
end

function BookOrbit:_onSuspend()
    logger.dbg("BookOrbit: onSuspend")
    UIManager:unschedule(self.periodic_push_task)
    self.periodic_push_scheduled = false

    if not self:isLoggedIn() then return end
    if BookOrbitSweep.isRunning() or BookOrbitBookSync.isRunning() then return end

    local snap = BookOrbitBookSync.capture(self)
    if not snap then return end

    local on_finish
    if Device:hasWifiManager() then
        on_finish = function() NetworkMgr:disableWifi() end
    end
    local api_opts = self:apiOpts()
    -- Synchronous: the device is about to sleep, so the uploads must not be
    -- parked on the scheduler (they would run after resume and then kill
    -- wifi mid-read via on_finish).
    local run = function()
        BookOrbitBookSync.run{
            api = api_opts, snap = snap, reason = "suspend",
            interactive = false, synchronous = true, plugin = self, on_finish = on_finish,
            annotation_sync = self.settings.annotation_sync,
        }
    end
    if NetworkMgr:willRerunWhenOnline(run) then
        return
    end
    run()
end

function BookOrbit:_onNetworkConnected()
    logger.dbg("BookOrbit: onNetworkConnected")
    UIManager:scheduleIn(0.5, function()
        self:getProgress(false, false)
        self:maybeCheckForUpdate(false)
    end)
end

function BookOrbit:_onNetworkDisconnecting()
    logger.dbg("BookOrbit: onNetworkDisconnecting")
    self:updateProgress(false, false)
end

function BookOrbit:onBookOrbitPushProgress()
    self:updateProgress(true, true)
end

function BookOrbit:onBookOrbitPullProgress()
    self:getProgress(true, true)
end

function BookOrbit:onBookOrbitSyncNow()
    self:startSweep()
end

function BookOrbit:onBookOrbitOpenDashboard()
    self:browseCatalog(false)
end

function BookOrbit:onBookOrbitToggleAutoSync(toggle, from_menu)
    if toggle == self.settings.auto_sync then
        return true
    end
    if not self.settings.auto_sync
            and Device:hasSeamlessWifiToggle()
            and G_reader_settings:readSetting("wifi_enable_action") ~= "turn_on" then
        UIManager:show(InfoMessage:new{
            text = _("Auto sync needs KOReader to turn Wi-Fi on without asking. Open Network settings, set 'Action when Wi-Fi is off' to 'Turn on', then enable Auto sync again."),
        })
        return true
    end
    self.settings.auto_sync = not self.settings.auto_sync
    self:registerEvents()

    if self.settings.auto_sync then
        self:getProgress(true, true)
    else
        UIManager:unschedule(self.periodic_push_task)
        self.periodic_push_scheduled = false
        self.page_update_counter = 0
        if from_menu then
            self:updateProgress(true, true)
        end
    end

    if not from_menu then
        Notification:notify(self.settings.auto_sync and _("BookOrbit auto progress sync: on") or _("BookOrbit auto progress sync: off"))
    end
    return true
end

function BookOrbit:registerEvents()
    if self.settings.auto_sync then
        self.onCloseDocument = self._onCloseDocument
        self.onPageUpdate = self._onPageUpdate
        self.onResume = self._onResume
        self.onSuspend = self._onSuspend
        self.onNetworkConnected = self._onNetworkConnected
        self.onNetworkDisconnecting = self._onNetworkDisconnecting
    else
        self.onCloseDocument = nil
        self.onPageUpdate = nil
        self.onResume = nil
        self.onSuspend = nil
        self.onNetworkConnected = nil
        self.onNetworkDisconnecting = nil
    end
end

function BookOrbit:onCloseWidget()
    if self.periodic_push_task then
        UIManager:unschedule(self.periodic_push_task)
        self.periodic_push_task = nil
    end
end

function BookOrbit:checkForUpdate()
    if not self:isLoggedIn() then
        promptLogin()
        return
    end
    NetworkMgr:runWhenConnected(function()
        self:doCheckForUpdate()
    end)
end

function BookOrbit:maybeCheckForUpdate(interactive)
    if not self:isLoggedIn() or self._checking_update or self._updating then return end
    if BookOrbitSweep.isRunning() or BookOrbitBookSync.isRunning() then return end

    local now = os.time()
    if not interactive and now - (self.settings.update_check_last_at or 0) < UPDATE_CHECK_INTERVAL then
        return
    end

    self._checking_update = true
    local body, err = self:newClient():getPluginVersion()
    self._checking_update = false

    if not body then
        if interactive then
            UIManager:show(InfoMessage:new{
                text = T(_("Could not check for update: %1"), tostring(err or "network error")),
                timeout = 4,
            })
        else
            logger.dbg("BookOrbit: plugin update check failed:", err)
        end
        return
    end

    self:handleUpdateVersionResponse(body, interactive, interactive or self.catalog_browser == nil)
end

function BookOrbit:doCheckForUpdate()
    local checking = InfoMessage:new{ text = _("Checking for update...") }
    UIManager:show(checking)

    local body, err = self:newClient():getPluginVersion()
    UIManager:close(checking)

    if not body then
        UIManager:show(InfoMessage:new{
            text = T(_("Could not check for update: %1"), tostring(err or "network error")),
            timeout = 4,
        })
        return
    end

    self:handleUpdateVersionResponse(body, true, true)
end

function BookOrbit:handleUpdateVersionResponse(body, interactive, prompt_allowed)
    local server_ver = body.serverVersion or "unknown"
    local plugin_latest = body.pluginVersion
    self.settings.update_check_last_at = os.time()

    if type(plugin_latest) ~= "string" or plugin_latest == "unknown" then
        G_reader_settings:flush()
        if interactive then
            UIManager:show(InfoMessage:new{
                text = _("Could not determine the latest plugin version from the server."),
                timeout = 4,
            })
        end
        return
    end

    self.settings.update_latest_version = plugin_latest
    G_reader_settings:flush()

    if BookOrbitUpdater.isNewer(plugin_latest, PLUGIN_VERSION) ~= true then
        if interactive then
            UIManager:show(InfoMessage:new{
                text = T(_("Plugin is up to date (v%1).\nServer: v%2"), PLUGIN_VERSION, server_ver),
                timeout = 4,
            })
        end
        return
    end

    if not prompt_allowed then
        return
    end

    if not interactive and self.settings.update_dismissed_version == plugin_latest then
        return
    end
    if not interactive then
        self.settings.update_dismissed_version = plugin_latest
        G_reader_settings:flush()
    end

    UIManager:show(ConfirmBox:new{
        text = T(_("Update available: v%1 -> v%2\nServer: v%3\n\nDownload and apply the update now?"),
            PLUGIN_VERSION, plugin_latest, server_ver),
        ok_text = _("Update"),
        ok_callback = function()
            self:applyUpdate(plugin_latest)
        end,
    })
end

function BookOrbit:applyUpdate(new_version)
    if self._updating then
        UIManager:show(InfoMessage:new{ text = _("An update is already in progress."), timeout = 3 })
        return
    end
    self._updating = true
    self:_doApplyUpdate(new_version)
    self._updating = false
end

function BookOrbit:_doApplyUpdate(new_version)
    if not self.path then
        UIManager:show(InfoMessage:new{
            text = _("Cannot determine plugin path. Update aborted."),
            timeout = 3,
        })
        return
    end

    local progress = InfoMessage:new{ text = T(_("Downloading BookOrbit v%1..."), new_version) }
    UIManager:show(progress)
    UIManager:forceRePaint()

    local ok, err = BookOrbitUpdater.apply(self:newClient(), self.path)
    UIManager:close(progress)

    if not ok then
        local msg
        if type(err) == "number" and err == 503 then
            msg = _("Update failed: the server does not have the plugin package available.")
        else
            msg = T(_("Update failed: %1"), tostring(err or "unknown error"))
        end
        UIManager:show(InfoMessage:new{ text = msg, timeout = 6 })
        return
    end

    UIManager:show(ConfirmBox:new{
        text = T(_("BookOrbit v%1 installed. KOReader needs to restart to apply the update."), new_version),
        ok_text = _("Restart now"),
        ok_callback = function()
            -- Exit code 85 triggers an app restart on Kobo and most e-ink platforms.
            -- On other platforms KOReader exits cleanly; reopen it to apply the update.
            UIManager:quit(UIManager.RETURN_CODE_REBOOT or 85)
        end,
        cancel_text = _("Later"),
    })
end

return BookOrbit
