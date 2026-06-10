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
local UIManager = require("ui/uimanager")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local logger = require("logger")
local md5 = require("ffi/sha2").md5
local time = require("ui/time")
local util = require("util")
local T = require("ffi/util").template
local _ = require("gettext")

local BookOrbitApi = require("bookorbit_api")
local BookOrbitBookSync = require("bookorbit_book_sync")
local BookOrbitMenuPin = require("bookorbit_menu_pin")
local BookOrbitSweep = require("bookorbit_sweep")

local PLUGIN_VERSION = "0.2.0"

local SYNC_STRATEGY = {
    PROMPT = 1,
    SILENT = 2,
    DISABLE = 3,
}

local API_CALL_DEBOUNCE_DELAY = time.s(25)

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
    server_url = nil,
    username = nil,
    userkey = nil,
    auto_sync = false,
    pages_before_update = 10,
    sync_forward = SYNC_STRATEGY.PROMPT,
    sync_backward = SYNC_STRATEGY.DISABLE,
}

function BookOrbit:init()
    self.push_timestamp = 0
    self.pull_timestamp = 0
    self.last_page = -1
    self.last_page_turn_timestamp = 0
    self.page_update_counter = 0
    self.periodic_push_scheduled = false
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

    -- v1 settings cleanup: full sweeps are manual-only since 0.2.0.
    self.settings.sweep_on_close = nil
    self.settings.sweep_on_suspend = nil
    if self.settings.pages_before_update == nil then
        self.settings.pages_before_update = 10
    end

    if self.settings.auto_sync and Device:hasSeamlessWifiToggle() and G_reader_settings:readSetting("wifi_enable_action") ~= "turn_on" then
        self.settings.auto_sync = false
        logger.warn("BookOrbit: auto sync disabled because wifi_enable_action is not turn_on")
    end

    pcall(BookOrbitMenuPin.ensure)
    self:onDispatcherRegisterActions()
    self.ui.menu:registerToMainMenu(self)
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
        { category = "none", event = "BookOrbitPullProgress", title = _("BookOrbit: pull progress"), reader = true, separator = true })
end

function BookOrbit:onReaderReady()
    if self.settings.auto_sync then
        UIManager:nextTick(function()
            self:getProgress(true, false)
        end)
    end
    self:registerEvents()

    self.last_page = self.ui:getCurrentPage()
end

-- Menu

local function getNameStrategy(strategy)
    if strategy == SYNC_STRATEGY.PROMPT then
        return _("Prompt")
    elseif strategy == SYNC_STRATEGY.SILENT then
        return _("Auto")
    else
        return _("Disable")
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

function BookOrbit:addToMainMenu(menu_items)
    menu_items.bookorbit_sync = {
        text = _("BookOrbit sync"),
        -- Fallback placement only: BookOrbitMenuPin normally pins this entry
        -- right below calibre on the first page of the Tools menu.
        sorting_hint = "tools",
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
                separator = true,
            },
            {
                text = _("Sync behavior"),
                sub_item_table = {
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
            },
            {
                text_func = function()
                    local last = BookOrbitSweep.lastSweepAt()
                    if last == 0 then
                        return _("Last full sync: never")
                    end
                    return T(_("Last full sync: %1"), os.date("%Y-%m-%d %H:%M", last))
                end,
                enabled = false,
            },
        },
    }
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
        else
            showSyncError()
        end
    elseif not body then
        logger.dbg("BookOrbit: push failed:", err)
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

    local api_opts = self:apiOpts()
    if NetworkMgr:willRerunWhenOnline(function() BookOrbitSweep.run{ api = api_opts, interactive = true } end) then
        return
    end
    BookOrbitSweep.run{ api = api_opts, interactive = true }
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
        BookOrbitBookSync.run{ api = api_opts, snap = snap, reason = "manual", interactive = true, plugin = self }
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
        BookOrbitBookSync.run{ api = api_opts, snap = snap, reason = "close", interactive = false }
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

function BookOrbit:onBookOrbitToggleAutoSync(toggle, from_menu)
    if toggle == self.settings.auto_sync then
        return true
    end
    if not self.settings.auto_sync
            and Device:hasSeamlessWifiToggle()
            and G_reader_settings:readSetting("wifi_enable_action") ~= "turn_on" then
        UIManager:show(InfoMessage:new{
            text = _("You will have to switch the 'Action when Wi-Fi is off' Network setting to 'turn on' to be able to enable this feature!"),
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

return BookOrbit
