--[[--
Main menu mixin for the BookOrbit plugin.

Builds the BookOrbit entry in KOReader's Tools menu and the dashboard menu that
mirrors it, plus the account dialogs: server address, login/logout. Installed
onto the plugin controller as regular methods.
]]

local Device = require("device")
local InfoMessage = require("ui/widget/infomessage")
local InputDialog = require("ui/widget/inputdialog")
local MultiInputDialog = require("ui/widget/multiinputdialog")
local NetworkMgr = require("ui/network/manager")
local Notification = require("ui/widget/notification")
local UIManager = require("ui/uimanager")
local md5 = require("ffi/sha2").md5
local util = require("util")
local T = require("ffi/util").template
local _ = require("gettext")

local BookOrbitApi = require("bookorbit_api")
local BookOrbitHighlightDiagnostics = require("bookorbit_highlight_diagnostics")
local BookOrbitSweep = require("bookorbit_sweep")

-- Assigned from the plugin class on install so menu labels can name the
-- shared sync strategies.
local SYNC_STRATEGY

local MainMenu = {}

local function getNameStrategy(strategy)
    if strategy == SYNC_STRATEGY.PROMPT then
        return _("Prompt")
    elseif strategy == SYNC_STRATEGY.SILENT then
        return _("Silently")
    else
        return _("Never")
    end
end

function MainMenu:strategyMenu(getter, setter)
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

function MainMenu:catalogAutoOpenLabel()
    local mode = self.settings.catalog_auto_open or "off"
    if mode == "filemanager" then
        return _("File manager only")
    elseif mode == "always" then
        return _("Every startup")
    end
    return _("Off")
end

function MainMenu:catalogAutoOpenMenu()
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

function MainMenu:diagnosticsRows()
    local status = BookOrbitSweep.syncStatus()
    local sync_status = self.getSyncCoordinatorStatus and self:getSyncCoordinatorStatus() or { pending_count = 0 }
    local has_open_book = hasReaderBook(self)
    local digest = safeDocumentDigest(self, has_open_book)
    local scheduler = self.open_annotation_scheduler and self.open_annotation_scheduler:status() or nil
    local logged_in = self:isLoggedIn()
    local open_highlight_text = BookOrbitHighlightDiagnostics.openHighlightsText{
        annotation_sync = self.settings.annotation_sync,
        has_open_book = has_open_book,
        matched = self.isOpenBookMatched and self:isOpenBookMatched(digest) or false,
        scheduler_status = scheduler,
        last_highlight_sync = self.settings.last_highlight_sync,
    }
    local rows = {
        { _("Server"), self.settings.server_url or _("not set") },
        { _("Username"), self.settings.username or _("not set") },
        { _("Login"), self:isLoggedIn() and _("configured") or _("not configured") },
        { _("Device"), Device.model or _("unknown") },
        { _("Device ID"), deviceIdPrefix(self.device_id) },
        { _("Plugin"), versionText(self.PLUGIN_VERSION) },
        { _("Latest plugin"), versionText(self.settings.update_latest_version) },
    }

    if not logged_in then
        if self.settings.last_error then
            table.insert(rows, "----------------------------")
            table.insert(rows, { _("Last error"), recordText(self.settings.last_error) })
        end
        table.insert(rows, "----------------------------")
        if hasCredentials(self.settings) then
            table.insert(rows, {
                _("Test connection"),
                _("Run"),
                callback = function()
                    self:testConnection()
                end,
            })
        end
        return rows
    end

    table.insert(rows, "----------------------------")
    table.insert(rows, { _("Auto sync"), formatBool(self.settings.auto_sync) })
    table.insert(rows, { _("Two-way highlights"), formatBool(self.settings.annotation_sync) })
    table.insert(rows, { _("Open highlights"), open_highlight_text })
    table.insert(rows, { _("Highlight apply retry"), BookOrbitHighlightDiagnostics.retryText(self.open_highlight_retry_status) })
    table.insert(rows, { _("Skip offline auto-sync"), formatBool(self.settings.skip_sync_when_offline) })
    table.insert(rows, { _("Current sync"), jobText(sync_status.current) })
    table.insert(rows, { _("Current sync started"), jobStartedText(sync_status.current) })
    table.insert(rows, { _("Pending syncs"), tostring(sync_status.pending_count or 0) })
    table.insert(rows, { _("Next sync"), jobText(sync_status.next) })
    table.insert(rows, { _("Last sweep"), formatTime(status.lastSweepAt) })
    table.insert(rows, { _("Matched local books"), tostring(status.matched or 0) })
    table.insert(rows, { _("Unmatched local books"), tostring(status.unmatched or 0) })
    table.insert(rows, "----------------------------")
    table.insert(rows, { _("Last sync"), recordText(self.settings.last_sync) })
    table.insert(rows, { _("Last highlight sync"), highlightRecordText(self.settings.last_highlight_sync) })
    table.insert(rows, { _("Last error"), recordText(self.settings.last_error) })
    table.insert(rows, "----------------------------")
    if has_open_book then
        if self.settings.annotation_sync then
            table.insert(rows, {
                _("Retry highlight sync"),
                _("Run"),
                callback = function()
                    self:retryOpenHighlightSync()
                end,
            })
        end
        table.insert(rows, {
            _("Retry open-book match"),
            _("Run"),
            callback = function()
                self:retryOpenBookMatch()
            end,
        })
    end
    table.insert(rows, {
        _("Test connection"),
        _("Run"),
        callback = function()
            self:testConnection()
        end,
    })
    table.insert(rows, {
        _("Check for update"),
        _("Run"),
        callback = function()
            self:checkForUpdate()
        end,
    })
    return rows
