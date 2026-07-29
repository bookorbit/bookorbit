--[[--
Full-library sweep: pushes reading statistics, annotations, book states and
bulk progress for all matched books to BookOrbit. Manual-only; the open book
is covered day to day by the per-book snapshot sync.

The sweep is a module-level singleton driven by small steps chained through
UIManager:scheduleIn so the UI stays responsive. It holds no references to a
ReaderUI/FileManager plugin instance and therefore survives document close.
Per-book sync state advances only after the server acknowledges an upload, so
an interrupted sweep resumes exactly where it left off.

Library-sized phases are sliced: enumeration, ReadHistory resolution and
sidecar extraction run in bounded chunks with a per-callback time budget, each
over a snapshot of its keys that is re-resolved when its chunk actually runs.
Every run carries a generation token, and every scheduled callback verifies it
before touching shared state, which is what makes cancellation safe.
]]

local ButtonDialog = require("ui/widget/buttondialog")
local DocSettings = require("docsettings")
local InfoMessage = require("ui/widget/infomessage")
local Notification = require("ui/widget/notification")
local ReadHistory = require("readhistory")
local UIManager = require("ui/uimanager")
local Trapper = require("ui/trapper")
local ffiutil = require("ffi/util")
local logger = require("logger")
local lfs = require("libs/libkoreader-lfs")
local util = require("util")
local T = ffiutil.template
local _ = require("gettext")

local BookOrbitAnnotations = require("bookorbit_annotations")
local BookOrbitBookmarks = require("bookorbit_bookmarks")
local BookOrbitApi = require("bookorbit_api")
local BookOrbitHighlightSummary = require("bookorbit_highlight_summary")
local BookOrbitQueue = require("bookorbit_queue")
local BookOrbitSidecar = require("bookorbit_sidecar")
local BookOrbitState = require("bookorbit_state")
local BookOrbitStateManager = require("bookorbit_state_manager")
local BookOrbitStatsReader = require("bookorbit_stats_reader")

-- The per-callback time budget is what protects responsiveness, so steps chain
-- with a minimal delay. A fixed sleep between short slices would leave a large
-- sweep idle for most of its wall time.
local STEP_DELAY = 0
-- Only paid after the progress display actually repainted, so e-ink has a
-- moment to settle before the next slice starts.
local REPAINT_DELAY = 0.1
local CHUNK_BUDGET_MS = 20
local CHUNK_ITEMS = 40
-- Sidecar extraction opens a file per book, so it yields more often.
local SIDECAR_CHUNK_ITEMS = 20
local ENUM_PAGE = 50
local MATCH_BATCH = 500
local STATS_BATCH = 500
local ANN_BATCH_BOOKS = 20
local ANN_BATCH_TOTAL = 50
local STATES_BATCH = 200
local PROGRESS_BATCH = 100
local PROGRESS_THROTTLE = 2

local BookOrbitSweep = {
    running = false,
}

local active_ctx
local run_generation = 0

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

local function titleFromHistoryItem(item)
    local name = item.text
    if (not name or name == "") and item.file then
        name = item.file:gsub(".*/", "")
    end
    if not name or name == "" then return nil end
    local title = name:gsub("%.[^%.]+$", "")
    if title == "" then return name end
    return title
end

function BookOrbitSweep.isRunning()
    return BookOrbitSweep.running
end

function BookOrbitSweep.syncStatus()
    return BookOrbitStateManager.summary()
end

local function isAuthError(err)
    return err == 401 or err == 403
end

-- A run only owns shared state while it is the current generation. Anything
-- scheduled by a cancelled or superseded run stops here instead of writing.
local function aborted(ctx)
    return ctx.finished or ctx.cancelled or ctx.generation ~= run_generation
end

local function closeStatsSession(ctx)
    if ctx.stats_session then
        ctx.stats_session:close()
        ctx.stats_session = nil
    end
end

local function closeProgress(ctx)
    if ctx.progress_dialog then
        UIManager:close(ctx.progress_dialog)
        ctx.progress_dialog = nil
    end
end

-- Interactive-only progress display, reused across phases. Identical text never
-- redraws, and changing text redraws at most every PROGRESS_THROTTLE seconds,
-- so a long first run stays legible without flooding the e-ink screen. The
-- dialog carries the cancel affordance and is not tap-dismissable, so a stray
-- tap cannot silently drop the only way to stop the run.
local function setProgress(ctx, text, force)
    if not ctx.interactive then return end
    if not force then
        if text == ctx.progress_shown_text then return end
        if ctx.progress_dialog and os.time() - (ctx.progress_shown_at or 0) < PROGRESS_THROTTLE then
            return
        end
    end
    ctx.progress_shown_text = text
    ctx.progress_shown_at = os.time()
    ctx.progress_repainted = true

    if ctx.progress_dialog then
        ctx.progress_dialog:setTitle(text)
        return
    end
    ctx.progress_dialog = ButtonDialog:new{
        title = text,
        title_align = "center",
        dismissable = false,
        buttons = {
            {
                {
                    text = _("Cancel"),
                    callback = function()
                        BookOrbitSweep.cancel("user")
                    end,
                },
            },
        },
    }
    UIManager:show(ctx.progress_dialog)
end

local function chunkSummary(ctx)
    return string.format(
        "enumerateMs=%.0f partialMd5Ms=%.0f partialMd5Count=%d sidecarMs=%.0f slowestItemMs=%.0f statsSkipped=%d",
        ctx.timing.enumerate_ms, ctx.timing.partial_md5_ms, ctx.timing.partial_md5_count,
        ctx.timing.sidecar_ms, ctx.timing.max_item_ms, ctx.counts.stats_skipped or 0)
