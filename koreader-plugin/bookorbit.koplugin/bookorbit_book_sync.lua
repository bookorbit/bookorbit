--[[--
Per-book snapshot sync: pushes progress, highlights, status/rating and page
stats for ONE book, sourced from live memory instead of the sidecar file, so
mid-session data is never stale.

capture() runs synchronously while the ReaderUI is alive and returns plain
tables only; run() uploads afterwards and never touches reader objects, so the
close path can finish after the document is gone. Watermarks share the exact
ack-gated semantics of the full sweep, and both write the same state file
under mutual exclusion, so sweep and snapshot never double-upload.
]]

local InfoMessage = require("ui/widget/infomessage")
local Notification = require("ui/widget/notification")
local UIManager = require("ui/uimanager")
local logger = require("logger")
local T = require("ffi/util").template
local _ = require("gettext")

local BookOrbitAnnotations = require("bookorbit_annotations")
local BookOrbitApi = require("bookorbit_api")
local BookOrbitSidecar = require("bookorbit_sidecar")
local BookOrbitState = require("bookorbit_state")
local BookOrbitStatsReader = require("bookorbit_stats_reader")
local BookOrbitSweep = require("bookorbit_sweep")

local STEP_DELAY = 0.1
local STATS_BATCH = 500
local ANN_BATCH_TOTAL = 50

local BookOrbitBookSync = {
    running = false,
}

function BookOrbitBookSync.isRunning()
    return BookOrbitBookSync.running
end

-- Synchronous snapshot of the open book from live memory. The statistics
-- flush writes pending page stats to statistics.sqlite3, which run() reads
-- later; the DB outlives the document.
function BookOrbitBookSync.capture(plugin)
    local ui = plugin.ui
    if not ui or not ui.document then return nil end

    local digest = plugin:getDocumentDigest()
    if not digest then return nil end

    local annotations, ann_max = BookOrbitSidecar.normalizeAnnotations(ui.annotation and ui.annotation.annotations)
    local summary = BookOrbitSidecar.normalizeSummary(ui.doc_settings:readSetting("summary"))

    local stats = ui.statistics
    if stats and stats.settings and stats.settings.is_enabled then
        pcall(stats.insertDB, stats)
    end

    local file = ui.document.file
    return {
        digest = digest,
        file = file,
        percentage = plugin:getLastPercent(),
        progress = plugin:getLastProgress(),
        status = summary.status,
        status_modified = summary.status_modified,
        rating = summary.rating,
        annotations = annotations,
        ann_count = #annotations,
        ann_max_datetime = ann_max,
        mtime_at_capture = file and BookOrbitSidecar.sidecarMtime(file) or nil,
        ts = os.time(),
    }
end

local function isAuthError(err)
    return err == 401 or err == 403
end

-- Numbers are HTTP statuses (server reachable, keep going); anything else is
-- a transport failure, where firing more doomed requests would just stack
-- timeouts, which the synchronous suspend path cannot afford.
local function isTransportError(err)
    return type(err) ~= "number"
end

local function isUnmatched(body, md5)
    for _, hash in ipairs(body.unmatched or {}) do
        if hash == md5 then return true end
    end
    return false
end