end

function MainMenu:showDiagnostics()
    local KeyValuePage = require("ui/widget/keyvaluepage")
    UIManager:show(KeyValuePage:new{
        title = _("BookOrbit diagnostics"),
        kv_pairs = self:diagnosticsRows(),
        value_overflow_align = "right",
    })
end

function MainMenu:testConnection()
    if not self.settings.server_url then
        UIManager:show(InfoMessage:new{ text = _("Set the BookOrbit server address first."), timeout = 3 })
        return
    end
    if not self:isLoggedIn() then
        self:promptLogin()
        return
    end

    NetworkMgr:runWhenConnected(function()
        local checking = InfoMessage:new{ text = _("Testing BookOrbit connection...") }
        UIManager:show(checking)
        local body, err = self:newClient():auth()
        UIManager:close(checking)
        if body then
            self:recordSyncSuccess("connection_test", _("Connection test succeeded"))
            UIManager:show(InfoMessage:new{ text = _("BookOrbit connection works."), timeout = 3 })
        else
            self:recordSyncError("connection_test", err)
            UIManager:show(InfoMessage:new{
                text = T(_("BookOrbit connection failed: %1"), self:errorLabel(err)),
                timeout = 4,
            })
        end
    end)
end

function MainMenu:dashboardSettingsMenu()
    return {
        {
            text_func = function()
                return T(_("Open dashboard on startup (%1)"), self:catalogAutoOpenLabel())
            end,
            sub_item_table = self:catalogAutoOpenMenu(),
        },
    }
end

function MainMenu:syncSettingsMenu(has_open_book)
    local items = {}
    table.insert(items, {
        text = _("Skip auto-sync when offline"),
        checked_func = function() return self.settings.skip_sync_when_offline end,
        enabled_func = function() return self.settings.auto_sync end,
        help_text = _([[When enabled, automatic sync on book open is skipped if the device is not already online. Prevents the e-reader from stalling while trying to connect to Wi-Fi.]]),
        callback = function()
            self.settings.skip_sync_when_offline = not self.settings.skip_sync_when_offline
        end,
    })
    table.insert(items, {
        text_func = function()
            return T(_("Periodically sync every # pages (%1)"), self:getSyncPeriod())
        end,
        enabled_func = function() return self.settings.auto_sync end,
        keep_menu_open = true,
        separator = true,
        callback = function(touchmenu_instance)
            local SpinWidget = require("ui/widget/spinwidget")
            local spin = SpinWidget:new{
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
                callback = function(widget)
                    self:setPagesBeforeUpdate(widget.value)
                    if touchmenu_instance then touchmenu_instance:updateItems() end
                end,
            }
            UIManager:show(spin)
        end,
    })
    table.insert(items, {
        text = _("Two-way highlight sync"),
        checked_func = function() return self.settings.annotation_sync end,
        help_text = _([[Also applies highlights, notes and deletions made in BookOrbit to this device: on book open, after the manual book sync, and during the full sweep for closed books. Turning this off keeps uploads only.]]),
        callback = function()
            self.settings.annotation_sync = not self.settings.annotation_sync
        end,
    })
    table.insert(items, {
        text_func = function()
            return T(_("Sync to a newer state (%1)"), getNameStrategy(self.settings.sync_forward))
        end,
        sub_item_table = self:strategyMenu(
            function() return self.settings.sync_forward end,
            function(value) self.settings.sync_forward = value end
        ),
    })
    table.insert(items, {
        text_func = function()
            return T(_("Sync to an older state (%1)"), getNameStrategy(self.settings.sync_backward))
        end,
        sub_item_table = self:strategyMenu(
            function() return self.settings.sync_backward end,
            function(value) self.settings.sync_backward = value end
        ),
    })
    return items
