--[[--
BookOrbit Sync plugin.

Live progress sync mirrors the stock kosync plugin (pull on open with
conflict strategies, periodic push every N page turns, push on close and
suspend, 25 second debounce) against BookOrbit's kosync-compatible endpoints.
Closing or suspending additionally snapshots the open book from live memory
(progress, highlights, status/rating, page stats) and uploads it per book.
The full-library sweep is manual-only.

This file owns the plugin lifecycle and reader events. The rest of the
controller is split across mixins installed below: bookorbit_main_menu
(Tools/dashboard menu and account dialogs), bookorbit_progress_sync (the
kosync mirror) and bookorbit_updater (self-update checks and apply).
]]

local Device = require("device")
local Dispatcher = require("dispatcher")
local InfoMessage = require("ui/widget/infomessage")
local NetworkMgr = require("ui/network/manager")
local Notification = require("ui/widget/notification")
local PluginShare = require("pluginshare")
local Trapper = require("ui/trapper")
local UIManager = require("ui/uimanager")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local logger = require("logger")
local lfs = require("libs/libkoreader-lfs")
local md5 = require("ffi/sha2").md5
local T = require("ffi/util").template
local _ = require("gettext")

local BookOrbitAnnotations = require("bookorbit_annotations")
local BookOrbitBookmarks = require("bookorbit_bookmarks")
local BookOrbitApi = require("bookorbit_api")
local BookOrbitBookSync = require("bookorbit_book_sync")
local BookOrbitCatalog = require("bookorbit_catalog")
local BookOrbitHighlightSummary = require("bookorbit_highlight_summary")
local BookOrbitLifecycleOutbox = require("bookorbit_lifecycle_outbox")
local BookOrbitOpenAnnotationScheduler = require("bookorbit_open_annotation_scheduler")
local BookOrbitState = require("bookorbit_state")
local BookOrbitStateManager = require("bookorbit_state_manager")
local BookOrbitStatsReader = require("bookorbit_stats_reader")
local BookOrbitSyncCoordinator = require("bookorbit_sync_coordinator")
local BookOrbitSyncJobRunner = require("bookorbit_sync_job_runner")
local BookOrbitMainMenu = require("bookorbit_main_menu")
local BookOrbitMenuPin = require("bookorbit_menu_pin")
local BookOrbitProgressSync = require("bookorbit_progress_sync")
local BookOrbitSweep = require("bookorbit_sweep")
local BookOrbitUpdater = require("bookorbit_updater")

local PLUGIN_VERSION = "1.4.0"

local SYNC_STRATEGY = {
    PROMPT = 1,
    SILENT = 2,
    DISABLE = 3,
}

local LAST_ERROR_LABELS = {
    auth = _("login failed"),
    network = _("server not reachable"),
    invalid_json = _("invalid server response"),
    unsupported_server = _("server update required"),
    body_too_large = _("request too large"),
    background_request_interrupted = _("background request interrupted"),
    partial_failure = _("partial sync failure"),
    outbox_persistence = _("lifecycle sync could not be saved"),
}

local SYNC_JOB_PRIORITY = BookOrbitSyncCoordinator.PRIORITY
local OPEN_ANNOTATION_SYNC_DELAY = 2
local OPEN_HIGHLIGHT_RETRY_DELAY = 8
local OPEN_HIGHLIGHT_MAX_RETRIES = 2

local BookOrbit = WidgetContainer:extend{
    name = "bookorbit",
    title = _("Login to BookOrbit"),

    push_timestamp = nil,
    pull_timestamp = nil,
    last_page = nil,
    last_page_turn_timestamp = nil,

    settings = nil,
}

-- The version literal is parsed out of main.lua by the BookOrbit server's
-- plugin package endpoint; the mixin modules read it via the class field.
BookOrbit.PLUGIN_VERSION = PLUGIN_VERSION
BookOrbit.SYNC_STRATEGY = SYNC_STRATEGY

BookOrbitMainMenu.install(BookOrbit)
BookOrbitProgressSync.install(BookOrbit)
BookOrbitUpdater.install(BookOrbit)

