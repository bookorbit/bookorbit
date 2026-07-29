--[[--
Thumbnail cache mixin for the BookOrbit catalog browser.

Owns the on-disk cover cache (cache/bookorbit): versioned paths, one bounded
background worker, per-page path memoization and write-triggered pruning.
Installed onto the catalog controller as regular methods.

Covers download inside an API subprocess, a batch at a time, and publish with
an atomic rename out of a generation-scoped temporary directory, so the UI
never blocks on a cover and a page the user already left cannot repaint or
leave a partial file behind.
]]

local DataStorage = require("datastorage")
local NetworkMgr = require("ui/network/manager")
local Trapper = require("ui/trapper")
local UIManager = require("ui/uimanager")
local lfs = require("libs/libkoreader-lfs")
local logger = require("logger")
local util = require("util")

local CatalogUtil = require("bookorbit_catalog_util")

local cloneParams = CatalogUtil.cloneParams
local THUMBNAIL_BATCH_SIZE = CatalogUtil.THUMBNAIL_BATCH_SIZE

-- Soft cap on the catalog thumbnail cache (cache/bookorbit). Oldest covers are
-- evicted past this many files so the cache cannot grow without bound.
local THUMBNAIL_CACHE_MAX_FILES = 600
-- Pruning normally runs once per catalog session. Past this many files the
-- eviction cannot wait for the next session.
local THUMBNAIL_CACHE_HARD_FILES = 900
local THUMBNAIL_MAX_BYTES = 4 * 1024 * 1024

local TEMP_DIRNAME = "tmp"
local TEMP_STALE_SECONDS = 600
local TEMP_SCAN_LIMIT = 200
local MAINTENANCE_ENTRY_BUDGET = 100
local MAINTENANCE_TIME_BUDGET = 0.02
local MAINTENANCE_STEP_DELAY = 0.05

local WORKER_START_DELAY = 0.15
local WORKER_STEP_DELAY = 0.05
local PREFETCH_START_DELAY = 0.25
local PREFETCH_PAGE_DELAY = 1.0

-- Bumped when a cache layout change needs a one-off cleanup; each version runs
-- once and is then recorded in settings.
local CACHE_CLEANUP_VERSION = 1

local CatalogThumbnails = {}
local next_cache_session_id = 0

local function now()
    return UIManager:getElapsedTimeSinceBoot()
end

-- Cover cache files are versioned by the book's updatedAt so a server-side
-- cover change or a library rescan (which reassigns book ids) invalidates the
-- cached image instead of showing the previous book's cover.
local function coverToken(book)
    local value = book and book.updatedAt
    if not value then return "0" end
    local token = tostring(value):gsub("%D", "")
    if #token > 32 then
        token = token:sub(1, 16) .. token:sub(-16)
    end
    return token ~= "" and token or "0"
end

local function normalizedBookId(book)
    local id = book and book.id
    if type(id) ~= "number" or id ~= math.floor(id) or id < 1 or id > 2147483647 then
        return nil
    end
    return string.format("%.0f", id)
end

local function memoKey(book)
    local id = normalizedBookId(book)
    if not id then return nil end
    return id .. "_" .. coverToken(book)
end

local function newQueue()
    return { head = 1, tail = 0, seen = {} }
end

