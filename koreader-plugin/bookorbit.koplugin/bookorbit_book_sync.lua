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
local Trapper = require("ui/trapper")
local UIManager = require("ui/uimanager")
local logger = require("logger")
local lfs = require("libs/libkoreader-lfs")
local ffiutil = require("ffi/util")
local T = ffiutil.template
local _ = require("gettext")

local BookOrbitAnnotations = require("bookorbit_annotations")
local BookOrbitApi = require("bookorbit_api")
local BookOrbitBookmarks = require("bookorbit_bookmarks")
local BookOrbitHighlightSummary = require("bookorbit_highlight_summary")
local BookOrbitSidecar = require("bookorbit_sidecar")
local BookOrbitState = require("bookorbit_state")
local BookOrbitStateManager = require("bookorbit_state_manager")
local BookOrbitStatsReader = require("bookorbit_stats_reader")
local BookOrbitSweep = require("bookorbit_sweep")

local STEP_DELAY = 0.1
local STATS_BATCH = 500
local ANN_BATCH_TOTAL = 50

local BookOrbitBookSync = {
    running = false,
}

local function titleFromFile(file)
    if not file or file == "" then return nil end
    local name = file:gsub(".*/", "")
    if name == "" then return nil end
    local title = name:gsub("%.[^%.]+$", "")
    if title == "" then return name end
    return title
end

function BookOrbitBookSync.isRunning()
    return BookOrbitBookSync.running
end

local function elapsedMs(started)
    local ok, seconds, micros = pcall(ffiutil.gettime)
    if ok and type(seconds) == "number" then
        return (seconds * 1000 + (micros or 0) / 1000) - started
    end
    return os.clock() * 1000 - started
end

local function nowMs()
    return elapsedMs(0)
end

-- Synchronous snapshot of the open book from live memory. The statistics
-- flush writes pending page stats to statistics.sqlite3, which run() reads
-- later; the DB outlives the document.
function BookOrbitBookSync.capture(plugin)
    local ui = plugin.ui
    if not ui or not ui.document then return nil end

    local digest = plugin:getDocumentDigest()
    if not digest then return nil end

    local started_ms = nowMs()
    local live_annotations = ui.annotation and ui.annotation.annotations
    local annotations, ann_max, ann_signature = BookOrbitSidecar.normalizeAnnotations(live_annotations)
    local bookmarks, _bm_max, bm_signature = BookOrbitSidecar.normalizeBookmarks(live_annotations)
    local summary = BookOrbitSidecar.normalizeSummary(ui.doc_settings:readSetting("summary"))

    local stats = ui.statistics
    if stats and stats.settings and stats.settings.is_enabled then
        pcall(stats.insertDB, stats)
    end

    local file = ui.document.file
    local ts = os.time()
    -- Identity is primed after reader ready, so the close and suspend handlers
    -- normally open no database at all. A cold cache still resolves here, and
    -- a cached miss (no statistics row yet) falls back at drain time.
    local metadata, cached = BookOrbitStatsReader.cachedIdentity(digest)
    if not cached then
        metadata = BookOrbitStatsReader.primeIdentity(digest)
    end
    metadata = metadata or {}
    local stats_ambiguous = metadata.metadata_ambiguous == true
    local stats_ids = {}
    for _, id in ipairs(metadata.ids or {}) do
        table.insert(stats_ids, id)
    end
    logger.dbg(string.format("BookOrbit: lifecycle capture identity=%s elapsedMs=%.1f",
        cached and "cached" or "uncached", elapsedMs(started_ms)))
    return {
        digest = digest,
        file = file,
        title = stats_ambiguous and titleFromFile(file) or (metadata.title or titleFromFile(file)),
        authors = stats_ambiguous and nil or metadata.authors,
        last_open = metadata.last_open or ts,
        metadata_ambiguous = false,
        stats_metadata_ambiguous = stats_ambiguous,
        stats_ids = stats_ids,
        percentage = plugin:getLastPercent(),
        progress = plugin:getLastProgress(),
        status = summary.status,
        status_modified = summary.status_modified,
        rating = summary.rating,
        review_note = summary.review_note,
        review_modified = summary.status_modified,
        annotations = annotations,
        ann_count = #annotations,
        ann_max_datetime = ann_max,
        ann_signature = ann_signature,
        bookmarks = bookmarks,
        bm_signature = bm_signature,
        mtime_at_capture = file and BookOrbitSidecar.sidecarMtime(file) or nil,
        ts = ts,
    }