local function finish(ctx, err)
    BookOrbitBookSync.running = false

    -- The sidecar-clean marker is only safe on the close path: ReaderUI
    -- flushed the sidecar before our handler captured, so memory equals disk
    -- unless the book was reopened mid-upload (mtime check guards that).
    if not err and not ctx.had_errors and ctx.reason == "close"
            and ctx.snap.file and ctx.snap.mtime_at_capture then
        local book = ctx.state:getBook(ctx.snap.digest)
        if book and BookOrbitSidecar.sidecarMtime(ctx.snap.file) == ctx.snap.mtime_at_capture then
            book.sidecarMtime = ctx.snap.mtime_at_capture
        end
    end

    ctx.state:flush()

    if err == "auth" then
        if ctx.interactive then
            UIManager:show(InfoMessage:new{ text = _("BookOrbit sync: login failed. Check your credentials."), timeout = 4 })
        else
            Notification:notify(_("BookOrbit sync: login failed"))
        end
    elseif err == "network" then
        if ctx.interactive then
            UIManager:show(InfoMessage:new{ text = _("BookOrbit sync: server not reachable."), timeout = 4 })
        end
        logger.dbg("BookOrbit: book sync aborted, server not reachable")
    elseif err == "unmatched" then
        if ctx.interactive then
            UIManager:show(InfoMessage:new{ text = _("This book is not in your BookOrbit library."), timeout = 4 })
        end
        logger.dbg("BookOrbit: book sync skipped, book unmatched:", ctx.snap.digest)
    else
        if ctx.interactive then
            local text = T(_("BookOrbit: book synced. %1 reading events, %2 highlights up, %3 applied."),
                ctx.counts.page_stats, ctx.counts.annotations, ctx.counts.ann_applied or 0)
            if ctx.had_errors then
                text = text .. "\n" .. _("Some uploads failed and will retry on the next sync.")
            end
            UIManager:show(InfoMessage:new{ text = text, timeout = 4 })
        end
        logger.info(string.format(
            "BookOrbit: book sync done reason=%s pageStats=%d annotations=%d applied=%d errors=%s",
            ctx.reason, ctx.counts.page_stats, ctx.counts.annotations, ctx.counts.ann_applied or 0, tostring(ctx.had_errors)))
    end

    if ctx.on_finish then
        pcall(ctx.on_finish)
    end
end

-- In synchronous mode (suspend path) the steps run inline as tail calls under
-- one pcall in run(); otherwise they are chained through UIManager:scheduleIn
-- so the UI stays responsive.
local function step(ctx, fn)
    if ctx.synchronous then
        return fn(ctx)
    end
    UIManager:scheduleIn(STEP_DELAY, function()
        local ok, err = pcall(fn, ctx)
        if not ok then
            logger.err("BookOrbit: book sync step failed:", err)
            ctx.had_errors = true
            finish(ctx)
        end
    end)
end

local stepMatch, stepStats, stepAnnotations, stepAnnotationsLegacy, stepState, stepProgress

stepMatch = function(ctx)
    local book = ctx.state:getBook(ctx.snap.digest)
    if book then
        if ctx.snap.file and not book.file then
            book.file = ctx.snap.file
        end
        return step(ctx, stepStats)
    end

    local body, err = ctx.client:matchCheck({ ctx.snap.digest })
    if not body then
        if isAuthError(err) then return finish(ctx, "auth") end
        return finish(ctx, "network")
    end

    for _, match in ipairs(body.matches or {}) do
        if match.hash == ctx.snap.digest then
            ctx.state:setMatched(match.hash, match.bookFileId, match.bookId, ctx.snap.file)
            return step(ctx, stepStats)
        end
    end

    ctx.state:setUnmatched(ctx.snap.digest)
    return finish(ctx, "unmatched")
end

stepStats = function(ctx)
    local book = ctx.state:getBook(ctx.snap.digest)
    if not book then return finish(ctx, "unmatched") end

    if ctx.stat_ids == nil then
        ctx.stat_ids = BookOrbitStatsReader.getBookIds(ctx.snap.digest)
    end
    if #ctx.stat_ids == 0 then
        return step(ctx, stepAnnotations)
    end

    local watermark = book.statsWatermark or 0
    local events = BookOrbitStatsReader.getEventsAfter(ctx.stat_ids, watermark, STATS_BATCH)
    if not events or #events == 0 then
        return step(ctx, stepAnnotations)
    end

    local body, err = ctx.client:uploadPageStats({ { hash = ctx.snap.digest, events = events } })
    if not body then
        if isAuthError(err) then return finish(ctx, "auth") end
        ctx.had_errors = true
        if isTransportError(err) then return finish(ctx, "network") end
        logger.dbg("BookOrbit: book sync page stats upload failed:", err)
        return step(ctx, stepAnnotations)
    end
    if isUnmatched(body, ctx.snap.digest) then
        ctx.state:setUnmatched(ctx.snap.digest)
        return finish(ctx, "unmatched")
    end

    local more = BookOrbitState.applyStatsAck(book, events, body, ctx.snap.digest, STATS_BATCH, watermark)
    ctx.counts.page_stats = ctx.counts.page_stats + #events
    if more then
        return step(ctx, stepStats)
    end
    return step(ctx, stepAnnotations)