local function takeBatch(queue, limit)
    local batch = {}
    while #batch < limit and queue.head <= queue.tail do
        batch[#batch + 1] = queue[queue.head]
        queue[queue.head] = nil
        queue.head = queue.head + 1
    end
    if queue.head > queue.tail then
        queue.head, queue.tail, queue.seen = 1, 0, {}
    end
    return batch
end

function CatalogThumbnails:initThumbnailCache()
    next_cache_session_id = next_cache_session_id + 1
    self.thumbnail_cache_dir = DataStorage:getDataDir() .. "/cache/bookorbit"
    self.thumbnail_temp_dir = self.thumbnail_cache_dir .. "/" .. TEMP_DIRNAME
    self.thumbnail_cache_session_id = next_cache_session_id
    self.thumbnail_cache_ready = util.makePath(self.thumbnail_cache_dir) and true or false
    self.thumbnail_generation = 0
    self.thumbnail_failures = {}
    self.thumbnail_memo = {}
    self.thumbnail_queue = newQueue()
    self.thumbnail_prefetch_queue = newQueue()
    self.thumbnail_worker_running = false
    self.thumbnail_worker_generation = nil
    self.thumbnail_cache_written = false
    self.thumbnail_cache_pruned = false
    self.thumbnail_temp_swept = false
    self.thumbnail_cleanup_state = nil
    self.thumbnail_prune_state = nil
end

-- The cache directory is created once at catalog init; this only retries when
-- that failed, and never runs on a render path.
function CatalogThumbnails:ensureThumbnailCacheDir()
    if self.thumbnail_cache_ready then return true end
    self.thumbnail_cache_ready = util.makePath(self.thumbnail_cache_dir) and true or false
    return self.thumbnail_cache_ready
end

-- Removes pre-versioning cache files ("<id>.jpg"). They were keyed by book id
-- only, so after a library rescan reassigned ids they showed the wrong cover.
-- Recorded in settings so the same obsolete walk is not repeated forever.
function CatalogThumbnails:cleanLegacyThumbnails()
    if self.catalog_closed then
        local state = self.thumbnail_cleanup_state
        if state and state.iterator_state and state.iterator_state.close then
            pcall(state.iterator_state.close, state.iterator_state)
        end
        self.thumbnail_cleanup_state = nil
        return
    end
    local done = tonumber(self.settings and self.settings.catalog_thumbnail_cleanup_version) or 0
    if done >= CACHE_CLEANUP_VERSION then return end

    local dir = self.thumbnail_cache_dir
    if not dir or lfs.attributes(dir, "mode") ~= "directory" then
        self:persistSetting("catalog_thumbnail_cleanup_version", CACHE_CLEANUP_VERSION)
        return
    end

    if not self.thumbnail_cleanup_state then
        local iterator, iterator_state = lfs.dir(dir)
        self.thumbnail_cleanup_state = {
            iterator = iterator,
            iterator_state = iterator_state,
        }
    end

    local state = self.thumbnail_cleanup_state
    local deadline = now() + MAINTENANCE_TIME_BUDGET
    local processed = 0
    while processed < MAINTENANCE_ENTRY_BUDGET and now() <= deadline do
        local name = state.iterator(state.iterator_state)
        if not name then
            if state.iterator_state and state.iterator_state.close then
                pcall(state.iterator_state.close, state.iterator_state)
            end
            self.thumbnail_cleanup_state = nil
            self:persistSetting("catalog_thumbnail_cleanup_version", CACHE_CLEANUP_VERSION)
            return
        end
        processed = processed + 1
        if name:match("^%d+%.jpg$") then
            os.remove(dir .. "/" .. name)
        end
    end

    UIManager:scheduleIn(MAINTENANCE_STEP_DELAY, function()
        self:cleanLegacyThumbnails()
    end)
end

-- Path, existence and display state for one cover, memoized per book id and
-- cover token so a repaint costs a table lookup instead of a filesystem probe.
function CatalogThumbnails:thumbnailEntry(book)
    if not book or book.id == nil or not book.hasCover then return nil end
    local key = memoKey(book)
    if not key then return nil end
    local entry = self.thumbnail_memo[key]
    if entry then return entry end
    entry = { path = self.thumbnail_cache_dir .. "/" .. key .. ".jpg" }
    entry.exists = lfs.attributes(entry.path, "mode") == "file"
    self.thumbnail_memo[key] = entry
    return entry
end

function CatalogThumbnails:thumbnailPath(book)
    local entry = self:thumbnailEntry(book)
    return entry and entry.path or nil
end

function CatalogThumbnails:cachedThumbnailPath(book)
    local entry = self:thumbnailEntry(book)
    if entry and entry.exists then return entry.path end
    return nil
end

-- Combined lookup for item builders: one memo hit per rebuilt widget instead
-- of a separate path probe and state probe.
function CatalogThumbnails:thumbnailDisplay(book)
    local entry = self:thumbnailEntry(book)
    if not entry then return nil, "missing" end
    if entry.exists then return entry.path, "ready" end
    if self.thumbnail_failures[memoKey(book)] then return nil, "failed" end
    return nil, "loading"
end

function CatalogThumbnails:thumbnailState(book)
    local _, state = self:thumbnailDisplay(book)
    return state
end

function CatalogThumbnails:invalidateThumbnail(book, exists)
    if not book or book.id == nil then return end
    local entry = self.thumbnail_memo[memoKey(book)]
    if entry then entry.exists = exists == true end
end

function CatalogThumbnails:resetThumbnailMemo()
    self.thumbnail_memo = {}
end

-- Deletes cached covers for the given books so a refresh re-downloads them,
-- guaranteeing fresh covers even if the cover changed without a new version.
function CatalogThumbnails:evictCachedCovers(books)
    for _, book in ipairs(books or {}) do
        local path = self:thumbnailPath(book)
        if path then
            os.remove(path)
            self:invalidateThumbnail(book, false)
        end
        local key = memoKey(book)
        if key then self.thumbnail_failures[key] = nil end
    end
end

function CatalogThumbnails:cancelThumbnailJobs()
    self.thumbnail_generation = self.thumbnail_generation + 1
    self.thumbnail_queue = newQueue()
    self.thumbnail_prefetch_queue = newQueue()
    self.thumbnail_worker_running = false
    self.thumbnail_worker_generation = nil
    self:resetThumbnailMemo()
end

function CatalogThumbnails:queueThumbnails(queue, items)
    local added = 0
    for _, book in ipairs(items or {}) do
        local key = memoKey(book)
        if key and book.hasCover and not queue.seen[key]
                and not self:cachedThumbnailPath(book)
                and not self.thumbnail_failures[key] then
            queue.seen[key] = true
            queue.tail = queue.tail + 1
            queue[queue.tail] = book
            added = added + 1
        end
    end
    return added
end

function CatalogThumbnails:scheduleThumbnailDownloads(items)
    if self:queueThumbnails(self.thumbnail_queue, items) == 0 then return end
    self:startThumbnailWorker(WORKER_START_DELAY)
end

-- Queues covers for a future page. They are drained only once the visible
-- queue is empty and never trigger a repaint.
function CatalogThumbnails:prefetchThumbnails(items, generation)
    if generation ~= self.thumbnail_generation then return end
    if self:queueThumbnails(self.thumbnail_prefetch_queue, items) == 0 then return end
    self:startThumbnailWorker(PREFETCH_START_DELAY)
end

function CatalogThumbnails:startThumbnailWorker(delay)
    if self.thumbnail_worker_running then return end
    local generation = self.thumbnail_generation
    self.thumbnail_worker_running = true
    self.thumbnail_worker_generation = generation
    UIManager:scheduleIn(delay or WORKER_START_DELAY, function()
        self:runThumbnailWorker(generation)
    end)
end

function CatalogThumbnails:stopThumbnailWorker(generation)
    if self.thumbnail_worker_generation ~= generation then return end
    self.thumbnail_worker_running = false
    self.thumbnail_worker_generation = nil
end

function CatalogThumbnails:runThumbnailWorker(generation)
    if generation ~= self.thumbnail_generation then
        self:stopThumbnailWorker(generation)
        return
    end

    local visible = true
    local batch = takeBatch(self.thumbnail_queue, THUMBNAIL_BATCH_SIZE)
    if #batch == 0 then
        visible = false
        batch = takeBatch(self.thumbnail_prefetch_queue, THUMBNAIL_BATCH_SIZE)
    end
    if #batch == 0 then
        self:stopThumbnailWorker(generation)
        self:maybePruneThumbnailCache()
        return
    end

    Trapper:wrap(function()
        local ok, results = pcall(self.downloadThumbnailBatch, self, batch, generation)
        if generation ~= self.thumbnail_generation then
            self:stopThumbnailWorker(generation)
            return
        end
        if not ok or not results then
            -- A failed or interrupted worker says nothing about these covers;
            -- leave them unmarked so a later visit retries them, and release
            -- the worker so the next page is not stuck behind it.
            if not ok then logger.dbg("BookOrbit: thumbnail batch failed", results) end
            self:stopThumbnailWorker(generation)
            return
        end

        local written = false
        for _, book in ipairs(batch) do
            local key = memoKey(book)
            if key and results[key] then
                self.thumbnail_failures[key] = nil
                self:invalidateThumbnail(book, true)
                self.thumbnail_cache_files = (self.thumbnail_cache_files or 0) + 1
                written = true
            elseif key then
                self.thumbnail_failures[key] = true
                self:invalidateThumbnail(book, false)
            end
        end
        if written then self.thumbnail_cache_written = true end

        -- One coalesced rebuild per completed visible batch. Prefetch never
        -- repaints, so warming the next page costs no e-ink refresh.
        if visible and written then
            self:updateItems(nil, true)
        end

        UIManager:scheduleIn(WORKER_STEP_DELAY, function()
            self:runThumbnailWorker(generation)
        end)
    end)
end

-- Runs a whole batch inside one API subprocess. The child writes each cover to
-- a generation-scoped temporary file, publishes it with an atomic rename and
-- returns only a bounded book id -> ok table; it touches no widget or setting.
-- Returns nil when the worker itself was interrupted, which is not a verdict
-- on the covers.
function CatalogThumbnails:downloadThumbnailBatch(batch, generation)
    if not self:ensureThumbnailCacheDir() then return {} end
    self:sweepThumbnailTemp()

    local jobs = {}
    for _, book in ipairs(batch) do
        local path = self:thumbnailPath(book)
        local key = memoKey(book)
        if path and key then
            local temp = path .. ".part"
            if self.thumbnail_temp_dir then
                temp = self.thumbnail_temp_dir .. "/"
                    .. self.thumbnail_cache_session_id .. "_" .. generation .. "_" .. key .. ".part"
            end
            jobs[#jobs + 1] = { id = book.id, key = key, path = path, temp = temp }
        end
    end
    if #jobs == 0 then return {} end

    local client = self.client
    local completed, result = client:runInSubprocess(function()
        local outcome = {}
        for _, job in ipairs(jobs) do
            local ok, err = client:downloadCatalogThumbnail(job.id, job.path, {
                temp_path = job.temp,
                max_bytes = THUMBNAIL_MAX_BYTES,
                background = false,
            })
            if not ok then
                logger.dbg("BookOrbit: thumbnail download failed", job.id, err)
            end
            outcome[job.key] = ok == true
        end
        return outcome
    end)
    if not completed then return nil end
    return (result and result.body) or {}
end

-- Removes temporary files left behind by a killed or cancelled worker. Runs
-- once per catalog session and is bounded, so it cannot delay the first cover.
function CatalogThumbnails:sweepThumbnailTemp()
    if self.thumbnail_temp_swept then return end
    self.thumbnail_temp_swept = true
    if not util.makePath(self.thumbnail_temp_dir) then
        self.thumbnail_temp_dir = nil
        return
    end

    local now = os.time()
    local scanned = 0
    for name in lfs.dir(self.thumbnail_temp_dir) do
        if name:match("%.part$") then
            scanned = scanned + 1
            if scanned > TEMP_SCAN_LIMIT then break end
            local path = self.thumbnail_temp_dir .. "/" .. name
            local mtime = lfs.attributes(path, "modification")
            if not mtime or now - mtime > TEMP_STALE_SECONDS then
                os.remove(path)
            end
        end
    end
end

-- Maintenance is write-triggered: a session that only reads cached covers
-- never walks the cache directory.
function CatalogThumbnails:maybePruneThumbnailCache()
    if not self.thumbnail_cache_written then return end
    if self.thumbnail_prune_state then return end
    self.thumbnail_cache_written = false
    if self.thumbnail_cache_pruned
            and (self.thumbnail_cache_files or 0) < THUMBNAIL_CACHE_HARD_FILES then
        return
    end
    self.thumbnail_cache_pruned = false
    self:pruneThumbnailCache()
end

local function heapSwap(heap, a, b)
    heap[a], heap[b] = heap[b], heap[a]
end

local function heapPush(heap, value)
    heap[#heap + 1] = value
    local index = #heap
    while index > 1 do
        local parent = math.floor(index / 2)
        if heap[parent].mtime <= value.mtime then break end
        heap[index] = heap[parent]
        index = parent
    end
    heap[index] = value
end

local function heapReplaceOldest(heap, value)
    local removed = heap[1]
    heap[1] = value
    local index = 1
    while true do
        local left = index * 2
        if left > #heap then break end
        local right = left + 1
        local child = right <= #heap and heap[right].mtime < heap[left].mtime and right or left
        if heap[index].mtime <= heap[child].mtime then break end
        heapSwap(heap, index, child)
        index = child
    end
    return removed
end

-- Keeps the newest soft-cap covers with bounded wall-clock work per callback.
function CatalogThumbnails:pruneThumbnailCache()
    if self.catalog_closed then
        local state = self.thumbnail_prune_state
        if state and state.iterator_state and state.iterator_state.close then
            pcall(state.iterator_state.close, state.iterator_state)
        end
        self.thumbnail_prune_state = nil
        return
    end
    local dir = self.thumbnail_cache_dir
    if not dir or lfs.attributes(dir, "mode") ~= "directory" then return end

    if not self.thumbnail_prune_state then
        local iterator, iterator_state = lfs.dir(dir)
        self.thumbnail_prune_state = {
            iterator = iterator,
            iterator_state = iterator_state,
            newest = {},
            removed = 0,
            removal_failures = 0,
        }
    end

    local state = self.thumbnail_prune_state
    local deadline = now() + MAINTENANCE_TIME_BUDGET
    local processed = 0
    while processed < MAINTENANCE_ENTRY_BUDGET and now() <= deadline do
        local name = state.iterator(state.iterator_state)
        if not name then
            if state.iterator_state and state.iterator_state.close then
                pcall(state.iterator_state.close, state.iterator_state)
            end
            self.thumbnail_cache_files = #state.newest
                + state.removal_failures
            self.thumbnail_cache_pruned = state.removal_failures == 0
            self.thumbnail_prune_state = nil
            if state.removed > 0 then self:resetThumbnailMemo() end
            if self.thumbnail_cache_written then
                UIManager:scheduleIn(MAINTENANCE_STEP_DELAY, function()
                    self:maybePruneThumbnailCache()
                end)
            end
            return
        end

        processed = processed + 1
        if name:match("%.jpg$") then
            local item = {
                path = dir .. "/" .. name,
                mtime = lfs.attributes(dir .. "/" .. name, "modification"),
            }
            if item.mtime then
                if #state.newest < THUMBNAIL_CACHE_MAX_FILES then
                    heapPush(state.newest, item)
                elseif item.mtime > state.newest[1].mtime then
                    local removed = heapReplaceOldest(state.newest, item)
                    if os.remove(removed.path) then
                        state.removed = state.removed + 1
                    else
                        state.removal_failures = state.removal_failures + 1
                    end
                elseif os.remove(item.path) then
                    state.removed = state.removed + 1
                else
                    state.removal_failures = state.removal_failures + 1
                end
            end
        end
    end

    UIManager:scheduleIn(MAINTENANCE_STEP_DELAY, function()
        self:pruneThumbnailCache()
    end)
end

-- Fetches the next page's book list off the UI thread and warms its covers.
-- Only local link state gates this: a background prefetch must never prompt
-- the user to connect.
function CatalogThumbnails:prefetchNextPage(query, next_page)
    if not next_page then return end
    local generation = self.thumbnail_generation
    UIManager:scheduleIn(PREFETCH_PAGE_DELAY, function()
        if generation ~= self.thumbnail_generation then return end
        if not NetworkMgr:isConnected() then return end
        Trapper:wrap(function()
            local q = cloneParams(query)
            q.page = next_page
            local completed, result = self.client:runInSubprocess(function()
                return self.client:catalogBooks(q)
            end)
            if not completed or generation ~= self.thumbnail_generation then return end
            local body = result and result.body
            if body and body.items then
                self:prefetchThumbnails(body.items, generation)
            end
        end)
    end)
end

function CatalogThumbnails.install(Catalog)
    for name, fn in pairs(CatalogThumbnails) do
        if name ~= "install" then
            Catalog[name] = fn
        end
    end
end

return CatalogThumbnails
