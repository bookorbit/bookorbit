--[[--
Deterministic environment for driving BookOrbitSweep from a standalone spec.

It installs the KOReader modules the sweep touches, a fake statistics database
backed by helpers/fake_sqlite, a fake scheduler so chunk callbacks advance on
demand instead of on wall time, and a recording API client. Time is frozen
(gettime returns 0), so chunk boundaries fall on the item count rather than on
how fast the machine running the spec happens to be.

Call install() before requiring bookorbit_sweep.
]]

local FakeScheduler = require("helpers/fake_scheduler")
local FakeSqlite = require("helpers/fake_sqlite")

local SweepHarness = {}

local function joinArgs(...)
    local parts = {}
    for index = 1, select("#", ...) do
        table.insert(parts, tostring((select(index, ...))))
    end
    return table.concat(parts, " ")
end

local function statisticsResponder(handle)
    return function(sql, params)
        if sql:find("FROM book WHERE md5 IS NOT NULL", 1, true) then
            local after_id, limit = params[1] or 0, params[2] or 50
            local rows = {}
            for _, book in ipairs(handle.books) do
                if book.id > after_id and #rows < limit then
                    table.insert(rows, {
                        tostring(book.id), book.md5, book.title or "",
                        book.authors or "", tostring(book.last_open or 0),
                    })
                end
            end
            return FakeSqlite.resultSet(rows)
        end

        if sql:find("MAX(start_time)", 1, true) then
            handle.calls.latest_event_queries = handle.calls.latest_event_queries + 1
            local rows = {}
            for id, events in pairs(handle.events) do
                local newest = 0
                for _, event in ipairs(events) do
                    if event.start_time > newest then newest = event.start_time end
                end
                table.insert(rows, { tostring(id), tostring(newest) })
            end
            table.sort(rows, function(a, b) return a[1] < b[1] end)
            return FakeSqlite.resultSet(rows)
        end

        if sql:find("FROM page_stat_data", 1, true) then
            handle.calls.event_queries = handle.calls.event_queries + 1
            local watermark = params[#params - 1] or 0
            local rows = {}
            for index = 1, #params - 2 do
                for _, event in ipairs(handle.events[params[index]] or {}) do
                    if event.start_time > watermark then
                        table.insert(rows, {
                            tostring(event.page), tostring(event.start_time),
                            tostring(event.duration or 60), tostring(event.total_pages or 100),
                        })
                    end
                end
            end
            return FakeSqlite.resultSet(rows)
        end

        return nil
    end
end

local function installClient(handle)
    local responses = handle.responses
    return {
        isConfigured = function() return true end,
        matchCheck = function(_, hashes)
            table.insert(handle.calls.match, hashes)
            local matches = {}
            for _, hash in ipairs(hashes) do
                if responses.unmatched[hash] then
                    -- left out of the response on purpose
                else
                    table.insert(matches, { hash = hash, bookId = 1, bookFileId = 2 })
                end
            end
            return { matches = matches, libraryVersion = responses.library_version }
        end,
        uploadPageStats = function(_, books)
            table.insert(handle.calls.page_stats, books)
            return { results = {}, unmatched = {} }
        end,
        uploadBookStates = function(_, batch)
            table.insert(handle.calls.book_states, batch)
            return { results = {}, unmatched = {} }
        end,
        bulkProgress = function(_, batch)
            table.insert(handle.calls.progress, batch)
            return { unmatched = {} }
        end,
        uploadAnnotations = function(_, books)
            table.insert(handle.calls.legacy_annotations, books)
            return { unmatched = {} }
        end,
        sweepComplete = function()
            handle.calls.sweep_complete = handle.calls.sweep_complete + 1
            return { libraryVersion = responses.library_version }
        end,
    }
end

--[[--
opts:
- books: statistics rows, { md5, id, title, authors, last_open }
- events: map of statistics row id to { page, start_time, duration, total_pages }
- history: ReadHistory entries, { file, time, text }
- state: initial { books, unmatched, files, global }
- library_version: token every server response carries
- unmatched: set of hashes match-check refuses to match
- sidecar: overrides for the BookOrbitSidecar stub
]]
function SweepHarness.install(opts)
    opts = opts or {}
    -- Plugin modules capture their stubs at load time, so a second harness in
    -- the same process has to make them resolve again or it silently keeps
    -- talking to the previous fixture.
    for name in pairs(package.loaded) do
        if type(name) == "string" and name:match("^bookorbit_") then
            package.loaded[name] = nil
        end
    end

    local handle = {
        books = opts.books or {},
        events = opts.events or {},
        history = opts.history or {},
        responses = {
            library_version = opts.library_version,
            unmatched = opts.unmatched or {},
        },
        calls = {
            match = {},
            page_stats = {},
            book_states = {},
            progress = {},
            legacy_annotations = {},
            sweep_complete = 0,
            event_queries = 0,
            latest_event_queries = 0,
            scheduled = 0,
            sidecar_extracts = {},
            history_resolved = {},
        },
        bookmark_exchanges = {},
        flushes = 0,
    }

    handle.scheduler = FakeScheduler.new()
    handle.sqlite = FakeSqlite.install(statisticsResponder(handle), opts.sqlite)

    package.loaded["datastorage"] = { getSettingsDir = function() return "/nonexistent" end }
    package.loaded["luasettings"] = {
        open = function()
            return {
                data = {},
                readSetting = function(_, _, default) return default end,
                saveSetting = function() end,
                flush = function() end,
            }
        end,
    }
    package.loaded["dump"] = function() return "{}" end
    package.loaded["logger"] = {
        dbg = function() end,
        info = function() end,
        warn = function() end,
        -- A sweep step that throws must fail the spec rather than be swallowed
        -- by the step's own error handling.
        err = function(...) error(joinArgs(...), 0) end,
    }
    package.loaded["ffi/util"] = {
        template = function(text) return text end,
        -- Frozen clock: chunk boundaries then depend only on the item count.
        gettime = function() return 0, 0 end,
    }
    package.loaded["gettext"] = function(value) return value end
    package.loaded["util"] = {
        partialMD5 = function(file) return "md5-" .. file end,
        trim = function(value) return value end,
    }
    package.loaded["libs/libkoreader-lfs"] = {
        attributes = function(_, what)
            if what == "mode" then return "file" end
            return nil
        end,
    }
    package.loaded["readhistory"] = { hist = handle.history }
    package.loaded["docsettings"] = {
        hasSidecarFile = function() return opts.has_sidecar_files == true end,
        open = function()
            return {
                readSetting = function() return nil end,
                saveSetting = function() end,
                makeTrue = function() end,
                flush = function() end,
            }
        end,
    }
    package.loaded["apps/reader/readerui"] = { instance = nil }

    package.loaded["ui/uimanager"] = {
        scheduleIn = function(_, delay, callback)
            handle.calls.scheduled = handle.calls.scheduled + 1
            handle.scheduler:scheduleIn(delay, callback)
        end,
        show = function() end,
        close = function() end,
        setDirty = function() end,
    }
    package.loaded["ui/trapper"] = { wrap = function(_, callback) callback() end }
    package.loaded["ui/widget/infomessage"] = { new = function(_, fields) return fields end }
    package.loaded["ui/widget/notification"] = { notify = function() end }
    package.loaded["ui/widget/buttondialog"] = {
        new = function(_, fields)
            fields.setTitle = function(self, title) self.title = title end
            handle.dialog = fields
            return fields
        end,
    }

    local sidecar = {
        sidecarMtime = function() return nil end,
        extract = function() return nil end,
        buildStatePayload = function() return nil end,
        stateFromServerResult = function() return nil end,
        applyServerStateSidecar = function() return false end,
        rememberServerState = function() end,
        markStatePulled = function() end,
        rememberUploadedState = function() end,
    }
    for key, value in pairs(opts.sidecar or {}) do
        sidecar[key] = value
    end
    handle.sidecar = sidecar
    package.loaded["bookorbit_sidecar"] = sidecar

    package.loaded["bookorbit_annotations"] = {
        exchangeBook = function()
            return { uploaded = 0, applied = 0, deleted = 0, failed = 0, had_errors = false }
        end,
        readWatermark = function() return "" end,
        advanceWatermark = function() end,
    }
    package.loaded["bookorbit_bookmarks"] = {
        enabled = function() return opts.bookmark_sync == true end,
        markUnsupported = function() end,
        canSkipExchange = function() return false end,
        rememberExchanged = function() end,
        exchangeBook = function()
            table.insert(handle.bookmark_exchanges, true)
            return { uploaded = 0, applied = 0, deleted = 0, failed = 0, had_errors = false }
        end,
    }
    package.loaded["bookorbit_highlight_summary"] = {
        normalize = function(value) return value end,
        add = function(value) return value end,
        addBookmarks = function(value) return value end,
        hasCounts = function() return false end,
        hasRemoteChanges = function() return false end,
    }
    package.loaded["bookorbit_api"] = { new = function() return installClient(handle) end }
    package.loaded["bookorbit_book_sync"] = { isRunning = function() return false end }

    local BookOrbitState = require("bookorbit_state")
    local initial = opts.state or {}
    handle.state = BookOrbitState.snapshot({
        books = initial.books or {},
        unmatched = initial.unmatched or {},
        files = initial.files or {},
        global = initial.global or {},
    }, function()
        handle.flushes = handle.flushes + 1
    end)
    package.loaded["bookorbit_state_manager"] = {
        session = function() return handle.state end,
        summary = function() return {} end,
    }

    return handle
end

-- Collects the hashes a match-check batch carried, as a set, because the
-- queue is built from pairs() and its order is not defined.
function SweepHarness.hashSet(batch)
    local set = {}
    for _, hash in ipairs(batch or {}) do
        set[hash] = true
    end
    return set
end

function SweepHarness.sortedKeys(map)
    local keys = {}
    for key in pairs(map or {}) do
        table.insert(keys, key)
    end
    table.sort(keys)
    return keys
end

return SweepHarness