end

-- Two-way exchange: uploads the local delta, reports the full key set for
-- deletion detection, applies server-side changes (live for the manual sync
-- while the book is open, sidecar on the close path) and acks them.
stepAnnotations = function(ctx)
    local book = ctx.state:getBook(ctx.snap.digest)
    if not book then return finish(ctx, "unmatched") end

    local apply_mode = "skip"
    if ctx.annotation_sync then
        if ctx.reason == "close" then
            apply_mode = "sidecar"
        elseif ctx.reason == "manual" and ctx.plugin and ctx.plugin.ui and ctx.plugin.ui.document then
            apply_mode = "live"
        end
    end

    local result, err = BookOrbitAnnotations.exchangeBook({
        client = ctx.client,
        state = ctx.state,
        digest = ctx.snap.digest,
        annotations = ctx.snap.annotations,
        ann_max_datetime = ctx.snap.ann_max_datetime,
        apply_mode = apply_mode,
        ui = apply_mode == "live" and ctx.plugin.ui or nil,
        file = ctx.snap.file,
    })
    if not result then
        if err == "auth" then return finish(ctx, "auth") end
        if err == "network" then
            ctx.had_errors = true
            return finish(ctx, "network")
        end
        if err == "unmatched" then return finish(ctx, "unmatched") end
        if err == "unsupported_server" then
            return step(ctx, stepAnnotationsLegacy)
        end
        ctx.had_errors = true
        return step(ctx, stepState)
    end

    if result.had_errors then ctx.had_errors = true end
    ctx.counts.annotations = ctx.counts.annotations + result.uploaded
    ctx.counts.ann_applied = (ctx.counts.ann_applied or 0) + result.applied
    if not result.had_errors then
        book.annCount = ctx.snap.ann_count
    end
    return step(ctx, stepState)
end

-- One-way upload for servers without the 0.4 exchange endpoint.
stepAnnotationsLegacy = function(ctx)
    local book = ctx.state:getBook(ctx.snap.digest)
    if not book then return finish(ctx, "unmatched") end

    if ctx.ann_delta == nil then
        ctx.ann_delta = {}
        ctx.ann_failed = false
        local watermark = BookOrbitAnnotations.readWatermark(book, os.date("%Y-%m-%d %H:%M:%S"))
        for _, annotation in ipairs(ctx.snap.annotations) do
            local effective = annotation.datetimeUpdated or annotation.datetime
            if effective > watermark then
                table.insert(ctx.ann_delta, annotation)
            end
        end
    end

    if #ctx.ann_delta == 0 then
        if not ctx.ann_failed then
            BookOrbitAnnotations.advanceWatermark(book, ctx.snap.ann_max_datetime, os.date("%Y-%m-%d %H:%M:%S"))
            book.annCount = ctx.snap.ann_count
        end
        return step(ctx, stepState)
    end

    local chunk = {}
    while #ctx.ann_delta > 0 and #chunk < ANN_BATCH_TOTAL do
        table.insert(chunk, table.remove(ctx.ann_delta, 1))
    end

    local body, err = ctx.client:uploadAnnotations({ { hash = ctx.snap.digest, annotations = chunk } })
    if not body then
        if isAuthError(err) then return finish(ctx, "auth") end
        ctx.had_errors = true
        ctx.ann_failed = true
        ctx.ann_delta = {}
        if isTransportError(err) then return finish(ctx, "network") end
        logger.dbg("BookOrbit: book sync annotations upload failed:", err)
        return step(ctx, stepState)
    end
    if isUnmatched(body, ctx.snap.digest) then
        ctx.state:setUnmatched(ctx.snap.digest)
        return finish(ctx, "unmatched")
    end

    ctx.counts.annotations = ctx.counts.annotations + #chunk
    return step(ctx, stepAnnotationsLegacy)
end

