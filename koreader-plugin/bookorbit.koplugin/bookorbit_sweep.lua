--[[--
Full-library sweep: pushes reading statistics, annotations, book states and
bulk progress for all matched books to BookOrbit. Manual-only; the open book
is covered day to day by the per-book snapshot sync.

The sweep is a module-level singleton driven by small steps chained through
UIManager:scheduleIn so the UI stays responsive. It holds no references to a
ReaderUI/FileManager plugin instance and therefore survives document close.
Per-book sync state advances only after the server acknowledges an upload, so
an interrupted sweep resumes exactly where it left off.
]]

local DocSettings = require("docsettings")
local InfoMessage = require("ui/widget/infomessage")
local Notification = require("ui/widget/notification")
local ReadHistory = require("readhistory")
local UIManager = require("ui/uimanager")
local logger = require("logger")
local util = require("util")
local T = require("ffi/util").template
local _ = require("gettext")

local BookOrbitAnnotations = require("bookorbit_annotations")
local BookOrbitApi = require("bookorbit_api")
local BookOrbitSidecar = require("bookorbit_sidecar")
local BookOrbitState = require("bookorbit_state")
local BookOrbitStatsReader = require("bookorbit_stats_reader")

local STEP_DELAY = 0.1
local MATCH_BATCH = 500
local STATS_BATCH = 500
local ANN_BATCH_BOOKS = 20
local ANN_BATCH_TOTAL = 50
local STATES_BATCH = 200
local PROGRESS_BATCH = 100

local BookOrbitSweep = {
    running = false,
}

function BookOrbitSweep.isRunning()
    return BookOrbitSweep.running
end

function BookOrbitSweep.syncStatus()
    local state = BookOrbitState.open()
    local matched, unmatched = 0, 0
    for _ in pairs(state.books) do matched = matched + 1 end
    for _ in pairs(state.unmatched) do unmatched = unmatched + 1 end
    return {
        lastSweepAt = state.global.lastSweepAt or 0,
        matched = matched,
        unmatched = unmatched,
    }
end

local function isAuthError(err)
    return err == 401 or err == 403
end

local PROGRESS_THROTTLE = 2

-- Interactive-only progress toast for the sweep, reused across phases. Identical
-- text never redraws, and changing text redraws at most every PROGRESS_THROTTLE
-- seconds, so a long first run stays legible without flooding the e-ink screen.
local function setProgress(ctx, text, force)
    if not ctx.interactive then return end
    if not force then
        if text == ctx.progress_shown_text then return end
        if ctx.progress_msg and os.time() - (ctx.progress_shown_at or 0) < PROGRESS_THROTTLE then
            return
        end
    end
    ctx.progress_shown_text = text
    ctx.progress_shown_at = os.time()
    if ctx.progress_msg then UIManager:close(ctx.progress_msg) end
    ctx.progress_msg = InfoMessage:new{ text = text }
    UIManager:show(ctx.progress_msg)
end

local function finish(ctx, err)
    BookOrbitSweep.running = false
    if ctx.progress_msg then
        UIManager:close(ctx.progress_msg)
        ctx.progress_msg = nil
    end
    ctx.state:flush()
    if ctx.on_finish then
        pcall(ctx.on_finish, err)
    end

    if err == "auth" then
        if ctx.interactive then
            UIManager:show(InfoMessage:new{ text = _("BookOrbit sync: login failed. Check your credentials."), timeout = 4 })
        else
            Notification:notify(_("BookOrbit sync: login failed"))
        end
        return
    end

    if err == "network" then
        if ctx.interactive then
            UIManager:show(InfoMessage:new{ text = _("BookOrbit sync: server not reachable."), timeout = 4 })
        end
        logger.dbg("BookOrbit: sweep aborted, server not reachable")
        return
    end

    if ctx.interactive then
        local text = T(_("BookOrbit sync done: %1 books matched, %2 reading events, %3 highlights."),
            ctx.counts.books_matched, ctx.counts.page_stats, ctx.counts.annotations)
        if ctx.had_errors then
            text = text .. "\n" .. _("Some books failed and will retry on the next sync.")
        end
        UIManager:show(InfoMessage:new{ text = text, timeout = 5 })
    end
    logger.info(string.format(
        "BookOrbit: sweep done matched=%d pageStats=%d annotations=%d errors=%s",
        ctx.counts.books_matched, ctx.counts.page_stats, ctx.counts.annotations, tostring(ctx.had_errors)))