end

local function finish(ctx, err)
    if ctx.finished then return end
    ctx.finished = true
    BookOrbitSweep.running = false
    if active_ctx == ctx then active_ctx = nil end
    closeStatsSession(ctx)
    closeProgress(ctx)

    -- A failing flush must not re-enter finish through the caller's error
    -- handler; the counts below still describe what the server accepted.
    local flushed, flush_err = pcall(ctx.state.flush, ctx.state)
    if not flushed then
        logger.err("BookOrbit: sweep state flush failed:", flush_err)
        ctx.had_errors = true
    end

    if err == "cancelled" then
        if ctx.interactive then
            UIManager:show(InfoMessage:new{ text = _("BookOrbit sync cancelled."), timeout = 3 })
        end
        logger.info(string.format(
            "BookOrbit: sweep cancelled reason=%s matched=%d pageStats=%d annotations=%d %s",
            tostring(ctx.cancel_reason or "user"), ctx.counts.books_matched, ctx.counts.page_stats,
            ctx.counts.annotations, chunkSummary(ctx)))
        if ctx.on_finish then
            pcall(ctx.on_finish, err)
        end
        return
    end

    if ctx.plugin and ctx.plugin.recordSyncError then
        if err == "auth" or err == "network" then
            ctx.plugin:recordSyncError("sweep", err)
        elseif not err and ctx.had_errors then
            ctx.plugin:recordSyncError("sweep", "partial_failure")
        elseif not err and ctx.plugin.recordSyncSuccess then
            ctx.plugin:recordSyncSuccess(
                "sweep",
                T(_("%1 books, %2 reading events, %3 highlights"),
                    ctx.counts.books_matched, ctx.counts.page_stats, ctx.counts.annotations))
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
        if ctx.on_finish then
            pcall(ctx.on_finish, err)
        end
        return
    end

    if err == "network" then
        if ctx.interactive then
            UIManager:show(InfoMessage:new{ text = _("BookOrbit sync: server not reachable."), timeout = 4 })
        end
        logger.dbg("BookOrbit: sweep aborted, server not reachable")
        if ctx.on_finish then
            pcall(ctx.on_finish, err)
        end
        return
    end

    if ctx.interactive then
        local text = T(_("BookOrbit sync done: %1 books matched, %2 reading events, %3 highlights."),
            ctx.counts.books_matched, ctx.counts.page_stats, ctx.counts.annotations)
        if ctx.highlight_summary and BookOrbitHighlightSummary.hasRemoteChanges(ctx.highlight_summary) then
            text = text .. "\n" .. T(_("Highlights updated: %1 applied, %2 deleted, %3 closed book(s)."),
                ctx.highlight_summary.applied, ctx.highlight_summary.deleted, ctx.highlight_summary.touched_books)
        end
        if ctx.highlight_unsupported then
            text = text .. "\n" .. _("BookOrbit server needs an update for two-way highlights.")
        end
        if ctx.highlight_disabled_reported then
            text = text .. "\n" .. _("Two-way highlight and bookmark sync is disabled.")
        end
        if ctx.had_errors then
            text = text .. "\n" .. _("Some books failed and will retry on the next sync.")
        end
        UIManager:show(InfoMessage:new{ text = text, timeout = 5 })
    end
    logger.info(string.format(
        "BookOrbit: sweep done matched=%d pageStats=%d annotations=%d applied=%d deleted=%d %s errors=%s",
        ctx.counts.books_matched, ctx.counts.page_stats, ctx.counts.annotations,
        ctx.counts.ann_applied or 0, ctx.counts.ann_deleted or 0, chunkSummary(ctx),
        tostring(ctx.had_errors)))
    if ctx.on_finish then
        pcall(ctx.on_finish, err)
    end
end

-- Stops the active run at its next yield. No rollback is needed: per-book sync
-- state advances only after the server acknowledged an upload, so a cancelled
-- run just stops scheduling, releases the statistics session and reports
-- itself as cancelled rather than failed.
function BookOrbitSweep.cancel(reason)
    local ctx = active_ctx
    if not ctx or ctx.finished then return false end
    ctx.cancelled = true
    ctx.cancel_reason = reason or "user"
    -- Bumping the generation is what disowns callbacks that are already
    -- scheduled and results that arrive from work still in flight.
    run_generation = run_generation + 1
    finish(ctx, "cancelled")
    return true
end

local function nextDelay(ctx)
    if ctx.progress_repainted then
        ctx.progress_repainted = false
        return REPAINT_DELAY
    end
    return STEP_DELAY
end

local function guardedRun(ctx, fn)
    if aborted(ctx) then return end
    local ok, err = pcall(fn, ctx)
    if not ok then
        logger.err("BookOrbit: sweep step failed:", err)
        ctx.had_errors = true
        finish(ctx)
    end
end

-- Phase transition that may issue requests, so it runs inside Trapper.
local function step(ctx, fn)
    UIManager:scheduleIn(nextDelay(ctx), function()
        Trapper:wrap(function()
            guardedRun(ctx, fn)
        end)
    end)
end

-- Continuation of a CPU or filesystem slice. No request can originate here, so
-- it skips the Trapper coroutine.
local function chunk(ctx, fn)
    UIManager:scheduleIn(nextDelay(ctx), function()
        guardedRun(ctx, fn)
    end)
end