BookOrbit.default_settings = {
    settings_version = 1,
    server_url = nil,
    username = nil,
    userkey = nil,
    auto_sync = false,
    skip_sync_when_offline = false,
    annotation_sync = true,
    pages_before_update = 10,
    sync_forward = SYNC_STRATEGY.PROMPT,
    sync_backward = SYNC_STRATEGY.DISABLE,
    catalog_view_mode = "mosaic",
    catalog_sort = "recently_added",
    catalog_grid_cols = 4,
    catalog_grid_rows = 3,
    catalog_mosaic_show_titles = false,
    catalog_recent_searches = {},
    catalog_auto_open = "off",
    catalog_dashboard_cache = nil,
    catalog_detail_cache = nil,
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
            self:requestProgressPush(false, false, "periodic")
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
        self:requestLifecycleOutboxDrain("startup")
        self:requestUpdateCheck(false, "startup")
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

function BookOrbit:apiOpts(background_requests)
    return {
        server_url = self.settings.server_url,
        username = self.settings.username,
        userkey = self.settings.userkey,
        device_id = self.device_id,
        device_model = Device.model,
        plugin_version = PLUGIN_VERSION,
        background_requests = background_requests == true,
    }
end

function BookOrbit:newClient()
    return BookOrbitApi.new(self:apiOpts(true))
end

function BookOrbit:runInSyncCoroutine(fn)
    if Trapper:isWrapped() then
        return fn()
    end
    return Trapper:wrap(fn)
end

function BookOrbit:isLoggedIn()
    return self.settings.server_url ~= nil and self.settings.username ~= nil and self.settings.userkey ~= nil
end

function BookOrbit:errorLabel(err, fallback)
    if LAST_ERROR_LABELS[err] then return LAST_ERROR_LABELS[err] end
    if err == 401 or err == 403 then return LAST_ERROR_LABELS.auth end
    if type(err) == "number" then
        return T(_("server error %1"), err)
    end
    return fallback or tostring(err or _("unknown error"))
end

function BookOrbit:recordSyncSuccess(event, message)
    self.settings.last_sync = {
        event = event,
        at = os.time(),
        message = message,
    }
    self.settings.last_error = nil
    G_reader_settings:flush()
end

function BookOrbit:recordSyncError(event, err, message)
    self.settings.last_error = {
        event = event,
        at = os.time(),
        code = err,
        message = message or self:errorLabel(err),
    }
    G_reader_settings:flush()
end

function BookOrbit:recordHighlightSync(summary, err)
    summary = BookOrbitHighlightSummary.normalize(summary)
    summary.message = summary.message or BookOrbitHighlightSummary.message(summary)
    self.settings.last_highlight_sync = summary

    local code = BookOrbitHighlightSummary.actionableError(summary, err)
    if code then
        local message
        if code == "unsupported_server" then
            message = _("BookOrbit server needs an update for two-way highlights.")
        end
        self:recordSyncError("highlight_sync", code, message)
    else
        G_reader_settings:flush()
    end
end

function BookOrbit:shouldSkipAutoSyncOffline(event)
    if self.settings.skip_sync_when_offline and not NetworkMgr:isConnected() then
        logger.dbg("BookOrbit: automatic sync skipped while offline:", event)
        return true
    end
    return false
end

function BookOrbit:getSyncCoordinator()
    if not self.sync_coordinator then
        self.sync_coordinator = BookOrbitSyncCoordinator.new{
            on_idle = function()
                UIManager:nextTick(function()
                    self:runPendingUpdateCheck()
                end)
            end,
        }
    end
    return self.sync_coordinator
end

function BookOrbit:getLifecycleOutbox()
    if not self.lifecycle_outbox then
        self.lifecycle_outbox = BookOrbitLifecycleOutbox.open()
    end
    return self.lifecycle_outbox
end

function BookOrbit:getLifecycleOutboxStatus()
    return self:getLifecycleOutbox():diagnostics()
end

function BookOrbit:recordLifecycleOutboxError(err)
    local message = self:errorLabel("outbox_persistence")
    if err == "hard_limit" then
        message = _("Lifecycle sync storage is full. Open BookOrbit diagnostics and reconnect before closing more books.")
    end
    self:recordSyncError("lifecycle_outbox", "outbox_persistence", message)
    Notification:notify(message)
end

function BookOrbit:enqueueLifecycleSnapshot(snap, reason)
    local entry, status_or_err = self:getLifecycleOutbox():enqueue(snap, {
        reason = reason,
        annotation_sync = self.settings.annotation_sync,
    })
    if not entry then
        self:recordLifecycleOutboxError(status_or_err)
        return nil
    end
    if status_or_err and status_or_err.soft_limit then
        local message = _("BookOrbit has many pending lifecycle syncs. Reconnect soon to drain them.")
        self:recordSyncError("lifecycle_outbox", "outbox_persistence", message)
        Notification:notify(message)
    end
    return entry
end

-- `interactive` drains may bring Wi-Fi up (and prompt); lifecycle and
-- background drains only run when a connection already exists, so closing or
-- suspending never triggers a connectivity prompt or leaves the radio on.
function BookOrbit:requestLifecycleOutboxDrain(source, interactive)
    if not self:isLoggedIn() then return false end

    local submit = function()
        UIManager:nextTick(function()
            if not NetworkMgr:isConnected() then return end
            local outbox = self:getLifecycleOutbox()
            local entry = outbox:nextEntry{ include_blocked = interactive == true }
            if not entry then return end
            self:submitSyncJob{
                family = "lifecycle_outbox",
                label = _("Lifecycle sync"),
                source = source or "recovery",
                priority = SYNC_JOB_PRIORITY.lifecycle,
                interactive = false,
                async = true,
                run = function(done)
                    local current = outbox:readLatest(entry.id)
                        or outbox:nextEntry{ include_blocked = interactive == true }
                    if not current then
                        done()
                        return
                    end
                    local started, start_err = outbox:markStarted(current.id, current.generation)
                    if not started then
                        self:recordLifecycleOutboxError(start_err)
                        done()
                        return
                    end

                    local generation = started.generation
                    local function update(method, ...)
                        local updated, err = outbox[method](outbox, started.id, generation, ...)
                        if not updated then
                            self:recordLifecycleOutboxError(err)
                            return false
                        end
                        generation = updated.generation
                        return true
                    end

                    local snap = started.snapshot
                    snap.stats_ids = snap.stats_ids or {}
                    if (not snap.file or lfs.attributes(snap.file, "mode") ~= "file") then
                        local state_book = BookOrbitStateManager.getBook(snap.digest)
                        if state_book and state_book.file
                                and lfs.attributes(state_book.file, "mode") == "file" then
                            snap.file = state_book.file
                        end
                    end

                    local finished = false
                    local function finishEntry(err)
                        if finished then return end
                        finished = true
                        local latest = outbox:readLatest(started.id)
                        local complete = outbox:isComplete(latest)
                        if complete then
                            outbox:removeEntry(started.id)
                        else
                            outbox:markFinished(started.id)
                            if latest and latest.remote_pending then
                                self:recordSyncError(
                                    "lifecycle_outbox",
                                    "remote_apply_pending",
                                    _("Remote book changes are pending until the local book is available."))
                            end
                            if outbox:isBlocked(latest) then
                                self:recordSyncError(
                                    "lifecycle_outbox",
                                    "outbox_blocked",
                                    _("A pending lifecycle sync keeps failing and was parked. Use \"Sync this book\" to retry it."))
                            end
                        end
                        done()
                        if complete and not err then
                            self:requestLifecycleOutboxDrain("recovery")
                        end
                    end

                    local started_sync = BookOrbitBookSync.run{
                        api = self:apiOpts(true),
                        snap = snap,
                        reason = "recovery",
                        -- The captured origin decides whether the sidecar may
                        -- be marked clean; collapsing it to "recovery" left
                        -- every lifecycle-synced book looking changed to the
                        -- next sweep forever.
                        origin = started.reason,
                        interactive = false,
                        plugin = self,
                        annotation_sync = started.annotation_sync,
                        acknowledged = started.acknowledged,
                        remote_pending = started.remote_pending,
                        on_phase_ack = function(phase)
                            return update("acknowledge", phase)
                        end,
                        on_remote_pending = function(kind, payload)
                            return update("recordRemotePending", kind, payload)
                        end,
                        on_remote_applied = function(kind)
                            return update("clearRemotePending", kind)
                        end,
                        on_finish = finishEntry,
                    }
                    if started_sync == false then finishEntry("not_started") end
                end,
            }
        end)
    end

    if NetworkMgr:isConnected() then
        submit()
        return true
    end
    if not interactive or self.settings.skip_sync_when_offline then return false end
    NetworkMgr:willRerunWhenConnected(submit)
    return false
end

function BookOrbit:getSyncCoordinatorStatus()
    if not self.sync_coordinator then
        return { pending_count = 0 }
    end
    return self.sync_coordinator:status()
end

function BookOrbit:getOpenAnnotationScheduler()
    if not self.open_annotation_scheduler then
        self.open_annotation_scheduler = BookOrbitOpenAnnotationScheduler.new{
            delay = OPEN_ANNOTATION_SYNC_DELAY,
            schedule_in = function(delay, callback)
                UIManager:scheduleIn(delay, callback)
            end,
        }
    end
    return self.open_annotation_scheduler
end

function BookOrbit:isOpenBookMatched(digest)
    if not digest then return false end
    return BookOrbitStateManager.getBook(digest) ~= nil
end

function BookOrbit:recordOpenAnnotationUnmatched(reason)
    self:recordHighlightSync({
        event = "open_book",
        reason = reason or "annotation_open",
        skipped = 1,
    }, "unmatched")
end

function BookOrbit:scheduleOpenAnnotationSync(digest, reason, opts)
    return self:getOpenAnnotationScheduler():schedule(self, digest, reason or "annotation_open", opts)
end

function BookOrbit:retryOpenHighlightSync()
    if not self:isLoggedIn() then
        self:promptLogin()
        return
    end
    if not self.ui or not self.ui.document then
        UIManager:show(InfoMessage:new{ text = _("No reader book is open."), timeout = 2 })
        return
    end
    self.open_highlight_retry_status = nil
    self:requestAnnotationExchange("diagnostics_retry")
    UIManager:show(InfoMessage:new{ text = _("BookOrbit highlight sync queued."), timeout = 2 })
end

function BookOrbit:retryOpenBookMatch()
    if not self:isLoggedIn() then
        self:promptLogin()
        return
    end
    if not self.ui or not self.ui.document then
        UIManager:show(InfoMessage:new{ text = _("No reader book is open."), timeout = 2 })
        return
    end
    local digest = self:getDocumentDigest()
    if not digest then
        UIManager:show(InfoMessage:new{ text = _("Could not identify the open book."), timeout = 2 })
        return
    end
    BookOrbitStateManager.mutateScoped({
        digests = { digest },
        global = false,
    }, function(state)
        state.unmatched[digest] = nil
        -- An explicit rematch must not be answered from the freshness stamp.
        BookOrbitState.expireMatch(state:getBook(digest))
    end)
    self:requestOpenBookMatch("diagnostics", {
        schedule_annotation_sync = self.settings.annotation_sync,
        annotation_digest = digest,
    })
    UIManager:show(InfoMessage:new{ text = _("BookOrbit match retry queued."), timeout = 2 })
end

function BookOrbit:submitSyncJob(job)
    if job.family ~= "update_check" then
        self:deferAutomaticUpdateCheck()
    end
    local prepared_job = BookOrbitSyncJobRunner.prepare(job)
    local result = self:getSyncCoordinator():submit(prepared_job)
    if (result == "queued" or result == "kept") and job.interactive then
        UIManager:show(InfoMessage:new{ text = _("BookOrbit sync queued."), timeout = 2 })
    end
    return result
end

function BookOrbit:requestUpdateCheck(interactive, source)
    if interactive and not self:isLoggedIn() then
        self:promptLogin()
        return
    end

    if interactive then
        NetworkMgr:runWhenConnected(function()
            self:runInSyncCoroutine(function()
                self:doCheckForUpdate()
            end)
        end)
        return
    end

    if not NetworkMgr:isConnected() then return end
    if self.automatic_update_check_scheduled or self._checking_update then return end

    self.automatic_update_check_scheduled = true
    UIManager:nextTick(function()
        self.automatic_update_check_scheduled = false
        -- Always consume the deferral here. Re-deferring is driven by the
        -- coordinator being busy right now, never by a stale flag, so the
        -- check can never be suppressed by a deferral that no job will clear.
        local deferred_source = self.automatic_update_check_source
        self.automatic_update_check_pending = false
        self.automatic_update_check_source = nil
        if not NetworkMgr:isConnected() then return end
        if self:getSyncCoordinator():isBusy() then
            self.automatic_update_check_pending = true
            self.automatic_update_check_source = source or deferred_source
            return
        end
        self:runInSyncCoroutine(function()
            self:maybeCheckForUpdate(false)
        end)
    end)
end

function BookOrbit:runPendingUpdateCheck()
    if not self.automatic_update_check_pending then return end
    local source = self.automatic_update_check_source or "deferred"
    self.automatic_update_check_pending = false
    self.automatic_update_check_source = nil
    self:requestUpdateCheck(false, source)
end

function BookOrbit:deferAutomaticUpdateCheck()
    if self.automatic_update_check_scheduled then
        self.automatic_update_check_pending = true
    end
end

function BookOrbit:requestProgressPush(ensure_networking, interactive, source, priority)
    self:submitSyncJob{
        family = "progress_push",
        label = _("Progress push"),
        source = source or (interactive and "manual" or "auto"),
        priority = priority or (interactive and SYNC_JOB_PRIORITY.manual or SYNC_JOB_PRIORITY.auto),
        interactive = interactive == true,
        run = function()
            self:updateProgress(ensure_networking, interactive)
        end,
    }
end

function BookOrbit:requestProgressPull(ensure_networking, interactive, source, priority)
    self:submitSyncJob{
        family = "progress_pull",
        label = _("Progress pull"),
        source = source or (interactive and "manual" or "auto"),
        priority = priority or (interactive and SYNC_JOB_PRIORITY.manual or SYNC_JOB_PRIORITY.auto),
        interactive = interactive == true,
        run = function()
            self:getProgress(ensure_networking, interactive)
        end,
    }
end

function BookOrbit:requestAnnotationExchange(source)
    self:submitSyncJob{
        family = "annotation_exchange",
        label = _("Highlight sync"),
        source = source or "auto",
        priority = SYNC_JOB_PRIORITY.auto,
        interactive = false,
        async = true,
        run = function(done)
            local execute = function()
                self:exchangeAnnotationsForOpenBook(source or "auto")
                done()
            end
            if NetworkMgr:willRerunWhenConnected(function()
                    self:runInSyncCoroutine(execute)
                end) then
                return
            end
            execute()
        end,
    }
end

function BookOrbit:scheduleOpenHighlightRetry(reason, retry_count)
    retry_count = retry_count or 0
    if retry_count >= OPEN_HIGHLIGHT_MAX_RETRIES then
        self.open_highlight_retry_status = nil
        return
    end
    self.open_highlight_retry_status = {
        pending = true,
        reason = reason or "annotation_retry",
        retry_count = retry_count + 1,
        max_retries = OPEN_HIGHLIGHT_MAX_RETRIES,
    }
    UIManager:scheduleIn(OPEN_HIGHLIGHT_RETRY_DELAY, function()
        self.open_highlight_retry_status = nil
        if self:shouldSkipAutoSyncOffline("annotation_retry") then return end
        self:submitSyncJob{
            family = "annotation_exchange",
            label = _("Highlight sync"),
            source = reason or "annotation_retry",
            priority = SYNC_JOB_PRIORITY.auto,
            interactive = false,
            async = true,
            run = function(done)
                local execute = function()
                    self:exchangeAnnotationsForOpenBook(reason or "annotation_retry", retry_count + 1)
                    done()
                end
                if NetworkMgr:willRerunWhenConnected(function()
                        self:runInSyncCoroutine(execute)
                    end) then
                    return
                end
                execute()
            end,
        }
    end)
end

function BookOrbit:requestOpenBookMatch(source, opts)
    opts = opts or {}
    self:submitSyncJob{
        family = "match_open_book",
        label = _("Open book match"),
        source = source or "auto",
        priority = SYNC_JOB_PRIORITY.auto,
        interactive = false,
        async = true,
        run = function(done)
            self:matchOpenBookForAutoSync(function(matched)
                done()
                if not matched then return end
                if opts.schedule_annotation_sync and self.settings.annotation_sync then
                    self:scheduleOpenAnnotationSync(opts.annotation_digest or self:getDocumentDigest(), "annotation_open")
                end
                self:requestProgressPull(true, false, "reader_ready")
            end)
        end,
    }
end

function BookOrbit:requestSweep(interactive, source, opts)
    opts = opts or {}
    local submit = function()
        self:submitSyncJob{
            family = "sweep",
            label = opts.full_recheck and _("Book match recheck") or _("Library sync"),
            source = source or (interactive and "manual" or "auto"),
            priority = interactive and SYNC_JOB_PRIORITY.manual or SYNC_JOB_PRIORITY.auto,
            interactive = interactive == true,
            async = true,
            run = function(done)
                local started = BookOrbitSweep.run{
                    api = self:apiOpts(true),
                    interactive = interactive == true,
                    full_recheck = opts.full_recheck == true,
                    annotation_sync = self.settings.annotation_sync,
                    plugin = self,
                    on_finish = function(err)
                        if not err then
                            self:requestUpdateCheck(false, "sweep_done")
                        end
                        done()
                    end,
                }
                if started == false then
                    done()
                end
            end,
        }
    end

    if NetworkMgr:willRerunWhenConnected(submit) then
        return
    end
    submit()
end

function BookOrbit:requestManualBookSync(snap)
    if not snap then return end
    local api_opts = self:apiOpts(true)

    self:submitSyncJob{
        family = "book_snapshot",
        label = _("Book sync"),
        source = "manual",
        priority = SYNC_JOB_PRIORITY.manual,
        interactive = true,
        async = true,
        run = function(done)
            local function run_book_sync(skip_progress)
                local latest_snap = BookOrbitBookSync.capture(self)
                if not latest_snap then
                    UIManager:show(InfoMessage:new{ text = _("Could not read this book's data."), timeout = 2 })
                    done()
                    return
                end
                if latest_snap.digest ~= snap.digest then
                    UIManager:show(InfoMessage:new{ text = _("The open book changed. Start the sync again."), timeout = 3 })
                    done()
                    return
                end
                local started = BookOrbitBookSync.run{
                    api = api_opts,
                    snap = latest_snap,
                    reason = "manual",
                    interactive = true,
                    plugin = self,
                    annotation_sync = self.settings.annotation_sync,
                    skip_progress = skip_progress,
                    on_finish = done,
                }
                if started == false then
                    done()
                end
            end

            local run = function()
                local will_finish = self:reconcileProgressBeforeBookSync(snap.digest, run_book_sync)
                if will_finish == false then
                    done()
                end
            end
            if NetworkMgr:willRerunWhenConnected(function()
                    self:runInSyncCoroutine(run)
                end) then
                return
            end
            run()
        end,
    }
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

local function promptLogin()
    UIManager:show(InfoMessage:new{
        text = _("Please configure the BookOrbit server and login first."),
        timeout = 3,
    })
end

function BookOrbit:promptLogin()
    promptLogin()
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
    -- Primed here so the close and suspend handlers, which are on a hard
    -- latency budget, never open statistics.sqlite3 to learn the row ids.
    -- Only those handlers consume it, and they run only while logged in.
    if self:isLoggedIn() then
        UIManager:nextTick(function()
            BookOrbitStatsReader.primeIdentity(self:getDocumentDigest())
        end)
    end
    if self.settings.auto_sync then
        UIManager:nextTick(function()
            self:requestLifecycleOutboxDrain("book_open")
            if self:shouldSkipAutoSyncOffline("reader_ready") then return end
            local digest = self:getDocumentDigest()
            if self.settings.annotation_sync then
                if self:isOpenBookMatched(digest) then
                    self:scheduleOpenAnnotationSync(digest, "annotation_open")
                end
            end
            self:requestOpenBookMatch("reader_ready", {
                schedule_annotation_sync = self.settings.annotation_sync,
                annotation_digest = digest,
            })
        end)
    end
    self:registerEvents()

    self.last_page = self.ui:getCurrentPage()
end

local function titleFromFile(file)
    if not file or file == "" then return nil end
    local name = file:gsub(".*/", "")
    if name == "" then return nil end
    local title = name:gsub("%.[^%.]+$", "")
    return title ~= "" and title or name
end

function BookOrbit:matchOpenBookForAutoSync(on_done)
    if not self:isLoggedIn() or not self.ui or not self.ui.document then
        if on_done then on_done(false) end
        return
    end

    local digest = self:getDocumentDigest()
    if not digest then
        if on_done then on_done(false) end
        return
    end

    local state = BookOrbitStateManager.session({
        digests = { digest },
        files = { self.ui.document.file },
    })
    local had_local_match = state:getBook(digest) ~= nil
    -- Any local match used to end this path, with no freshness bound at all, so
    -- a book whose server-side file was deleted or re-imported could stay
    -- wrongly matched forever. The bound here is a correctness fix.
    if BookOrbitState.isMatchFresh(state:getBook(digest), state.global) then
        if on_done then on_done(true) end
        return
    end

    local run = function()
        if not self.ui or not self.ui.document then
            if on_done then on_done(false) end
            return
        end
        local body, err = self:newClient():matchCheck({ digest }, {
            [digest] = {
                title = titleFromFile(self.ui.document.file),
                source = "current_file",
            },
        })
        if not body then
            self:recordSyncError("match_open_book", err)
            -- A failed re-verification must not demote a book that is matched
            -- locally; it just stays due for the next attempt.
            if on_done then on_done(had_local_match) end
            return
        end

        BookOrbitState.applyLibraryVersion(state, body.libraryVersion)
        local matched = false
        for _, match in ipairs(body.matches or {}) do
            if match.hash == digest then
                state:setMatched(match.hash, match.bookFileId, match.bookId, self.ui.document.file)
                matched = true
                break
            end
        end
        state:flush()
        if on_done then on_done(matched) end
    end

    if self:shouldSkipAutoSyncOffline("match_open_book") then
        if on_done then on_done(false) end
        return
    end
    if NetworkMgr:willRerunWhenConnected(function()
            self:runInSyncCoroutine(run)
        end) then
        return
    end
    self:runInSyncCoroutine(run)
end

-- Two-way annotation pull/push for the open book. Runs once per book open;
-- safe to call again manually, guarded against concurrent syncs.
function BookOrbit:exchangeAnnotationsForOpenBook(reason, retry_count)
    if self.annotation_exchange_running then return end
    if not self:isLoggedIn() or not self.ui or not self.ui.document then return end
    if BookOrbitBookSync.isRunning() or BookOrbitSweep.isRunning() then return end

    local digest = self:getDocumentDigest()
    if not digest then return end
    local state = BookOrbitStateManager.session({
        digests = { digest },
        global = false,
    })
    if not state:getBook(digest) then
        -- Unknown or unmatched book: the close-path snapshot sync matches it.
        self:recordHighlightSync({
            event = "open_book",
            reason = reason or "auto",
            skipped = 1,
        }, "unmatched")
        return
    end

    self.annotation_exchange_running = true
    local client = self:newClient()
    local ok, result, err = pcall(BookOrbitAnnotations.exchangeOpenBook, {
        client = client,
        state = state,
        digest = digest,
        ui = self.ui,
    })
    local bm_ok, bm_result, bm_err
    if BookOrbitBookmarks.enabled(client, self.settings.annotation_sync) then
        bm_ok, bm_result, bm_err = pcall(BookOrbitBookmarks.exchangeOpenBook, {
            client = client,
            state = state,
            digest = digest,
            ui = self.ui,
        })
        if bm_ok and bm_err == "unsupported_server" then
            BookOrbitBookmarks.markUnsupported(client)
        end
    end
    state:flush()
    self.annotation_exchange_running = false

    local summary = { event = "open_book", reason = reason or "auto" }
    local error_code
    if not ok then
        logger.err("BookOrbit: annotation exchange error:", result)
        summary.failed = 1
        error_code = "partial_failure"
    elseif result then
        summary = BookOrbitHighlightSummary.add(summary, result)
    elseif err then
        summary.skipped = err == "unmatched" and 1 or 0
        summary.failed = (err == "network" or err == "unsupported_server") and 1 or 0
        error_code = err
        if err ~= "unmatched" and err ~= "unsupported_server" and err ~= "network" then
            logger.dbg("BookOrbit: annotation exchange skipped:", err)
        end
    end

    if bm_ok == false then
        logger.err("BookOrbit: bookmark exchange error:", bm_result)
        summary = BookOrbitHighlightSummary.addBookmarks(summary, { had_errors = true })
        error_code = error_code or "partial_failure"
    elseif bm_result then
        summary = BookOrbitHighlightSummary.addBookmarks(summary, bm_result)
    elseif bm_err and bm_err ~= "unmatched" and bm_err ~= "unsupported_server" then
        summary = BookOrbitHighlightSummary.addBookmarks(summary, { had_errors = true })
        error_code = error_code or bm_err
    end

    self:recordHighlightSync(summary, error_code)
    if BookOrbitHighlightSummary.hasRemoteChanges(summary) then
        Notification:notify(T(_("BookOrbit: %1 highlight(s) updated"),
            summary.applied + summary.deleted))
    end
    if BookOrbitHighlightSummary.hasRemoteBookmarkChanges(summary) then
        Notification:notify(T(_("BookOrbit: %1 bookmark(s) updated"),
            summary.bm_applied + summary.bm_deleted))
    end
    if ok and result then
        if reason == "annotation_open" and (summary.failed or 0) > 0 then
            self:scheduleOpenHighlightRetry(reason, retry_count or 0)
        elseif (summary.failed or 0) == 0 then
            self.open_highlight_retry_status = nil
        end
    end
end

-- Catalog browser

function BookOrbit:openCatalogBrowser(prefer_cached_dashboard)
    if self.catalog_browser ~= nil then return end
    self.catalog_browser = BookOrbitCatalog:new{
        title = _("BookOrbit"),
        -- The catalog owns its subprocess boundaries explicitly, so every
        -- request path, including the ones that bypass fetch(), runs off the
        -- UI thread.
        api = self:apiOpts(true),
        settings = self.settings,
        path = self.path,
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

-- Manual sync triggers

function BookOrbit:startSweep()
    if not self:isLoggedIn() then
        promptLogin()
        return
    end
    self:requestLifecycleOutboxDrain("manual", true)
    self:requestSweep(true, "manual")
end

-- Maintenance counterpart of the incremental sweep: rechecks every known hash
-- against the server instead of only the ones local state cannot vouch for.
function BookOrbit:startMatchRecheck()
    if not self:isLoggedIn() then
        promptLogin()
        return
    end
    self:requestSweep(true, "recheck", { full_recheck = true })
end

function BookOrbit:onBookOrbitSyncBook()
    if not self:isLoggedIn() then
        promptLogin()
        return
    end
    if not self.ui or not self.ui.document then
        UIManager:show(InfoMessage:new{ text = _("No reader book is open."), timeout = 2 })
        return
    end

    local snap = BookOrbitBookSync.capture(self)
    if not snap then
        UIManager:show(InfoMessage:new{ text = _("Could not read this book's data."), timeout = 2 })
        return
    end

    self:requestLifecycleOutboxDrain("manual", true)
    self:requestManualBookSync(snap)
end

-- Events

function BookOrbit:_onCloseDocument()
    logger.dbg("BookOrbit: onCloseDocument")
    self.onResume = nil
    self.onSuspend = nil
    UIManager:unschedule(self.periodic_push_task)
    self.periodic_push_scheduled = false
    self:deferAutomaticUpdateCheck()

    if not self:isLoggedIn() then return end

    -- Snapshot now: reader objects die after this handler returns. ReaderUI
    -- already flushed the sidecar and statistics before broadcasting
    -- CloseDocument, so memory, sidecar and stats DB agree at this point.
    local snap = BookOrbitBookSync.capture(self)
    if not snap then return end
    if not self:enqueueLifecycleSnapshot(snap, "close") then return end
    self:requestLifecycleOutboxDrain("close")
end

function BookOrbit:_onPageUpdate(page)
    if page == nil then return end
    if self.last_page ~= page then
        self.last_page = page
        self.last_page_turn_timestamp = os.time()
        self.page_update_counter = self.page_update_counter + 1
        -- A pending periodic push is re-delayed on every page turn so it
        -- only fires once the reader is actually idle.
        if self.settings.auto_sync and (self.periodic_push_scheduled
                or (self.settings.pages_before_update or 0) > 0 and self.page_update_counter >= self.settings.pages_before_update) then
            self:schedulePeriodicPush()
        end
    end
end

function BookOrbit:_onResume()
    logger.dbg("BookOrbit: onResume")
    if Device:hasWifiRestore() and NetworkMgr.wifi_was_on and G_reader_settings:isTrue("auto_restore_wifi") then
        return
    end
    if self:shouldSkipAutoSyncOffline("resume") then return end
    UIManager:scheduleIn(1, function()
        self:requestProgressPull(true, false, "resume")
    end)
end

function BookOrbit:_onSuspend()
    logger.dbg("BookOrbit: onSuspend")
    UIManager:unschedule(self.periodic_push_task)
    self.periodic_push_scheduled = false
    self:deferAutomaticUpdateCheck()

    if not self:isLoggedIn() then return end
    local snap = BookOrbitBookSync.capture(self)
    if not snap then return end
    if not self:enqueueLifecycleSnapshot(snap, "suspend") then return end
    self:requestLifecycleOutboxDrain("suspend")
end

function BookOrbit:_onNetworkConnected()
    logger.dbg("BookOrbit: onNetworkConnected")
    UIManager:scheduleIn(0.5, function()
        if self:shouldSkipAutoSyncOffline("network_connected") then return end
        self:requestLifecycleOutboxDrain("network_connected")
        self:requestProgressPull(false, false, "network_connected")
        self:requestUpdateCheck(false, "network_connected")
    end)
end

function BookOrbit:_onNetworkDisconnecting()
    logger.dbg("BookOrbit: onNetworkDisconnecting")
    if self:shouldSkipAutoSyncOffline("network_disconnecting") then return end
    self:requestProgressPush(false, false, "network_disconnecting", SYNC_JOB_PRIORITY.lifecycle)
end

function BookOrbit:onBookOrbitPushProgress()
    self:requestProgressPush(true, true, "manual")
end

function BookOrbit:onBookOrbitPullProgress()
    self:requestProgressPull(true, true, "manual")
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
        self:requestProgressPull(true, true, "auto_enabled")
    else
        UIManager:unschedule(self.periodic_push_task)
        self.periodic_push_scheduled = false
        self.page_update_counter = 0
        if from_menu then
            self:requestProgressPush(true, true, "auto_disabled")
        end
    end

    if not from_menu then
        Notification:notify(self.settings.auto_sync and _("BookOrbit auto progress sync: on") or _("BookOrbit auto progress sync: off"))
    end
    return true
end

function BookOrbit:registerEvents()
    self.onPageUpdate = self._onPageUpdate
    if self.settings.auto_sync then
        self.onCloseDocument = self._onCloseDocument
        self.onResume = self._onResume
        self.onSuspend = self._onSuspend
        self.onNetworkConnected = self._onNetworkConnected
        self.onNetworkDisconnecting = self._onNetworkDisconnecting
    else
        self.onCloseDocument = nil
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

-- Real teardown, unlike document close: the sweep is a module singleton that
-- deliberately outlives a reader session, but nothing should keep scheduling
-- chunks or hold the statistics connection into a shutdown. Cancelling here
-- also flushes whatever the server already acknowledged.
-- Returns nothing on purpose: a truthy return would consume the broadcast
-- before the widgets that actually handle shutdown see it.
function BookOrbit:tearDownBackgroundWork()
    BookOrbitSweep.cancel("teardown")
end

BookOrbit.onPowerOff = BookOrbit.tearDownBackgroundWork
BookOrbit.onReboot = BookOrbit.tearDownBackgroundWork

return BookOrbit