end

local function step(ctx, fn)
    UIManager:scheduleIn(STEP_DELAY, function()
        local ok, err = pcall(fn, ctx)
        if not ok then
            logger.err("BookOrbit: sweep step failed:", err)
            ctx.had_errors = true
            finish(ctx)
        end
    end)
end

-- Phase 1: enumerate candidate books from the stats database (primary source,
-- has md5 directly) and ReadHistory (provides file paths for sidecar data).
local function stepEnumerate(ctx)
    ctx.candidates = {}

    local stats_books = BookOrbitStatsReader.getBooks()
    for _, entry in ipairs(stats_books or {}) do
        ctx.candidates[entry.md5] = { stat_ids = entry.ids, last_open = entry.last_open }
    end

    for _, item in ipairs(ReadHistory.hist or {}) do
        local file = item.file
        if file then
            local md5 = ctx.state.files[file]
            if not md5 and DocSettings:hasSidecarFile(file) then
                local doc_settings = DocSettings:open(file)
                md5 = doc_settings:readSetting("partial_md5_checksum")
                if not md5 then
                    local ok, computed = pcall(util.partialMD5, file)
                    if ok then md5 = computed end
                end
                ctx.state:rememberFile(file, md5)
            end
            if md5 then
                local cand = ctx.candidates[md5] or {}
                cand.file = file
                if (item.time or 0) > (cand.last_open or 0) then
                    cand.last_open = item.time
                end
                ctx.candidates[md5] = cand
                local book = ctx.state:getBook(md5)
                if book and not book.file then
                    book.file = file
                end
            end
        end
    end

    step(ctx, ctx.steps.match)
end