--[[--
Drives `handler` over a snapshot of keys, yielding after CHUNK_ITEMS items or
CHUNK_BUDGET_MS of work, whichever comes first.

Keys are snapshotted at phase start and re-resolved when their chunk runs: once
a phase yields the user can open a book, which reorders ReadHistory and mutates
plugin state, so index-based iteration over a live list would skip or
double-process entries. Handlers tolerate a key that no longer resolves;
activity that appears mid-sweep belongs to the next run.

A time check after an item cannot preempt that item's filesystem calls, so the
slowest single item is recorded separately rather than assumed to be bounded.
]]
local function forEachChunk(ctx, keys, handler, opts, on_complete)
    opts = opts or {}
    local limit = opts.items or CHUNK_ITEMS
    local total = #keys
    local index = 1

    local function pump()
        if opts.on_chunk_start then opts.on_chunk_start(ctx) end
        local started = nowMs()
        local processed = 0
        while index <= total do
            local item_started = nowMs()
            handler(ctx, keys[index], index)
            local item_ms = elapsedMs(item_started)
            if item_ms > ctx.timing.max_item_ms then ctx.timing.max_item_ms = item_ms end
            index = index + 1
            processed = processed + 1
            if processed >= limit or elapsedMs(started) >= CHUNK_BUDGET_MS then break end
        end
        if opts.elapsed_key then
            ctx.timing[opts.elapsed_key] = ctx.timing[opts.elapsed_key] + elapsedMs(started)
        end
        if index > total then
            return on_complete()
        end
        if opts.progress then opts.progress(ctx, index - 1, total) end
        chunk(ctx, pump)
    end

    pump()
end

-- Phase 1a: enumerate candidate books from the statistics database (primary
-- source, has md5 directly). Keyset pagination keeps each page's query cheap
-- and lets input run between pages of a 10,000-book library.
local function stepEnumerateStats(ctx)
    ctx.candidates = {}
    ctx.collector = BookOrbitStatsReader.newBookCollector()

    if not ctx.stats_session then
        return step(ctx, ctx.steps.enumerateCandidates)
    end

    local after_id = 0
    local rows_read = 0

    local function pump()
        local started = nowMs()
        local rows, last_id = ctx.stats_session:bookRowsAfter(after_id, ENUM_PAGE)
        for _, row in ipairs(rows) do
            BookOrbitStatsReader.collectBookRow(ctx.collector, row)
        end
        ctx.timing.enumerate_ms = ctx.timing.enumerate_ms + elapsedMs(started)
        rows_read = rows_read + #rows
        after_id = last_id

        if #rows < ENUM_PAGE then
            return step(ctx, ctx.steps.enumerateCandidates)
        end
        setProgress(ctx, T(_("BookOrbit sync: reading local library (%1)"), rows_read))
        chunk(ctx, pump)
    end

    pump()
end

-- Phase 1b: turn the collected statistics rows into candidates. Grouping is
-- only complete once every page landed, so ambiguity is resolved here.
local function stepEnumerateCandidates(ctx)
    local entries = BookOrbitStatsReader.collectedEntries(ctx.collector)

    local function convert(chunk_ctx, entry)
        BookOrbitStatsReader.finalizeBookEntry(entry)
        chunk_ctx.candidates[entry.md5] = {
            stat_ids = entry.ids,
            last_open = entry.last_open,
            title = entry.title,
            authors = entry.authors,
            source = "statistics",
            metadata_ambiguous = entry.metadata_ambiguous,
            stats_metadata_ambiguous = entry.metadata_ambiguous,
        }
    end

    forEachChunk(ctx, entries, convert, { items = 200, elapsed_key = "enumerate_ms" }, function()
        ctx.collector = nil
        step(ctx, ctx.steps.enumerateHistory)
    end)
end

-- Phase 1c: resolve ReadHistory entries, which contribute file paths for
-- sidecar data. Uncached digests are sampled here, which is the one part of
-- enumeration that touches book files.
local function historyEntry(ctx, file)
    local item = ctx.history_lookup[file]
    if not item then return end

    local file_exists = lfs.attributes(file, "mode") == "file"
    local md5 = ctx.state.files[file]
    if not md5 and file_exists and DocSettings:hasSidecarFile(file) then
        local doc_settings = DocSettings:open(file)
        md5 = doc_settings:readSetting("partial_md5_checksum")
        if not md5 then
            local started = nowMs()
            local ok, computed = pcall(util.partialMD5, file)
            ctx.timing.partial_md5_ms = ctx.timing.partial_md5_ms + elapsedMs(started)
            ctx.timing.partial_md5_count = ctx.timing.partial_md5_count + 1
            if ok then md5 = computed end
        end
        ctx.state:rememberFile(file, md5)
    end
    if not md5 then return end

    local cand = ctx.candidates[md5] or {}
    if file_exists then
        cand.file = file
        cand.source = "file"
        if cand.metadata_ambiguous then
            cand.title = titleFromHistoryItem(item)
            cand.authors = nil
        elseif not cand.title then
            cand.title = titleFromHistoryItem(item)
        end
        cand.metadata_ambiguous = false
    end
    if (item.time or 0) > (cand.last_open or 0) then
        cand.last_open = item.time
    end
    ctx.candidates[md5] = cand
    local book = ctx.state:getBook(md5)
    if book and file_exists and not book.file then
        book.file = file
    end
end

-- Opening a book reorders ReadHistory, so the live list is re-indexed by file
-- at the start of every chunk rather than trusted across a yield.
local function rebuildHistoryLookup(ctx)
    local lookup = {}
    for _, item in ipairs(ReadHistory.hist or {}) do
        if item.file then lookup[item.file] = item end
    end
    ctx.history_lookup = lookup
end