end

local function isAuthError(err)
    return err == 401 or err == 403
end

-- Numbers are HTTP statuses (server reachable, keep going); anything else is
-- a transport failure, where firing more doomed requests would stack timeouts.
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
    -- Lifecycle entries drain as "recovery", so the origin recorded when the
    -- snapshot was captured decides. Suspend stays excluded: ReaderUI flushes
    -- before CloseDocument, not before Suspend.
    local close_origin = ctx.reason == "close" or ctx.origin == "close"
    if not err and not ctx.had_errors and close_origin
            and ctx.snap.file and ctx.snap.mtime_at_capture then
        local book = ctx.state:getBook(ctx.snap.digest)
        if book and BookOrbitSidecar.sidecarMtime(ctx.snap.file) == ctx.snap.mtime_at_capture then
            book.sidecarMtime = ctx.snap.mtime_at_capture
        end
    end

    ctx.state:flush()

    if ctx.plugin and ctx.plugin.recordSyncError then
        if err == "auth" or err == "network" then
            ctx.plugin:recordSyncError("book_sync", err)
        elseif err == "outbox" then
            ctx.plugin:recordSyncError("book_sync", "outbox_persistence")
        elseif not err and ctx.had_errors then
            ctx.plugin:recordSyncError("book_sync", "partial_failure")
        elseif not err and ctx.plugin.recordSyncSuccess then
            ctx.plugin:recordSyncSuccess(
                "book_sync",
                T(_("%1 reading events, %2 highlights uploaded"),
                    ctx.counts.page_stats, ctx.counts.annotations))
        end
    end

    if ctx.plugin and ctx.plugin.recordHighlightSync and ctx.highlight_summary
            and BookOrbitHighlightSummary.hasCounts(ctx.highlight_summary) then
        local highlight_err = ctx.highlight_unsupported and "unsupported_server" or nil
        if ctx.had_errors and not highlight_err then
            highlight_err = "partial_failure"
        end
        ctx.plugin:recordHighlightSync(ctx.highlight_summary, highlight_err)
    end

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
    elseif err == "outbox" then
        logger.err("BookOrbit: lifecycle sync stopped because its durable state could not be updated")
    else
        if ctx.interactive then
            local text = T(_("BookOrbit: book synced. %1 reading events."), ctx.counts.page_stats)
            if ctx.highlight_summary and BookOrbitHighlightSummary.hasCounts(ctx.highlight_summary) then
                text = text .. "\n" .. BookOrbitHighlightSummary.message(ctx.highlight_summary)
            else
                text = text .. "\n" .. T(_("Highlights synced: %1 uploaded, %2 applied, %3 deleted."),
                    ctx.counts.annotations, ctx.counts.ann_applied or 0, ctx.counts.ann_deleted or 0)
            end
            if ctx.highlight_unsupported then
                text = text .. "\n" .. _("BookOrbit server needs an update for two-way highlights.")
            end
            if ctx.highlight_disabled_reported then
                text = text .. "\n" .. _("Two-way highlight and bookmark sync is disabled.")
            end
            if ctx.skip_progress then
                text = text .. "\n" .. _("Progress was not changed.")
            end
            if ctx.had_errors then
                text = text .. "\n" .. _("Some uploads failed and will retry on the next sync.")
            end
            UIManager:show(InfoMessage:new{ text = text, timeout = 4 })
        end
        logger.info(string.format(
            "BookOrbit: book sync done reason=%s pageStats=%d annotations=%d applied=%d deleted=%d errors=%s",
            ctx.reason, ctx.counts.page_stats, ctx.counts.annotations,
            ctx.counts.ann_applied or 0, ctx.counts.ann_deleted or 0, tostring(ctx.had_errors)))
    end

    if ctx.on_finish then
        pcall(ctx.on_finish, err)
    end