-- Phase 2: ask the server which hashes it knows. Only never-seen hashes,
-- unmatched hashes with new activity, and (when the library version token
-- changed or on manual sync) the whole unmatched backlog are checked.
local function stepMatch(ctx)
    local to_check = {}
    local queued = {}
    local function queue(md5)
        if not queued[md5] then
            queued[md5] = true
            table.insert(to_check, md5)
        end
    end

    for md5, cand in pairs(ctx.candidates) do
        if not ctx.state:getBook(md5) then
            local last_check = ctx.state.unmatched[md5]
            if not last_check then
                queue(md5)
            elseif (cand.last_open or 0) > last_check then
                queue(md5)
            end
        end
    end

    if ctx.full_recheck then
        for md5 in pairs(ctx.state.unmatched) do
            queue(md5)
        end
    end

    ctx.match_queue = {}
    for i = 1, #to_check, MATCH_BATCH do
        local batch = {}
        for j = i, math.min(i + MATCH_BATCH - 1, #to_check) do
            table.insert(batch, to_check[j])
        end
        table.insert(ctx.match_queue, batch)
    end

    step(ctx, ctx.steps.matchNext)
end

local function stepMatchNext(ctx)
    local batch = table.remove(ctx.match_queue, 1)
    if not batch then
        for md5 in pairs(ctx.candidates) do
            if ctx.state:getBook(md5) then
                ctx.counts.books_matched = ctx.counts.books_matched + 1
            end
        end
        ctx.state:flush()
        ctx.stats_queue = {}
        for md5, cand in pairs(ctx.candidates) do
            if cand.stat_ids and ctx.state:getBook(md5) then
                table.insert(ctx.stats_queue, { md5 = md5, ids = cand.stat_ids })
            end
        end
        ctx.stats_total = #ctx.stats_queue
        step(ctx, ctx.steps.statsNext)
        return
    end

    setProgress(ctx, _("BookOrbit sync: matching books..."))
    local body, err = ctx.client:matchCheck(batch)
    if not body then
        if isAuthError(err) then return finish(ctx, "auth") end
        return finish(ctx, "network")
    end

    local matched = {}
    for _, match in ipairs(body.matches or {}) do
        matched[match.hash] = true
        local cand = ctx.candidates[match.hash]
        ctx.state:setMatched(match.hash, match.bookFileId, match.bookId, cand and cand.file or nil)
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
    local item = ctx.current_stats or table.remove(ctx.stats_queue, 1)
    ctx.current_stats = nil
    if not item then
        step(ctx, ctx.steps.sidecars)
        return
    end

    if ctx.stats_total and ctx.stats_total > 0 then
        setProgress(ctx, T(_("BookOrbit sync: uploading reading data (%1/%2)"),
            ctx.stats_total - #ctx.stats_queue, ctx.stats_total))
    end

    local book = ctx.state:getBook(item.md5)
    if not book then
        step(ctx, ctx.steps.statsNext)
        return
    end

    local watermark = book.statsWatermark or 0
    local events = BookOrbitStatsReader.getEventsAfter(item.ids, watermark, STATS_BATCH)
    if not events or #events == 0 then
        step(ctx, ctx.steps.statsNext)
        return
    end

    local body, err = ctx.client:uploadPageStats({ { hash = item.md5, events = events } })
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
-- queue annotation/state/progress deltas.
local function stepSidecars(ctx)
    ctx.pending_books = {}
    ctx.ann_queue = {}
    ctx.ann_chunks = {}
    ctx.states_items = {}
    ctx.progress_items = {}

    for md5, book in pairs(ctx.state.books) do
        if book.file then
            local mtime = BookOrbitSidecar.sidecarMtime(book.file)
            if mtime and mtime ~= book.sidecarMtime then
                local extract = BookOrbitSidecar.extract(book.file)
                if extract then
                    local pending = {
                        md5 = md5,
                        mtime = mtime,
                        ann_count = extract.annotations_count,
                        ann_max_datetime = extract.annotations_max_datetime,
                        ann_done = false,
                        failed = false,
                        need_state = false,
                        need_progress = false,
                    }

                    -- Every changed sidecar goes through the exchange, even with
                    -- no new local highlights: the full key set is what lets the
                    -- server detect on-device deletions.
                    table.insert(ctx.ann_queue, {
                        md5 = md5,
                        file = book.file,
                        annotations = extract.annotations,
                        ann_max_datetime = extract.annotations_max_datetime,
                    })

                    if extract.status or extract.rating then
                        local state_changed = extract.status ~= nil
                            and (extract.status_modified or "") ~= (book.statusSyncedModified or "")
                        local rating_changed = (extract.rating or 0) ~= (book.ratingSynced or 0)
                        if state_changed or rating_changed then
                            pending.need_state = true
                            pending.status_modified = extract.status_modified
                            pending.rating = extract.rating
                            table.insert(ctx.states_items, {
                                hash = md5,
                                status = extract.status,
                                statusModified = extract.status_modified,
                                rating = extract.rating,
                            })
                        end
                    end

                    if extract.percent_finished then
                        local pushed = book.progressPushedPct or -1
                        if math.abs(extract.percent_finished - pushed) > 0.001 then
                            pending.need_progress = true
                            pending.percentage = extract.percent_finished
                            local cand = ctx.candidates[md5]
                            table.insert(ctx.progress_items, {
                                hash = md5,
                                percentage = extract.percent_finished,
                                progress = extract.last_position,
                                timestamp = cand and cand.last_open or nil,
                            })
                        end
                    end

                    ctx.pending_books[md5] = pending
                end
            end
        end
    end

    ctx.ann_total = #ctx.ann_queue
    step(ctx, ctx.steps.annotationsNext)
end

local buildLegacyAnnotationChunks

local function currentlyOpenFile()
    local ok, ReaderUI = pcall(require, "apps/reader/readerui")
    if ok and ReaderUI and ReaderUI.instance and ReaderUI.instance.document then
        return ReaderUI.instance.document.file
    end
end

-- Phase 5: per-book annotation exchange. Uploads the local delta, reports the
-- key set for deletion detection and applies server-side changes into the
-- sidecar of closed books. Falls back to the legacy one-way upload when the
-- server has no exchange endpoint.
local function stepAnnotationsNext(ctx)
    if ctx.use_legacy_annotations then
        return step(ctx, ctx.steps.annotationsLegacyNext)
    end
    local entry = table.remove(ctx.ann_queue, 1)
    if not entry then
        step(ctx, ctx.steps.statesNext)
        return
    end

    if ctx.ann_total and ctx.ann_total > 0 then
        setProgress(ctx, T(_("BookOrbit sync: syncing highlights (%1/%2)"),
            ctx.ann_total - #ctx.ann_queue, ctx.ann_total))
    end

    local pending = ctx.pending_books[entry.md5]
    local apply_mode = "skip"
    if ctx.annotation_sync and entry.file ~= currentlyOpenFile() then
        apply_mode = "sidecar"
    end

    local result, err = BookOrbitAnnotations.exchangeBook({
        client = ctx.client,
        state = ctx.state,
        digest = entry.md5,
        annotations = entry.annotations,
        ann_max_datetime = entry.ann_max_datetime,
        apply_mode = apply_mode,
        file = entry.file,
    })
    if not result then
        if isAuthError(err) or err == "auth" then return finish(ctx, "auth") end
        if err == "unsupported_server" then
            -- Re-queue everything, including this entry, for the legacy path.
            table.insert(ctx.ann_queue, 1, entry)
            ctx.use_legacy_annotations = true
            buildLegacyAnnotationChunks(ctx)
            return step(ctx, ctx.steps.annotationsLegacyNext)
        end
        ctx.had_errors = true
        if pending then pending.failed = true end
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
    return step(ctx, ctx.steps.annotationsNext)
end

-- Legacy phase 5: one-way chunk upload, packing several books per request
-- while respecting both the per-request book and annotation caps.
buildLegacyAnnotationChunks = function(ctx)
    local device_now = os.date("%Y-%m-%d %H:%M:%S")
    for _, entry in ipairs(ctx.ann_queue) do
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
            local chunk = {}
            for j = i, math.min(i + ANN_BATCH_TOTAL - 1, #delta) do
                table.insert(chunk, delta[j])
            end
            table.insert(ctx.ann_chunks, { md5 = entry.md5, annotations = chunk })
            if pending then pending.ann_chunks_left = pending.ann_chunks_left + 1 end
        end
    end
    ctx.ann_queue = {}
end

local function stepAnnotationsLegacyNext(ctx)
    if #ctx.ann_chunks == 0 then
        step(ctx, ctx.steps.statesNext)
        return
    end

    local books = {}
    local total = 0
    while #ctx.ann_chunks > 0 and #books < ANN_BATCH_BOOKS do
        local next_chunk = ctx.ann_chunks[1]
        if total + #next_chunk.annotations > ANN_BATCH_TOTAL then break end
        table.remove(ctx.ann_chunks, 1)
        table.insert(books, { hash = next_chunk.md5, annotations = next_chunk.annotations })
        total = total + #next_chunk.annotations
    end

    local body, err = ctx.client:uploadAnnotations(books)
    if not body then
        if isAuthError(err) then return finish(ctx, "auth") end
        logger.dbg("BookOrbit: annotations upload failed:", err)
        ctx.had_errors = true
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
        end
    end

    step(ctx, ctx.steps.annotationsLegacyNext)
end

-- Phase 6: book status + rating, batched.
local function stepStatesNext(ctx)
    if #ctx.states_items == 0 then
        step(ctx, ctx.steps.progressNext)
        return
    end

    local batch = {}
    while #ctx.states_items > 0 and #batch < STATES_BATCH do
        table.insert(batch, table.remove(ctx.states_items, 1))
    end

    local body, err = ctx.client:uploadBookStates(batch)
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

    for _, item in ipairs(batch) do
        local pending = ctx.pending_books[item.hash]
        if unmatched[item.hash] then
            ctx.state:setUnmatched(item.hash)
            if pending then pending.failed = true end
        elseif pending then
            -- A server-kept tie still counts as synced: the device value was considered.
            pending.state_acked = true
        end
    end

    step(ctx, ctx.steps.statesNext)
end

-- Phase 7: bulk progress for matched books whose sidecar percent changed.
local function stepProgressNext(ctx)
    if #ctx.progress_items == 0 then
        step(ctx, ctx.steps.done)
        return
    end

    local batch = {}
    while #ctx.progress_items > 0 and #batch < PROGRESS_BATCH do
        table.insert(batch, table.remove(ctx.progress_items, 1))
    end

    local body, err = ctx.client:bulkProgress(batch)
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
                    book.ratingSynced = pending.rating or book.ratingSynced
                end
                if progress_done and pending.need_progress then
                    book.progressPushedPct = pending.percentage
                end
            end
        end
    end

    local body = ctx.client:sweepComplete(ctx.counts)
    if body and body.libraryVersion then
        ctx.server_library_version = body.libraryVersion
    end

    if ctx.server_library_version then
        local known = ctx.state.global.libraryVersion
        if ctx.full_recheck or known == nil then
            ctx.state.global.needsFullRecheck = false
        elseif ctx.server_library_version ~= known then
            -- The library changed; the next sweep rechecks the unmatched backlog.
            ctx.state.global.needsFullRecheck = true
        end
        ctx.state.global.libraryVersion = ctx.server_library_version
    end

    ctx.state.global.lastSweepAt = os.time()
    finish(ctx)
end

function BookOrbitSweep.run(opts)
    if BookOrbitSweep.running then
        if opts.interactive then
            UIManager:show(InfoMessage:new{ text = _("BookOrbit sync is already running."), timeout = 2 })
        end
        return
    end

    local BookOrbitBookSync = require("bookorbit_book_sync")
    if BookOrbitBookSync.isRunning() then
        if opts.interactive then
            UIManager:show(InfoMessage:new{ text = _("BookOrbit is syncing the current book, try again shortly."), timeout = 2 })
        end
        return
    end

    local client = BookOrbitApi.new(opts.api)
    if not client:isConfigured() then
        if opts.interactive then
            UIManager:show(InfoMessage:new{ text = _("Please configure the BookOrbit server and login first."), timeout = 3 })
        end
        return
    end

    BookOrbitSweep.running = true

    -- Flush the open book (sidecar + statistics DB) so a mid-session sweep
    -- sees current annotations, summary and reading time.
    local rdr = require("apps/reader/readerui").instance
    if rdr then
        pcall(rdr.saveSettings, rdr)
    end

    local state = BookOrbitState.open()
    local ctx = {
        client = client,
        state = state,
        interactive = opts.interactive or false,
        annotation_sync = opts.annotation_sync ~= false,
        full_recheck = opts.interactive or state.global.needsFullRecheck or false,
        on_finish = opts.on_finish,
        counts = { books_matched = 0, page_stats = 0, annotations = 0, ann_applied = 0 },
        had_errors = false,
    }
    ctx.steps = {
        enumerate = stepEnumerate,
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

    setProgress(ctx, _("Syncing to BookOrbit. This may take a while on first run."), true)
    logger.info("BookOrbit: sweep started, interactive:", ctx.interactive)

    step(ctx, ctx.steps.enumerate)
end

return BookOrbitSweep