local function stepEnumerateHistory(ctx)
    local files = {}
    for _, item in ipairs(ReadHistory.hist or {}) do
        if item.file then table.insert(files, item.file) end
    end

    forEachChunk(ctx, files, historyEntry, {
        on_chunk_start = rebuildHistoryLookup,
        elapsed_key = "enumerate_ms",
    }, function()
        ctx.history_lookup = nil
        step(ctx, ctx.steps.match)
    end)
end

-- Phase 2: ask the server which hashes it knows. A normal run checks only what
-- it cannot answer locally: never-seen hashes, unmatched hashes with new
-- activity, and matched books whose freshness stamp is missing or expired.
-- A full recheck rechecks every known hash instead.
local function stepMatch(ctx)
    local to_check = {}
    local queued = {}
    local now = os.time()
    local function queue(md5)
        if not queued[md5] then
            queued[md5] = true
            table.insert(to_check, md5)
        end
    end

    for md5, cand in pairs(ctx.candidates) do
        if ctx.full_recheck then
            queue(md5)
        else
            local book = ctx.state:getBook(md5)
            if not book then
                local last_check = ctx.state.unmatched[md5]
                if not last_check or (cand.last_open or 0) > last_check then
                    queue(md5)
                end
            elseif not BookOrbitState.isMatchFresh(book, ctx.state.global, now) then
                -- The batched refresh path for stale stamps. Per-book syncs
                -- rely on it, which is why an expired stamp has to land in a
                -- normal sweep and not only in an explicit recheck.
                queue(md5)
            end
        end
    end

    if ctx.full_recheck then
        for md5 in pairs(ctx.state.books) do
            queue(md5)
        end
        for md5 in pairs(ctx.state.unmatched) do
            queue(md5)
        end
    else
        -- A matched book can outlive both its statistics row and its history
        -- entry, so its stamp still expires with no candidate to carry it.
        for md5, book in pairs(ctx.state.books) do
            if not ctx.candidates[md5] and not BookOrbitState.isMatchFresh(book, ctx.state.global, now) then
                queue(md5)
            end
        end
    end

    ctx.match_queue = BookOrbitQueue.new()
    for i = 1, #to_check, MATCH_BATCH do
        local batch = {}
        for j = i, math.min(i + MATCH_BATCH - 1, #to_check) do
            table.insert(batch, to_check[j])
        end
        ctx.match_queue:push(batch)
    end

    step(ctx, ctx.steps.matchNext)
end

local function hasNewEvents(latest, ids, watermark)
    for _, id in ipairs(ids) do
        if (latest[id] or 0) > watermark then return true end
    end
    return false
end

local function buildStatsQueue(ctx)
    -- One grouped query answers "does this book have anything after its
    -- watermark" for the whole library, so unchanged books cost no per-book
    -- event query at all. A failed query returns nil and everything is queued.
    local latest = ctx.stats_session and ctx.stats_session:latestEventTimes() or nil
    ctx.stats_queue = BookOrbitQueue.new()
    ctx.counts.stats_skipped = 0

    for md5, cand in pairs(ctx.candidates) do
        if cand.stat_ids and not cand.stats_metadata_ambiguous then
            local book = ctx.state:getBook(md5)
            if book then
                if latest and not hasNewEvents(latest, cand.stat_ids, book.statsWatermark or 0) then
                    ctx.counts.stats_skipped = ctx.counts.stats_skipped + 1
                else
                    ctx.stats_queue:push({ md5 = md5, ids = cand.stat_ids })
                end
            end
        end
    end
end

local function stepMatchNext(ctx)
    local batch = ctx.match_queue:pop()
    if not batch then
        for md5 in pairs(ctx.candidates) do
            if ctx.state:getBook(md5) then
                ctx.counts.books_matched = ctx.counts.books_matched + 1
            end
        end
        ctx.state:flush()
        buildStatsQueue(ctx)
        step(ctx, ctx.steps.statsNext)
        return
    end

    setProgress(ctx, _("BookOrbit sync: matching books..."))
    local body, err = ctx.client:matchCheck(batch, ctx.candidates)
    if aborted(ctx) then return end
    if not body then
        if isAuthError(err) then return finish(ctx, "auth") end
        return finish(ctx, "network")
    end

    local matched = {}
    for _, match in ipairs(body.matches or {}) do
        matched[match.hash] = true
        local cand = ctx.candidates[match.hash]
        -- Stamped against the token this response carried, not the one still
        -- stored, so these books stay on the fast path after the sweep records
        -- a changed library version.
        ctx.state:setMatched(match.hash, match.bookFileId, match.bookId,
            cand and cand.file or nil, body.libraryVersion)
    end
    for _, md5 in ipairs(batch) do
        if not matched[md5] then
            ctx.state:setUnmatched(md5)
        end
    end
    if body.libraryVersion then
        ctx.server_library_version = body.libraryVersion
    end

    step(ctx, ctx.steps.matchNext)
end

-- Phase 3: upload page stat events per matched book, batched and watermarked.
local function stepStatsNext(ctx)
    local item = ctx.current_stats or ctx.stats_queue:pop()
    ctx.current_stats = nil
    if not item then
        step(ctx, ctx.steps.sidecars)
        return
    end

    local total = ctx.stats_queue:total()
    if total > 0 then
        setProgress(ctx, T(_("BookOrbit sync: uploading reading data (%1/%2)"),
            ctx.stats_queue:done(), total))
    end

    local book = ctx.state:getBook(item.md5)
    if not book then
        step(ctx, ctx.steps.statsNext)
        return
    end

    local watermark = book.statsWatermark or 0
    local events = ctx.stats_session
        and ctx.stats_session:eventsAfter(item.ids, watermark, STATS_BATCH)
        or BookOrbitStatsReader.getEventsAfter(item.ids, watermark, STATS_BATCH)
    if not events or #events == 0 then
        step(ctx, ctx.steps.statsNext)
        return
    end

    local body, err = ctx.client:uploadPageStats({ { hash = item.md5, events = events } })
    if aborted(ctx) then return end
    if not body then
        if isAuthError(err) then return finish(ctx, "auth") end
        logger.dbg("BookOrbit: page stats upload failed for", item.md5, err)
        ctx.had_errors = true
        step(ctx, ctx.steps.statsNext)
        return
    end

    for _, unmatched in ipairs(body.unmatched or {}) do
        if unmatched == item.md5 then
            ctx.state:setUnmatched(item.md5)
            step(ctx, ctx.steps.statsNext)
            return
        end
    end

    local more = BookOrbitState.applyStatsAck(book, events, body, item.md5, STATS_BATCH, watermark)
    ctx.counts.page_stats = ctx.counts.page_stats + #events
    if more then
        ctx.current_stats = item
    end

    step(ctx, ctx.steps.statsNext)
end

-- Phase 4: read sidecars of matched books with known paths, mtime-gated, and
-- queue annotation/state/progress deltas. Each book opens a sidecar file, so
-- this runs in small chunks over a snapshot of the matched digests.
local function sidecarEntry(ctx, md5)
    local book = ctx.state:getBook(md5)
    if not book or not book.file then return end

    local mtime = BookOrbitSidecar.sidecarMtime(book.file)
    if not mtime then return end

    local sidecar_changed = mtime ~= book.sidecarMtime
    local state_unknown = book.ratingSyncedKnown ~= true or book.reviewSyncedKnown ~= true
    local extract = nil
    if sidecar_changed or state_unknown then
        extract = BookOrbitSidecar.extract(book.file)
    end

    if not extract then
        if not sidecar_changed then
            local state_payload = { hash = md5 }
            ctx.pending_books[md5] = {
                md5 = md5,
                mtime = mtime,
                ann_count = book.annCount or 0,
                ann_done = true,
                failed = false,
                need_state = true,
                need_progress = false,
                state_payload = state_payload,
                state_summary = {},
            }
            ctx.states_items:push(state_payload)
        end
        return
    end

    local pending = {
        md5 = md5,
        mtime = mtime,
        ann_count = sidecar_changed and extract.annotations_count or (book.annCount or 0),
        ann_max_datetime = sidecar_changed and extract.annotations_max_datetime or nil,
        ann_signature = sidecar_changed and extract.annotations_signature or nil,
        ann_done = not sidecar_changed,
        failed = false,
        need_state = false,
        need_progress = false,
    }

    if sidecar_changed then
        -- Every changed sidecar goes through the exchange, even with no new
        -- local highlights: the full key set is what lets the server detect
        -- on-device deletions.
        ctx.ann_queue:push({
            md5 = md5,
            file = book.file,
            annotations = extract.annotations,
            ann_max_datetime = extract.annotations_max_datetime,
            ann_signature = extract.annotations_signature,
            bookmarks = extract.bookmarks,
            bm_signature = extract.bookmarks_signature,
        })
    end

    local state_payload = BookOrbitSidecar.buildStatePayload(md5, book, {
        status = extract.status,
        status_modified = extract.status_modified,
        rating = extract.rating,
        review_note = extract.review_note,
    }, true)
    if state_payload then
        pending.need_state = true
        pending.status_modified = state_payload.statusModified
        pending.state_payload = state_payload
        pending.state_summary = {
            rating = extract.rating,
            review_note = extract.review_note,
        }
        ctx.states_items:push(state_payload)
    end

    if sidecar_changed and extract.percent_finished then
        local pushed = book.progressPushedPct or -1
        if math.abs(extract.percent_finished - pushed) > 0.001 then
            pending.need_progress = true
            pending.percentage = extract.percent_finished
            local cand = ctx.candidates[md5]
            ctx.progress_items:push({
                hash = md5,
                percentage = extract.percent_finished,
                progress = extract.last_position,
                timestamp = cand and cand.last_open or nil,
            })
        end
    end

    ctx.pending_books[md5] = pending
end

local function stepSidecars(ctx)
    ctx.pending_books = {}
    ctx.ann_queue = BookOrbitQueue.new()
    ctx.ann_chunks = BookOrbitQueue.new()
    ctx.states_items = BookOrbitQueue.new()
    ctx.progress_items = BookOrbitQueue.new()

    local digests = {}
    for md5 in pairs(ctx.state.books) do
        table.insert(digests, md5)
    end

    forEachChunk(ctx, digests, sidecarEntry, {
        items = SIDECAR_CHUNK_ITEMS,
        elapsed_key = "sidecar_ms",
        progress = function(progress_ctx, done, total)
            setProgress(progress_ctx, T(_("BookOrbit sync: checking books (%1/%2)"), done, total))
        end,
    }, function()
        step(ctx, ctx.steps.annotationsNext)
    end)
end

local buildLegacyAnnotationChunks

local function currentlyOpenFile()
    local ok, ReaderUI = pcall(require, "apps/reader/readerui")
    if ok and ReaderUI and ReaderUI.instance and ReaderUI.instance.document then
        return ReaderUI.instance.document.file
    end
end

-- Dogears share the sidecar and the apply mode with highlights, so the sweep
-- exchanges both for the same book in one pass. A server without the route is
-- recorded once and skipped for the rest of the run.
local function exchangeBookmarksForEntry(ctx, entry, apply_mode, pending)
    if not ctx.annotation_sync or ctx.bookmarks_unsupported then return end
    if not BookOrbitBookmarks.enabled(ctx.client, true) then
        ctx.bookmarks_unsupported = true
        return
    end
    local book = ctx.state:getBook(entry.md5)
    if not book then return end
    if not ctx.interactive and BookOrbitBookmarks.canSkipExchange(book, entry.bm_signature) then return end

    local result, err = BookOrbitBookmarks.exchangeBook({
        client = ctx.client,
        state = ctx.state,
        digest = entry.md5,
        bookmarks = entry.bookmarks,
        bm_signature = entry.bm_signature,
        apply_mode = apply_mode,
        file = entry.file,
    })
    if not result then
        if err == "unsupported_server" then
            BookOrbitBookmarks.markUnsupported(ctx.client)
            ctx.bookmarks_unsupported = true
            return
        end
        ctx.had_errors = true
        if pending then pending.failed = true end
        ctx.highlight_summary = BookOrbitHighlightSummary.addBookmarks(ctx.highlight_summary, { had_errors = true })
        logger.dbg("BookOrbit: bookmark exchange failed for", entry.md5, err)
        return
    end
    if result.had_errors then
        ctx.had_errors = true
        if pending then pending.failed = true end
    end
    ctx.counts.bookmarks = (ctx.counts.bookmarks or 0) + result.uploaded
    ctx.highlight_summary = BookOrbitHighlightSummary.addBookmarks(ctx.highlight_summary, result)
end

-- Phase 5: per-book annotation exchange. Uploads the local delta, reports the
-- key set for deletion detection and applies server-side changes into the
-- sidecar of closed books. Falls back to the legacy one-way upload when the
-- server has no exchange endpoint.
local function stepAnnotationsNext(ctx)
    if ctx.use_legacy_annotations then
        return step(ctx, ctx.steps.annotationsLegacyNext)
    end
    local entry = ctx.ann_queue:pop()
    if not entry then
        step(ctx, ctx.steps.statesNext)
        return
    end

    local total = ctx.ann_queue:total()
    if total > 0 then
        setProgress(ctx, T(_("BookOrbit sync: syncing highlights (%1/%2)"),
            ctx.ann_queue:done(), total))
    end

    local pending = ctx.pending_books[entry.md5]
    local apply_mode = "skip"
    if ctx.annotation_sync and entry.file ~= currentlyOpenFile() then
        apply_mode = "sidecar"
    elseif not ctx.annotation_sync and ctx.interactive and not ctx.highlight_disabled_reported then
        ctx.highlight_disabled_reported = true
        ctx.highlight_summary = BookOrbitHighlightSummary.add(ctx.highlight_summary, nil, { skipped = 1 })
    end

    local result, err = BookOrbitAnnotations.exchangeBook({
        client = ctx.client,
        state = ctx.state,
        digest = entry.md5,
        annotations = entry.annotations,
        ann_max_datetime = entry.ann_max_datetime,
        ann_signature = entry.ann_signature,
        apply_mode = apply_mode,
        file = entry.file,
    })
    if aborted(ctx) then return end
    if not result then
        if isAuthError(err) or err == "auth" then return finish(ctx, "auth") end
        if err == "unsupported_server" then
            -- Re-queue everything, including this entry, for the legacy path.
            ctx.ann_queue:requeue(entry)
            ctx.use_legacy_annotations = true
            ctx.highlight_unsupported = true
            ctx.highlight_summary = BookOrbitHighlightSummary.add(ctx.highlight_summary, nil, { skipped = 1 })
            buildLegacyAnnotationChunks(ctx)
            return step(ctx, ctx.steps.annotationsLegacyNext)
        end
        ctx.had_errors = true
        if pending then pending.failed = true end
        ctx.highlight_summary = BookOrbitHighlightSummary.add(ctx.highlight_summary, { had_errors = true })
        logger.dbg("BookOrbit: annotation exchange failed for", entry.md5, err)
        return step(ctx, ctx.steps.annotationsNext)
    end

    if result.had_errors then
        ctx.had_errors = true
        if pending then pending.failed = true end
    elseif pending then
        pending.ann_done = true
    end
    ctx.counts.annotations = ctx.counts.annotations + result.uploaded
    ctx.counts.ann_applied = (ctx.counts.ann_applied or 0) + result.applied
    ctx.counts.ann_deleted = (ctx.counts.ann_deleted or 0) + result.deleted
    ctx.highlight_summary = BookOrbitHighlightSummary.add(ctx.highlight_summary, result, {
        closed_book = apply_mode == "sidecar",
    })

    exchangeBookmarksForEntry(ctx, entry, apply_mode, pending)
    if aborted(ctx) then return end
    return step(ctx, ctx.steps.annotationsNext)
end

-- Legacy phase 5: one-way chunk upload, packing several books per request
-- while respecting both the per-request book and annotation caps. It walks the
-- queue from the head, because index 1 is a consumed slot by this point.
buildLegacyAnnotationChunks = function(ctx)
    local device_now = os.date("%Y-%m-%d %H:%M:%S")
    for entry in ctx.ann_queue:iter() do
        local book = ctx.state:getBook(entry.md5)
        local ann_watermark = book and BookOrbitAnnotations.readWatermark(book, device_now) or ""
        local delta = {}
        for _, annotation in ipairs(entry.annotations) do
            local effective = annotation.datetimeUpdated or annotation.datetime
            if effective > ann_watermark then
                table.insert(delta, annotation)
            end
        end
        local pending = ctx.pending_books[entry.md5]
        if pending then pending.ann_chunks_left = 0 end
        for i = 1, #delta, ANN_BATCH_TOTAL do
            local chunk_annotations = {}
            for j = i, math.min(i + ANN_BATCH_TOTAL - 1, #delta) do
                table.insert(chunk_annotations, delta[j])
            end
            ctx.ann_chunks:push({ md5 = entry.md5, annotations = chunk_annotations })
            if pending then pending.ann_chunks_left = pending.ann_chunks_left + 1 end
        end
    end
    ctx.ann_queue:clear()
end

local function stepAnnotationsLegacyNext(ctx)
    if ctx.ann_chunks:isEmpty() then
        step(ctx, ctx.steps.statesNext)
        return
    end

    local books = {}
    local total = 0
    while not ctx.ann_chunks:isEmpty() and #books < ANN_BATCH_BOOKS do
        local next_chunk = ctx.ann_chunks:peek()
        if total + #next_chunk.annotations > ANN_BATCH_TOTAL then break end
        ctx.ann_chunks:pop()
        table.insert(books, { hash = next_chunk.md5, annotations = next_chunk.annotations })
        total = total + #next_chunk.annotations
    end

    local body, err = ctx.client:uploadAnnotations(books)
    if aborted(ctx) then return end
    if not body then
        if isAuthError(err) then return finish(ctx, "auth") end
        logger.dbg("BookOrbit: annotations upload failed:", err)
        ctx.had_errors = true
        ctx.highlight_summary = BookOrbitHighlightSummary.add(ctx.highlight_summary, { had_errors = true })
        for _, book in ipairs(books) do
            local pending = ctx.pending_books[book.hash]
            if pending then pending.failed = true end
        end
        step(ctx, ctx.steps.annotationsLegacyNext)
        return
    end

    local unmatched = {}
    for _, hash in ipairs(body.unmatched or {}) do
        unmatched[hash] = true
    end

    for _, book in ipairs(books) do
        local pending = ctx.pending_books[book.hash]
        if unmatched[book.hash] then
            ctx.state:setUnmatched(book.hash)
            if pending then pending.failed = true end
        elseif pending then
            pending.ann_chunks_left = pending.ann_chunks_left - 1
            ctx.counts.annotations = ctx.counts.annotations + #book.annotations
            ctx.highlight_summary = BookOrbitHighlightSummary.add(ctx.highlight_summary, {
                uploaded = #book.annotations,
            })
        end
    end

    step(ctx, ctx.steps.annotationsLegacyNext)
end

-- Phase 6: book status + rating, batched.
local function stepStatesNext(ctx)
    if ctx.states_items:isEmpty() then
        step(ctx, ctx.steps.progressNext)
        return
    end

    local batch = {}
    while #batch < STATES_BATCH do
        local item = ctx.states_items:pop()
        if not item then break end
        table.insert(batch, item)
    end

    local body, err = ctx.client:uploadBookStates(batch)
    if aborted(ctx) then return end
    if not body then
        if isAuthError(err) then return finish(ctx, "auth") end
        logger.dbg("BookOrbit: book states upload failed:", err)
        ctx.had_errors = true
        for _, item in ipairs(batch) do
            local pending = ctx.pending_books[item.hash]
            if pending then pending.failed = true end
        end
        step(ctx, ctx.steps.statesNext)
        return
    end

    local unmatched = {}
    for _, hash in ipairs(body.unmatched or {}) do
        unmatched[hash] = true
    end
    local results = {}
    for _, result in ipairs(body.results or {}) do
        results[result.hash] = result
    end

    for _, item in ipairs(batch) do
        local pending = ctx.pending_books[item.hash]
        if unmatched[item.hash] then
            ctx.state:setUnmatched(item.hash)
            if pending then pending.failed = true end
        elseif pending then
            -- A server-kept tie still counts as synced: the device value was considered.
            pending.state_acked = true
            local book = ctx.state:getBook(item.hash)
            local server_state = BookOrbitSidecar.stateFromServerResult(results[item.hash])
            if book and server_state then
                if book.file and book.file ~= currentlyOpenFile() then
                    local touched = BookOrbitSidecar.applyServerStateSidecar(book.file, server_state)
                    if touched then
                        pending.mtime = BookOrbitSidecar.sidecarMtime(book.file) or pending.mtime
                    end
                end
                BookOrbitSidecar.rememberServerState(book, server_state)
                pending.state_used_server = true
            end
        end
    end

    step(ctx, ctx.steps.statesNext)
end

-- Phase 7: bulk progress for matched books whose sidecar percent changed.
local function stepProgressNext(ctx)
    if ctx.progress_items:isEmpty() then
        step(ctx, ctx.steps.done)
        return
    end

    local batch = {}
    while #batch < PROGRESS_BATCH do
        local item = ctx.progress_items:pop()
        if not item then break end
        table.insert(batch, item)
    end

    local body, err = ctx.client:bulkProgress(batch)
    if aborted(ctx) then return end
    if not body then
        if isAuthError(err) then return finish(ctx, "auth") end
        logger.dbg("BookOrbit: bulk progress upload failed:", err)
        ctx.had_errors = true
        for _, item in ipairs(batch) do
            local pending = ctx.pending_books[item.hash]
            if pending then pending.failed = true end
        end
        step(ctx, ctx.steps.progressNext)
        return
    end

    local unmatched = {}
    for _, hash in ipairs(body.unmatched or {}) do
        unmatched[hash] = true
    end

    for _, item in ipairs(batch) do
        local pending = ctx.pending_books[item.hash]
        if unmatched[item.hash] then
            ctx.state:setUnmatched(item.hash)
            if pending then pending.failed = true end
        elseif pending then
            pending.progress_acked = true
        end
    end

    step(ctx, ctx.steps.progressNext)
end

-- Phase 8: commit per-book sidecar watermarks for fully acked books, record
-- the sweep server-side and store the fresh library version token.
local function stepDone(ctx)
    local device_now = os.date("%Y-%m-%d %H:%M:%S")
    for md5, pending in pairs(ctx.pending_books) do
        local book = ctx.state:getBook(md5)
        if book and not pending.failed then
            local ann_done = pending.ann_done or (pending.ann_chunks_left ~= nil and pending.ann_chunks_left <= 0)
            local state_done = not pending.need_state or pending.state_acked
            local progress_done = not pending.need_progress or pending.progress_acked
            if ann_done and state_done and progress_done then
                book.sidecarMtime = pending.mtime
                book.annCount = pending.ann_count
                BookOrbitAnnotations.advanceWatermark(book, pending.ann_max_datetime, device_now)
                if state_done and pending.need_state then
                    book.statusSyncedModified = pending.status_modified or book.statusSyncedModified
                    -- The sweep always sends the forced-pull payload, so an
                    -- acknowledged book has current server state and the
                    -- lifecycle path can stay quiet until the bound expires.
                    BookOrbitSidecar.markStatePulled(book)
                    if not pending.state_used_server then
                        BookOrbitSidecar.rememberUploadedState(book, pending.state_summary or {}, pending.state_payload)
                    end
                end
                if progress_done and pending.need_progress then
                    book.progressPushedPct = pending.percentage
                end
            end
        end
    end

    local body = ctx.client:sweepComplete(ctx.counts)
    if aborted(ctx) then return end
    if body and body.libraryVersion then
        ctx.server_library_version = body.libraryVersion
    end

    if ctx.server_library_version then
        local known = ctx.state.global.libraryVersion
        if ctx.full_recheck or known == nil then
            ctx.state.global.needsFullRecheck = false
        elseif ctx.server_library_version ~= known then
            -- The library changed; the next sweep rechecks local hash mappings.
            ctx.state.global.needsFullRecheck = true
        end
        ctx.state.global.libraryVersion = ctx.server_library_version
        ctx.state.global.libraryVersionCheckedAt = os.time()
    end

    ctx.state.global.lastSweepAt = os.time()
    finish(ctx)
end

function BookOrbitSweep.run(opts)
    if BookOrbitSweep.running then
        if opts.interactive then
            UIManager:show(InfoMessage:new{ text = _("BookOrbit sync is already running."), timeout = 2 })
        end
        return false
    end

    local BookOrbitBookSync = require("bookorbit_book_sync")
    if BookOrbitBookSync.isRunning() then
        if opts.interactive then
            UIManager:show(InfoMessage:new{ text = _("BookOrbit is syncing the current book, try again shortly."), timeout = 2 })
        end
        return false
    end

    local client = BookOrbitApi.new(opts.api)
    if not client:isConfigured() then
        if opts.interactive then
            UIManager:show(InfoMessage:new{ text = _("Please configure the BookOrbit server and login first."), timeout = 3 })
        end
        return false
    end

    BookOrbitSweep.running = true

    -- Flush the open book (sidecar + statistics DB) so a mid-session sweep
    -- sees current annotations, summary and reading time.
    local rdr = require("apps/reader/readerui").instance
    if rdr then
        pcall(rdr.saveSettings, rdr)
    end

    local state = BookOrbitStateManager.session()
    run_generation = run_generation + 1
    local ctx = {
        client = client,
        state = state,
        generation = run_generation,
        interactive = opts.interactive or false,
        annotation_sync = opts.annotation_sync ~= false,
        plugin = opts.plugin,
        -- An interactive run is no longer a reason on its own: "Sync all books"
        -- is incremental, and the full rematch is its own explicit action.
        full_recheck = opts.full_recheck == true or state.global.needsFullRecheck or false,
        on_finish = opts.on_finish,
        counts = { books_matched = 0, page_stats = 0, annotations = 0, ann_applied = 0, ann_deleted = 0 },
        timing = {
            enumerate_ms = 0,
            sidecar_ms = 0,
            partial_md5_ms = 0,
            partial_md5_count = 0,
            max_item_ms = 0,
        },
        highlight_summary = BookOrbitHighlightSummary.normalize{
            event = "sweep",
            reason = opts.interactive and "manual" or "auto",
        },
        had_errors = false,
    }
    ctx.stats_session = BookOrbitStatsReader.openSession()
    ctx.steps = {
        enumerateStats = stepEnumerateStats,
        enumerateCandidates = stepEnumerateCandidates,
        enumerateHistory = stepEnumerateHistory,
        match = stepMatch,
        matchNext = stepMatchNext,
        statsNext = stepStatsNext,
        sidecars = stepSidecars,
        annotationsNext = stepAnnotationsNext,
        annotationsLegacyNext = stepAnnotationsLegacyNext,
        statesNext = stepStatesNext,
        progressNext = stepProgressNext,
        done = stepDone,
    }
    active_ctx = ctx

    setProgress(ctx, ctx.full_recheck
        and _("Rechecking every book against BookOrbit. This may take a while.")
        or _("Syncing to BookOrbit. This may take a while on first run."), true)
    logger.info("BookOrbit: sweep started, interactive:", ctx.interactive,
        "full recheck:", ctx.full_recheck)

    step(ctx, ctx.steps.enumerateStats)
    return true
end

return BookOrbitSweep
