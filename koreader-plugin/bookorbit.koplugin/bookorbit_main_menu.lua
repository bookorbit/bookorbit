--[[--
Main menu mixin for the BookOrbit plugin.

Builds the BookOrbit entry in KOReader's Tools menu (and the dashboard
hamburger menu that mirrors it), plus the account dialogs: server address,
login/logout. Installed onto the plugin controller as regular methods.
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
local BookOrbitBookSync = require("bookorbit_book_sync")
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

function MainMenu:addToMainMenu(menu_items)
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
            },
            {
                text = _("Skip auto-sync when offline"),
                checked_func = function() return self.settings.skip_sync_when_offline end,
                enabled_func = function() return self.settings.auto_sync end,
                help_text = _([[When enabled, automatic sync on book open is skipped if the device is not already online. Prevents the e-reader from stalling while trying to connect to Wi-Fi.]]),
                callback = function()
                    self.settings.skip_sync_when_offline = not self.settings.skip_sync_when_offline
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

function MainMenu:dashboardMenuItems(catalog)
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