end

-- Local sync state must hit disk before the phase is acknowledged, otherwise a
-- crash would skip a phase whose watermarks were never saved. Phases that only
-- short-circuit pass state_changed = false and skip the (expensive) flush.
local function acknowledge(ctx, phase, state_changed)
    if not ctx.on_phase_ack then return true end
    if state_changed ~= false then ctx.state:flush() end
    local ok, result = pcall(ctx.on_phase_ack, phase)
    if not ok or result == false then
        ctx.had_errors = true
        logger.err("BookOrbit: could not persist lifecycle phase acknowledgement:", phase, result)
        finish(ctx, "outbox")
        return false
    end
    return true
end

local function step(ctx, fn)
    UIManager:scheduleIn(STEP_DELAY, function()
        Trapper:wrap(function()
            local ok, err = pcall(fn, ctx)
            if not ok then
                logger.err("BookOrbit: book sync step failed:", err)
                ctx.had_errors = true
                finish(ctx)
            end
        end)
    end)
end

local stepMatch, stepStats, stepAnnotations, stepAnnotationsLegacy, stepBookmarks, stepState, stepProgress

stepMatch = function(ctx)
    if ctx.acknowledged.match then
        return step(ctx, stepStats)
    end
    local book = ctx.state:getBook(ctx.snap.digest)
    if book and ctx.snap.file and not book.file then
        book.file = ctx.snap.file
    end

    if not ctx.force_match and BookOrbitState.isMatchFresh(book, ctx.state.global) then
        logger.dbg("BookOrbit: book sync match skipped, verified match still fresh")
        if not acknowledge(ctx, "match", false) then return end
        return step(ctx, stepStats)
    end

    local body, err = ctx.client:matchCheck({ ctx.snap.digest }, {
        [ctx.snap.digest] = {
            title = ctx.snap.title,
            authors = ctx.snap.authors,
            last_open = ctx.snap.last_open,
            source = "current_file",
            metadata_ambiguous = ctx.snap.metadata_ambiguous,
        },
    })
    if not body then
        if isAuthError(err) then return finish(ctx, "auth") end
        return finish(ctx, "network")
    end

    -- The token is applied before the match is stamped, so this book is
    -- verified against the version the response carried rather than the one it
    -- just invalidated.
    BookOrbitState.applyLibraryVersion(ctx.state, body.libraryVersion)

    for _, match in ipairs(body.matches or {}) do
        if match.hash == ctx.snap.digest then
            ctx.state:setMatched(match.hash, match.bookFileId, match.bookId, ctx.snap.file)
            if not acknowledge(ctx, "match") then return end
            return step(ctx, stepStats)
        end
    end

    ctx.state:setUnmatched(ctx.snap.digest)
    return finish(ctx, "unmatched")
end

stepStats = function(ctx)
    if ctx.acknowledged.stats then
        return step(ctx, stepAnnotations)
    end
    local book = ctx.state:getBook(ctx.snap.digest)
    if not book then return finish(ctx, "unmatched") end

    if ctx.snap.stats_metadata_ambiguous then
        if not acknowledge(ctx, "stats", false) then return end
        return step(ctx, stepAnnotations)
    end

    -- Snapshot ids are captured at close time; fall back to a live lookup when
    -- the stats row did not exist yet, so a deferred replay still uploads.
    if ctx.stat_ids == nil then
        local ids = ctx.snap.stats_ids
        if not ids or #ids == 0 then
            ids = BookOrbitStatsReader.getBookIds(ctx.snap.digest)
        end
        ctx.stat_ids = ids
    end
    if #ctx.stat_ids == 0 then
        if not acknowledge(ctx, "stats", false) then return end
        return step(ctx, stepAnnotations)
    end

    local watermark = book.statsWatermark or 0
    local events = BookOrbitStatsReader.getEventsAfter(ctx.stat_ids, watermark, STATS_BATCH)
    if not events or #events == 0 then
        if not acknowledge(ctx, "stats", false) then return end
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
    if not acknowledge(ctx, "stats") then return end
    return step(ctx, stepAnnotations)