end

function MainMenu:pluginSettingsMenu()
    return {
        {
            id = "plugin_update",
            text_func = function()
                return self:updateCheckMenuText()
            end,
            keep_menu_open = true,
            callback = function()
                self:checkForUpdate()
            end,
        },
    }
end

function MainMenu:settingsMenu(has_open_book, opts)
    opts = opts or {}
    local items = {
        {
            text = _("Dashboard"),
            sub_item_table = self:dashboardSettingsMenu(),
        },
        {
            text = _("Sync"),
            sub_item_table = self:syncSettingsMenu(has_open_book),
        },
    }
    if opts.include_plugin ~= false then
        table.insert(items, {
            text = _("Plugin"),
            sub_item_table = self:pluginSettingsMenu(),
        })
    end
    return items
end

function MainMenu:addToMainMenu(menu_items)
    local logged_in = self:isLoggedIn()
    local has_open_book = hasReaderBook(self)
    local items = {}

    if logged_in then
        table.insert(items, {
            id = "open_dashboard",
            text = _("Open dashboard"),
            callback = function()
                self:browseCatalog()
            end,
            separator = true,
        })
        if has_open_book then
            table.insert(items, {
                id = "sync_current_book",
                text = _("Sync current book now"),
                callback = function()
                    self:onBookOrbitSyncBook()
                end,
            })
            table.insert(items, {
                id = "auto_sync_current_book",
                text = _("Auto sync current book"),
                checked_func = function() return self.settings.auto_sync end,
                help_text = _([[Pulls progress when a book is opened; pushes progress, highlights, status, rating and reading time when it is closed and on suspend.]]),
                callback = function()
                    self:onBookOrbitToggleAutoSync(nil, true)
                end,
                separator = true,
            })
        end
        table.insert(items, {
            text = _("Sync all books now"),
            callback = function()
                self:startSweep()
            end,
            separator = true,
        })
        table.insert(items, {
            id = "settings",
            text = _("Settings"),
            separator = true,
            sub_item_table = self:settingsMenu(has_open_book),
        })
    end

    table.insert(items, {
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
            {
                text = _("Diagnostics"),
                callback = function()
                    self:showDiagnostics()
                end,
            },
        },
    })

    menu_items.bookorbit = {
        text = _("BookOrbit"),
        -- Fallback placement only: BookOrbitMenuPin normally pins this entry
        -- right below calibre on the first page of the Tools menu.
        sorting_hint = "tools",
        sub_item_table = items,
    }
end

function MainMenu:dashboardMenuItems(catalog)
    local menu_items = {}
    self:addToMainMenu(menu_items)
    local bookorbit_items = menu_items.bookorbit.sub_item_table or {}
    local items = {
        icon = "appbar.menu",
    }
    if self:isLoggedIn() then
        local plugin_update = self:pluginSettingsMenu()[1]
        plugin_update.separator = true
        table.insert(items, plugin_update)
    end
    for _index, item in ipairs(bookorbit_items) do
        if item.id ~= "open_dashboard" and item.id ~= "sync_current_book" and item.id ~= "auto_sync_current_book" then
            if item.id == "settings" then
                table.insert(items, {
                    id = "settings",
                    text = _("Settings"),
                    separator = item.separator,
                    sub_item_table = self:settingsMenu(false, { include_plugin = false }),
                })
            else
                table.insert(items, item)
            end
        end
    end
    if catalog then
        table.insert(items, {
            text = _("Close BookOrbit"),
            separator = true,
            callback = function()
                local menu_container = self.dashboard_menu_container
                self.dashboard_menu_container = nil
                if menu_container then UIManager:close(menu_container) end
                catalog:onCloseAllMenus()
            end,
        })
    end
    return items
end

function MainMenu:showDashboardMenu(catalog)
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

function MainMenu:setServerAddress()
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

function MainMenu:login(menu)
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
        self.settings.username = username
        self.settings.userkey = userkey
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

function MainMenu:logout(menu)
    self.settings.userkey = nil
    if menu then menu:updateItems() end
end

function MainMenu.install(BookOrbit)
    SYNC_STRATEGY = BookOrbit.SYNC_STRATEGY
    for name, fn in pairs(MainMenu) do
        if name ~= "install" then
            BookOrbit[name] = fn
        end
    end
end

return MainMenu
