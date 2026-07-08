--[[--
Live progress sync mixin for the BookOrbit plugin (kosync mirror).

Push/pull of reading progress with conflict strategies and a 25 second
debounce, the periodic page-turn push, and the progress reconciliation that
runs before a manual book sync. Installed onto the plugin controller as
regular methods.
]]

local ConfirmBox = require("ui/widget/confirmbox")
local Device = require("device")
local Event = require("ui/event")
local InfoMessage = require("ui/widget/infomessage")
local Math = require("optmath")
local NetworkMgr = require("ui/network/manager")
local UIManager = require("ui/uimanager")
local logger = require("logger")
local time = require("ui/time")
local util = require("util")
local T = require("ffi/util").template
local _ = require("gettext")

local API_CALL_DEBOUNCE_DELAY = time.s(25)

-- Assigned from the plugin class on install; shared with the menu module.
local SYNC_STRATEGY

local ProgressSync = {}

local function showSyncError()
    UIManager:show(InfoMessage:new{
        text = _("Something went wrong when syncing to BookOrbit, please check your network connection and try again later."),
        timeout = 3,
    })
end

function ProgressSync:getLastPercent()
    if self.ui.document.info.has_pages then
        return Math.roundPercent(self.ui.paging:getLastPercent())
    else
        return Math.roundPercent(self.ui.rolling:getLastPercent())
    end
end

function ProgressSync:getLastProgress()
    if self.ui.document.info.has_pages then
        return self.ui.paging:getLastProgress()
    else
        return self.ui.rolling:getLastProgress()
    end
end

-- Always the binary partial MD5: BookOrbit matches on the scanner-computed
-- partial MD5 of the file, so the filename checksum method does not exist here.
function ProgressSync:getDocumentDigest()
    local digest = self.ui.doc_settings:readSetting("partial_md5_checksum")
    if digest then return digest end

    local file = self.ui.document.file
    if not file then return nil end
    local ok, computed = pcall(util.partialMD5, file)
    if not ok or not computed then return nil end
    self.ui.doc_settings:saveSetting("partial_md5_checksum", computed)
    return computed
end

function ProgressSync:syncToProgress(progress)
    logger.dbg("BookOrbit: syncing to progress", progress)
    if self.ui.document.info.has_pages then
        self.ui:handleEvent(Event:new("GotoPage", tonumber(progress)))
    else
        self.ui:handleEvent(Event:new("GotoXPointer", progress))
    end
end

local function hasUsableRemoteProgress(progress)
    return progress ~= nil and progress ~= ""
end

function ProgressSync:remoteProgressIsNewer(body, local_percentage)
    local local_timestamp = self.last_page_turn_timestamp or 0
    if body.timestamp ~= nil then
        if local_timestamp > 0 then
            return body.timestamp > local_timestamp
        end
        return body.percentage > local_percentage
    end
    return body.percentage > local_percentage
end

function ProgressSync:applyRemoteProgress(body, on_done)
    self:syncToProgress(body.progress)
    if on_done then
        UIManager:scheduleIn(0.1, function()
            on_done(false)
        end)
    end
end

function ProgressSync:reconcileProgressBeforeBookSync(digest, on_done)
    if not self.ui or not self.ui.document then
        UIManager:show(InfoMessage:new{ text = _("Open a book to sync it."), timeout = 2 })
        return
    end
    if self:getDocumentDigest() ~= digest then
        UIManager:show(InfoMessage:new{ text = _("The open book changed. Start the sync again."), timeout = 3 })
        return
    end

    local client = self:newClient()
    local body, err = client:getProgress(digest)
    self.pull_timestamp = UIManager:getElapsedTimeSinceBoot()

    if not body then
        logger.dbg("BookOrbit: progress check before book sync failed:", err)
        UIManager:show(InfoMessage:new{ text = _("Could not check latest progress. Syncing book data without changing progress."), timeout = 4 })
        on_done(true)
        return
    end

    if not body.percentage then
        on_done(false)
        return
    end

    if body.device == Device.model and body.device_id == self.device_id then
        on_done(false)
        return
    end

    body.percentage = Math.roundPercent(body.percentage)
    local local_progress = self:getLastProgress()
    local local_percentage = self:getLastPercent()

    if local_percentage == body.percentage or body.progress == local_progress then
        on_done(false)
        return
    end

    local remote_newer = self:remoteProgressIsNewer(body, local_percentage)
    if not hasUsableRemoteProgress(body.progress) then
        if remote_newer then
            UIManager:show(InfoMessage:new{
                text = _("BookOrbit has newer progress but no exact location. Syncing book data without changing progress."),
                timeout = 4,
            })
            on_done(true)
        else
            on_done(false)
        end
        return
    end

    local strategy = remote_newer and self.settings.sync_forward or self.settings.sync_backward
    if strategy == SYNC_STRATEGY.SILENT then
        self:applyRemoteProgress(body, on_done)
    elseif strategy == SYNC_STRATEGY.PROMPT then
        local template = remote_newer and _("Sync to latest location %1% from device '%2' before uploading this book?")
            or _("Sync to previous location %1% from device '%2' before uploading this book?")
        UIManager:show(ConfirmBox:new{
            text = T(template, Math.round(body.percentage * 100), body.device),
            ok_callback = function()
                self:applyRemoteProgress(body, on_done)
            end,
            cancel_callback = function()
                on_done(remote_newer)
            end,
        })
    elseif remote_newer then
        UIManager:show(InfoMessage:new{
            text = _("BookOrbit has newer progress. Syncing book data without changing progress."),
            timeout = 4,
        })
        on_done(true)
    else
        on_done(false)
    end
end

function ProgressSync:updateProgress(ensure_networking, interactive, on_suspend)
    if not self:isLoggedIn() then
        if interactive then self:promptLogin() end
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

function ProgressSync:getProgress(ensure_networking, interactive)
    if not self:isLoggedIn() then
        if interactive then self:promptLogin() end
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

function ProgressSync:schedulePeriodicPush()
    UIManager:unschedule(self.periodic_push_task)
    -- A sizable delay debounces nicely while skimming.
    UIManager:scheduleIn(10, self.periodic_push_task)
    self.periodic_push_scheduled = true
end

function ProgressSync:getSyncPeriod()
    if not self.settings.auto_sync then
        return _("Not available")
    end
    local period = self.settings.pages_before_update
    if period and period > 0 then
        return period
    end
    return _("Never")
end

function ProgressSync:setPagesBeforeUpdate(value)
    self.settings.pages_before_update = value
end

function ProgressSync.install(BookOrbit)
    SYNC_STRATEGY = BookOrbit.SYNC_STRATEGY
    for name, fn in pairs(ProgressSync) do
        if name ~= "install" then
            BookOrbit[name] = fn
        end
    end
end

return ProgressSync