end

-- Two-way exchange: uploads the local delta, reports the full key set for
-- deletion detection, applies server-side changes (live for the manual sync
-- while the book is open, sidecar on the close path) and acks them.
stepAnnotations = function(ctx)
    if ctx.acknowledged.annotations then
        return step(ctx, stepBookmarks)
    end
    local book = ctx.state:getBook(ctx.snap.digest)
    if not book then return finish(ctx, "unmatched") end

    local apply_mode = "skip"
    if ctx.annotation_sync then
        if (ctx.reason == "close" or ctx.reason == "suspend" or ctx.reason == "recovery")
                and ctx.snap.file and lfs.attributes(ctx.snap.file, "mode") == "file" then
            apply_mode = "sidecar"
        elseif ctx.reason == "manual" and ctx.plugin and ctx.plugin.ui and ctx.plugin.ui.document then
            apply_mode = "live"
        end
    elseif ctx.interactive then
        ctx.highlight_disabled_reported = true
        ctx.highlight_summary = BookOrbitHighlightSummary.add(ctx.highlight_summary, nil, { skipped = 1 })
    end

    -- Skipping the exchange also skips the complete-key deletion check and the
    -- only channel that delivers web-created highlights, so it needs an
    -- unchanged local set, nothing pending, a recent successful exchange, and
    -- a user who did not ask for this sync explicitly.
    local pending = ctx.remote_pending and ctx.remote_pending.annotations
    if not pending and not ctx.interactive
            and BookOrbitAnnotations.canSkipExchange(book, ctx.snap.ann_signature) then
        logger.dbg("BookOrbit: book sync annotation exchange skipped, local set unchanged")
        if not acknowledge(ctx, "annotations", false) then return end
        return step(ctx, stepBookmarks)
    end

    if pending and apply_mode == "sidecar" then
        local applied, deleted = BookOrbitAnnotations.applySidecar(ctx.snap.file, pending.to_apply or {})
        local ack_body, ack_err = ctx.client:exchangeAck({
            { hash = ctx.snap.digest, applied = applied, deleted = deleted },
        })
        if not ack_body then
            if isAuthError(ack_err) then return finish(ctx, "auth") end
            return finish(ctx, "network")
        end
        if ctx.on_remote_applied then
            local ok, cleared = pcall(ctx.on_remote_applied, "annotations")
            if not ok or cleared == false then return finish(ctx, "outbox") end
        end
        ctx.remote_pending.annotations = nil
    end

    local result, err = BookOrbitAnnotations.exchangeBook({
        client = ctx.client,
        state = ctx.state,
        digest = ctx.snap.digest,
        annotations = ctx.snap.annotations,
        ann_max_datetime = ctx.snap.ann_max_datetime,
        ann_signature = ctx.snap.ann_signature,
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
            ctx.highlight_unsupported = true
            ctx.highlight_summary = BookOrbitHighlightSummary.add(ctx.highlight_summary, nil, { skipped = 1 })
            return step(ctx, stepAnnotationsLegacy)
        end
        ctx.had_errors = true
        ctx.highlight_summary = BookOrbitHighlightSummary.add(ctx.highlight_summary, { had_errors = true })
        return step(ctx, stepBookmarks)
    end

    if result.had_errors then ctx.had_errors = true end
    ctx.counts.annotations = ctx.counts.annotations + result.uploaded
    ctx.counts.ann_applied = (ctx.counts.ann_applied or 0) + result.applied
    ctx.counts.ann_deleted = (ctx.counts.ann_deleted or 0) + result.deleted
    ctx.highlight_summary = BookOrbitHighlightSummary.add(ctx.highlight_summary, result, {
        closed_book = apply_mode == "sidecar",
    })
    if not result.had_errors then
        book.annCount = ctx.snap.ann_count
        -- Only park remote changes when the user actually wants them applied;
        -- with two-way highlights off there is nothing to come back for.
        if result.remote_pending and ctx.annotation_sync and ctx.on_remote_pending then
            local ok, recorded = pcall(ctx.on_remote_pending, "annotations", result.remote_pending)
            if not ok or recorded == false then
                ctx.had_errors = true
                return finish(ctx, "outbox")
            end
        elseif not acknowledge(ctx, "annotations") then
            return
        end
    end
    return step(ctx, stepBookmarks)
end

-- One-way upload for servers without the 0.4 exchange endpoint.
stepAnnotationsLegacy = function(ctx)
    local book = ctx.state:getBook(ctx.snap.digest)
    if not book then return finish(ctx, "unmatched") end

    if ctx.ann_delta == nil then
        ctx.ann_delta = {}
        ctx.ann_cursor = 1
        ctx.ann_failed = false
        local watermark = BookOrbitAnnotations.readWatermark(book, os.date("%Y-%m-%d %H:%M:%S"))
        for _, annotation in ipairs(ctx.snap.annotations) do
            local effective = annotation.datetimeUpdated or annotation.datetime
            if effective > watermark then
                table.insert(ctx.ann_delta, annotation)
            end
        end
    end

    if ctx.ann_cursor > #ctx.ann_delta then
        if not ctx.ann_failed then
            -- No exchange stamp here: the legacy endpoint never receives the
            -- key set, so a later sync must not skip the first real exchange.
            BookOrbitAnnotations.advanceWatermark(book, ctx.snap.ann_max_datetime, os.date("%Y-%m-%d %H:%M:%S"))
            book.annCount = ctx.snap.ann_count
            if not acknowledge(ctx, "annotations") then return end
        end
        return step(ctx, stepBookmarks)
    end

    -- Consumed through a head cursor: removing from the front of a Lua array
    -- shifts every remaining element, which turns a long delta into O(n^2).
    local chunk = {}
    while ctx.ann_cursor <= #ctx.ann_delta and #chunk < ANN_BATCH_TOTAL do
        table.insert(chunk, ctx.ann_delta[ctx.ann_cursor])
        ctx.ann_cursor = ctx.ann_cursor + 1
    end

    local body, err = ctx.client:uploadAnnotations({ { hash = ctx.snap.digest, annotations = chunk } })
    if not body then
        if isAuthError(err) then return finish(ctx, "auth") end
        ctx.had_errors = true
        ctx.ann_failed = true
        ctx.ann_cursor = #ctx.ann_delta + 1
        ctx.highlight_summary = BookOrbitHighlightSummary.add(ctx.highlight_summary, { had_errors = true })
        if isTransportError(err) then return finish(ctx, "network") end
        logger.dbg("BookOrbit: book sync annotations upload failed:", err)
        return step(ctx, stepBookmarks)
    end
    if isUnmatched(body, ctx.snap.digest) then
        ctx.state:setUnmatched(ctx.snap.digest)
        return finish(ctx, "unmatched")
    end

    ctx.counts.annotations = ctx.counts.annotations + #chunk
    ctx.highlight_summary = BookOrbitHighlightSummary.add(ctx.highlight_summary, { uploaded = #chunk })
    return step(ctx, stepAnnotationsLegacy)
end

-- Two-way dogear exchange. It shares the annotations phase acknowledgement, so
-- an outbox entry queued before bookmark sync existed still drains: only the
-- free-form remote_pending kind is new.
stepBookmarks = function(ctx)
    if not ctx.annotation_sync or not BookOrbitBookmarks.enabled(ctx.client, true) then
        return step(ctx, stepState)
    end
    local book = ctx.state:getBook(ctx.snap.digest)
    if not book then return finish(ctx, "unmatched") end

    local apply_mode = "skip"
    if (ctx.reason == "close" or ctx.reason == "suspend" or ctx.reason == "recovery")
            and ctx.snap.file and lfs.attributes(ctx.snap.file, "mode") == "file" then
        apply_mode = "sidecar"
    elseif ctx.reason == "manual" and ctx.plugin and ctx.plugin.ui and ctx.plugin.ui.document then
        apply_mode = "live"
    end

    local pending = ctx.remote_pending and ctx.remote_pending.bookmarks
    if not pending and not ctx.interactive
            and BookOrbitBookmarks.canSkipExchange(book, ctx.snap.bm_signature) then
        logger.dbg("BookOrbit: book sync bookmark exchange skipped, local set unchanged")
        return step(ctx, stepState)
    end

    if pending and apply_mode == "sidecar" then
        local applied, deleted = BookOrbitBookmarks.applySidecar(ctx.snap.file, pending.to_apply or {})
        local ack_body, ack_err = ctx.client:exchangeBookmarksAck({
            { hash = ctx.snap.digest, applied = applied, deleted = deleted },
        })
        if not ack_body then
            if isAuthError(ack_err) then return finish(ctx, "auth") end
            return finish(ctx, "network")
        end
        if ctx.on_remote_applied then
            local ok, cleared = pcall(ctx.on_remote_applied, "bookmarks")
            if not ok or cleared == false then return finish(ctx, "outbox") end
        end
        ctx.remote_pending.bookmarks = nil
    end

    local result, err = BookOrbitBookmarks.exchangeBook({
        client = ctx.client,
        state = ctx.state,
        digest = ctx.snap.digest,
        bookmarks = ctx.snap.bookmarks,
        bm_signature = ctx.snap.bm_signature,
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
            BookOrbitBookmarks.markUnsupported(ctx.client)
            return step(ctx, stepState)
        end
        ctx.had_errors = true
        ctx.highlight_summary = BookOrbitHighlightSummary.addBookmarks(ctx.highlight_summary, { had_errors = true })
        return step(ctx, stepState)
    end

    if result.had_errors then ctx.had_errors = true end
    ctx.counts.bookmarks = (ctx.counts.bookmarks or 0) + result.uploaded
    ctx.highlight_summary = BookOrbitHighlightSummary.addBookmarks(ctx.highlight_summary, result)
    if not result.had_errors and result.remote_pending and ctx.on_remote_pending then
        local ok, recorded = pcall(ctx.on_remote_pending, "bookmarks", result.remote_pending)
        if not ok or recorded == false then
            ctx.had_errors = true
            return finish(ctx, "outbox")
        end
    end
    return step(ctx, stepState)
end

stepState = function(ctx)
    if ctx.acknowledged.state then
        return step(ctx, stepProgress)
    end
    local book = ctx.state:getBook(ctx.snap.digest)
    if not book then return finish(ctx, "unmatched") end

    local pending_state = ctx.remote_pending and ctx.remote_pending.state
    if pending_state then
        if not ctx.snap.file or lfs.attributes(ctx.snap.file, "mode") ~= "file" then
            return step(ctx, stepProgress)
        end
        BookOrbitSidecar.applyServerStateSidecar(ctx.snap.file, pending_state)
        if ctx.on_remote_applied then
            local ok, cleared = pcall(ctx.on_remote_applied, "state")
            if not ok or cleared == false then return finish(ctx, "outbox") end
        end
        ctx.remote_pending.state = nil
        if not acknowledge(ctx, "state") then return end
        return step(ctx, stepProgress)
    end

    -- A forced pull is a request even when nothing changed locally, so it is
    -- reserved for a sync the user asked for and for the bounded refresh that
    -- keeps web-side ratings and reviews arriving.
    local force_pull = ctx.interactive or ctx.reason == "manual"
        or BookOrbitSidecar.needsStatePull(book)
    local payload = BookOrbitSidecar.buildStatePayload(ctx.snap.digest, book, {
        status = ctx.snap.status,
        status_modified = ctx.snap.status_modified,
        rating = ctx.snap.rating,
        review_note = ctx.snap.review_note,
    }, force_pull)
    if not payload then
        if not acknowledge(ctx, "state", false) then return end
        return step(ctx, stepProgress)
    end

    local body, err = ctx.client:uploadBookStates({ payload })
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
    book.statusSyncedModified = payload.statusModified or book.statusSyncedModified
    if force_pull then
        BookOrbitSidecar.markStatePulled(book)
    end
    local result = body.results and body.results[1] or nil
    local server_state = BookOrbitSidecar.stateFromServerResult(result)
    if server_state then
        if ctx.reason == "close" or ctx.reason == "suspend" or ctx.reason == "recovery" then
            if not ctx.snap.file or lfs.attributes(ctx.snap.file, "mode") ~= "file" then
                if ctx.on_remote_pending then
                    local ok, recorded = pcall(ctx.on_remote_pending, "state", server_state)
                    if not ok or recorded == false then
                        ctx.had_errors = true
                        return finish(ctx, "outbox")
                    end
                    return step(ctx, stepProgress)
                end
            else
                BookOrbitSidecar.applyServerStateSidecar(ctx.snap.file, server_state)
            end
        else
            BookOrbitSidecar.applyServerStateLive(ctx.plugin and ctx.plugin.ui or nil, server_state)
        end
        BookOrbitSidecar.rememberServerState(book, server_state)
    else
        BookOrbitSidecar.rememberUploadedState(book, {
            rating = ctx.snap.rating,
            review_note = ctx.snap.review_note,
        }, payload)
    end
    if not acknowledge(ctx, "state") then return end
    return step(ctx, stepProgress)
end

stepProgress = function(ctx)
    if ctx.acknowledged.progress then
        return finish(ctx)
    end
    local book = ctx.state:getBook(ctx.snap.digest)
    if not book then return finish(ctx, "unmatched") end

    if ctx.skip_progress then
        if not acknowledge(ctx, "progress", false) then return end
        return finish(ctx)
    end

    local pct = ctx.snap.percentage
    if type(pct) ~= "number" then
        if not acknowledge(ctx, "progress", false) then return end
        return finish(ctx)
    end
    local pushed = book.progressPushedPct or -1
    if math.abs(pct - pushed) <= 0.001 and not ctx.interactive then
        if not acknowledge(ctx, "progress", false) then return end
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
    if not acknowledge(ctx, "progress") then return end
    return finish(ctx)
end

function BookOrbitBookSync.run(opts)
    if BookOrbitBookSync.running or BookOrbitSweep.isRunning() then
        if opts.interactive then
            UIManager:show(InfoMessage:new{ text = _("BookOrbit sync is already running."), timeout = 2 })
        end
        return false
    end

    local snap = opts.snap
    if not snap then return false end

    local client = BookOrbitApi.new(opts.api)
    if not client:isConfigured() then
        if opts.interactive then
            UIManager:show(InfoMessage:new{ text = _("Please configure the BookOrbit server and login first."), timeout = 3 })
        end
        return false
    end

    BookOrbitBookSync.running = true

    local ctx = {
        client = client,
        state = BookOrbitStateManager.session({
            digests = { snap.digest },
            files = { snap.file },
        }),
        snap = snap,
        reason = opts.reason or "manual",
        origin = opts.origin,
        force_match = opts.force_match == true,
        interactive = opts.interactive or false,
        annotation_sync = opts.annotation_sync ~= false,
        plugin = opts.plugin,
        on_finish = opts.on_finish,
        counts = { page_stats = 0, annotations = 0, ann_applied = 0, ann_deleted = 0 },
        highlight_summary = BookOrbitHighlightSummary.normalize{
            event = "book_sync",
            reason = opts.reason or "manual",
        },
        had_errors = false,
        skip_progress = opts.skip_progress == true,
        on_phase_ack = opts.on_phase_ack,
        on_remote_pending = opts.on_remote_pending,
        on_remote_applied = opts.on_remote_applied,
        acknowledged = opts.acknowledged or {},
        remote_pending = opts.remote_pending or {},
    }

    ctx.state:rememberFile(snap.file, snap.digest)
    logger.dbg("BookOrbit: book sync started, reason:", ctx.reason)

    step(ctx, stepMatch)
    return true
end

return BookOrbitBookSync