stepState = function(ctx)
    local book = ctx.state:getBook(ctx.snap.digest)
    if not book then return finish(ctx, "unmatched") end

    if ctx.snap.status == nil and ctx.snap.rating == nil then
        return step(ctx, stepProgress)
    end
    local status_changed = ctx.snap.status ~= nil
        and (ctx.snap.status_modified or "") ~= (book.statusSyncedModified or "")
    local rating_changed = (ctx.snap.rating or 0) ~= (book.ratingSynced or 0)
    if not status_changed and not rating_changed then
        return step(ctx, stepProgress)
    end

    local body, err = ctx.client:uploadBookStates({
        {
            hash = ctx.snap.digest,
            status = ctx.snap.status,
            statusModified = ctx.snap.status_modified,
            rating = ctx.snap.rating,
        },
    })
    if not body then
        if isAuthError(err) then return finish(ctx, "auth") end
        ctx.had_errors = true
        if isTransportError(err) then return finish(ctx, "network") end
        logger.dbg("BookOrbit: book sync state upload failed:", err)
        return step(ctx, stepProgress)
    end
    if isUnmatched(body, ctx.snap.digest) then
        ctx.state:setUnmatched(ctx.snap.digest)
        return finish(ctx, "unmatched")
    end

    -- A server-kept tie still counts as synced: the device value was considered.
    book.statusSyncedModified = ctx.snap.status_modified or book.statusSyncedModified
    book.ratingSynced = ctx.snap.rating or book.ratingSynced
    return step(ctx, stepProgress)
end

stepProgress = function(ctx)
    local book = ctx.state:getBook(ctx.snap.digest)
    if not book then return finish(ctx, "unmatched") end

    local pct = ctx.snap.percentage
    if type(pct) ~= "number" then
        return finish(ctx)
    end
    local pushed = book.progressPushedPct or -1
    if math.abs(pct - pushed) <= 0.001 and not ctx.interactive then
        return finish(ctx)
    end

    -- The live PUT carries device/device_id/timestamp, which is what the
    -- pull-conflict logic on other devices consumes; the bulk endpoint is the
    -- sweep's many-books channel with sidecar freshness semantics.
    local body, err = ctx.client:updateProgress(ctx.snap.digest, pct, ctx.snap.progress, ctx.snap.ts)
    if ctx.plugin then
        ctx.plugin.push_timestamp = UIManager:getElapsedTimeSinceBoot()
    end
    if not body then
        if isAuthError(err) then return finish(ctx, "auth") end
        logger.dbg("BookOrbit: book sync progress push failed:", err)
        ctx.had_errors = true
        return finish(ctx)
    end

    book.progressPushedPct = pct
    return finish(ctx)
end

function BookOrbitBookSync.run(opts)
    if BookOrbitBookSync.running or BookOrbitSweep.isRunning() then
        if opts.interactive then
            UIManager:show(InfoMessage:new{ text = _("BookOrbit sync is already running."), timeout = 2 })
        end
        return
    end

    local snap = opts.snap
    if not snap then return end

    local client = BookOrbitApi.new(opts.api)
    if not client:isConfigured() then
        if opts.interactive then
            UIManager:show(InfoMessage:new{ text = _("Please configure the BookOrbit server and login first."), timeout = 3 })
        end
        return
    end

    BookOrbitBookSync.running = true

    local ctx = {
        client = client,
        state = BookOrbitState.open(),
        snap = snap,
        reason = opts.reason or "manual",
        interactive = opts.interactive or false,
        synchronous = opts.synchronous or false,
        annotation_sync = opts.annotation_sync ~= false,
        plugin = opts.plugin,
        on_finish = opts.on_finish,
        counts = { page_stats = 0, annotations = 0, ann_applied = 0 },
        had_errors = false,
    }

    ctx.state:rememberFile(snap.file, snap.digest)
    logger.dbg("BookOrbit: book sync started, reason:", ctx.reason)

    if ctx.synchronous then
        local ok, err = pcall(step, ctx, stepMatch)
        if not ok then
            logger.err("BookOrbit: book sync failed:", err)
            ctx.had_errors = true
            finish(ctx)
        end
    else
        step(ctx, stepMatch)
    end
end

return BookOrbitBookSync
