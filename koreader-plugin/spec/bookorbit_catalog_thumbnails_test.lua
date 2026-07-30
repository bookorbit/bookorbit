-- Proves the cover worker stays off the UI thread, memoizes its path lookups,
-- coalesces repaints into one per visible batch, keeps prefetch silent and
-- lower priority, drops work for a cancelled generation, and runs its cache
-- maintenance once per version and only after a write.

package.path = "koreader-plugin/spec/?.lua;koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local FakeScheduler = require("helpers/fake_scheduler")
local scheduler = FakeScheduler.new()

local files = {}
local directories = { ["/data/cache/bookorbit"] = true }
local attribute_calls = 0
local dir_listings = 0

package.loaded["datastorage"] = {
    getDataDir = function()
        return "/data"
    end,
}
package.loaded["ui/network/manager"] = {
    isConnected = function()
        return true
    end,
}
package.loaded["ui/trapper"] = {
    isWrapped = function()
        return false
    end,
    wrap = function(_, fn)
        return fn()
    end,
}
package.loaded["ui/uimanager"] = {
    scheduleIn = function(_, delay, callback)
        return scheduler:scheduleIn(delay, callback)
    end,
    nextTick = function(_, callback)
        return scheduler:nextTick(callback)
    end,
    getElapsedTimeSinceBoot = function()
        return scheduler.now
    end,
}
package.loaded["libs/libkoreader-lfs"] = {
    attributes = function(path, attribute)
        attribute_calls = attribute_calls + 1
        if directories[path] then
            return attribute == "mode" and "directory" or { mode = "directory" }
        end
        local entry = files[path]
        if not entry then return nil end
        if attribute == "mode" then return "file" end
        if attribute == "modification" then return entry.mtime end
        return { mode = "file", modification = entry.mtime }
    end,
    dir = function(path)
        dir_listings = dir_listings + 1
        local names = {}
        for full_path in pairs(files) do
            local parent, name = full_path:match("^(.*)/([^/]+)$")
            if parent == path then table.insert(names, name) end
        end
        table.sort(names)
        local index = 0
        return function()
            index = index + 1
            return names[index]
        end
    end,
}
package.loaded["logger"] = {
    dbg = function() end,
    warn = function() end,
}
package.loaded["util"] = {
    makePath = function(path)
        directories[path] = true
        return true
    end,
}
package.loaded["bookorbit_catalog_util"] = {
    THUMBNAIL_BATCH_SIZE = 3,
    cloneParams = function(params)
        local copy = {}
        for key, value in pairs(params or {}) do copy[key] = value end
        return copy
    end,
}

local real_remove = os.remove
local removed = {}
os.remove = function(path)
    table.insert(removed, path)
    files[path] = nil
    return true
end

local CatalogThumbnails = require("bookorbit_catalog_thumbnails")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local downloads = {}
local download_result = true
local forks = 0

local Catalog = {}
CatalogThumbnails.install(Catalog)
Catalog.rebuilds = 0
Catalog.settings = {}
function Catalog:persistSetting(key, value)
    self.settings[key] = value
end
function Catalog:updateItems()
    self.rebuilds = self.rebuilds + 1
end
Catalog.client = {
    -- Mirrors the real ownership contract: one child covers the whole batch.
    runInSubprocess = function(_, fn)
        forks = forks + 1
        return true, { body = fn() }
    end,
    downloadCatalogThumbnail = function(_, book_id, path, opts)
        table.insert(downloads, { id = book_id, path = path, temp = opts.temp_path })
        assertEqual(opts.background, false, "child transfer must not fork again")
        if not download_result then return nil, "network_error" end
        files[path] = { mtime = 1000 + #downloads }
        return true
    end,
}

local function book(id, token)
    return { id = id, hasCover = true, updatedAt = token or "2026-01-01T00:00:00Z" }
end

Catalog:initThumbnailCache()

-- The cache directory is created once at init, not per rendered item.
assertEqual(directories["/data/cache/bookorbit"], true, "cache directory prepared at init")

-- Path, existence and display state are memoized per book id and cover token.
local one = book(1)
attribute_calls = 0
local path, state = Catalog:thumbnailDisplay(one)
assertEqual(path, nil, "uncached cover has no path")
assertEqual(state, "loading", "uncached cover is loading")
assertEqual(attribute_calls, 1, "first lookup probes the filesystem once")
for _ = 1, 5 do Catalog:thumbnailDisplay(one) end
assertEqual(attribute_calls, 1, "repeated lookups reuse the memo")

-- A new cover token is a different cache entry, so a changed cover is not
-- served from the memoized path of the old one.
attribute_calls = 0
Catalog:thumbnailDisplay(book(1, "2026-06-01T00:00:00Z"))
assertEqual(attribute_calls, 1, "a new cover token probes its own entry")

-- Malformed provider IDs never become filesystem paths or transfer jobs.
attribute_calls = 0
local _, unsafe_state = Catalog:thumbnailDisplay({ id = "../../settings", hasCover = true })
assertEqual(unsafe_state, "missing", "unsafe book id has no thumbnail")
assertEqual(attribute_calls, 0, "unsafe book id never probes outside the cache")
Catalog:scheduleThumbnailDownloads({ { id = "../../settings", hasCover = true } })
assertEqual(scheduler:pendingCount(), 0, "unsafe book id is never queued")

-- Visible covers download in one bounded batch and repaint once when it lands.
Catalog:scheduleThumbnailDownloads({ book(1), book(2), book(3), book(4), book(5) })
assertEqual(Catalog.rebuilds, 0, "queuing covers does not repaint")
assertEqual(#downloads, 0, "queuing covers does not download inline")

forks = 0
scheduler:runOne()
assertEqual(#downloads, 3, "one worker round covers a bounded batch")
assertEqual(forks, 1, "the whole batch runs in one subprocess")
assertEqual(Catalog.rebuilds, 1, "a completed visible batch repaints once")

scheduler:runOne()
assertEqual(#downloads, 5, "the worker continues with the rest of the page")
assertEqual(Catalog.rebuilds, 2, "a five-cover page costs two rebuilds")

-- A published cover is memoized as ready without another filesystem probe.
attribute_calls = 0
local ready_path, ready_state = Catalog:thumbnailDisplay(book(1))
assertEqual(ready_state, "ready", "downloaded cover is ready")
assertEqual(ready_path, "/data/cache/bookorbit/1_20260101000000.jpg", "cover path is version scoped")
assertEqual(attribute_calls, 0, "download result updates the memo in place")

-- Covers download into a scoped temporary file, never straight to the cache.
for _, download in ipairs(downloads) do
    assert(download.temp:find("/data/cache/bookorbit/tmp/", 1, true) == 1,
        "cover downloads into the cache temporary directory")
    assert(download.temp ~= download.path, "cover never downloads onto its published path")
end

-- Eviction invalidates the memo so a refresh re-downloads.
Catalog:evictCachedCovers({ book(1) })
local _, evicted_state = Catalog:thumbnailDisplay(book(1))
assertEqual(evicted_state, "loading", "evicted cover is loading again")

-- Prefetch is drained only after visible covers and never repaints.
scheduler:drain()
Catalog.rebuilds = 0
downloads = {}
Catalog:prefetchThumbnails({ book(10), book(11) }, Catalog.thumbnail_generation)
Catalog:scheduleThumbnailDownloads({ book(20) })
scheduler:runOne()
assertEqual(#downloads, 1, "the visible cover goes first")
assertEqual(downloads[1].id, 20, "the visible cover is the one downloaded")
assertEqual(Catalog.rebuilds, 1, "the visible batch repaints")

scheduler:runOne()
assertEqual(#downloads, 3, "prefetch drains after the visible queue")
assertEqual(Catalog.rebuilds, 1, "prefetch does not repaint")

-- Leaving the page cancels the generation: in-flight results are dropped and
-- no repaint reaches the page the user already left.
scheduler:drain()
Catalog.rebuilds = 0
downloads = {}
Catalog:scheduleThumbnailDownloads({ book(30), book(31) })
Catalog:cancelThumbnailJobs()
scheduler:drain()
assertEqual(#downloads, 0, "a cancelled generation downloads nothing")
assertEqual(Catalog.rebuilds, 0, "a cancelled generation does not repaint")

-- A failed cover is remembered so the worker does not retry it every repaint.
download_result = false
Catalog:scheduleThumbnailDownloads({ book(40) })
scheduler:drain()
assertEqual(#downloads, 1, "the failing cover was attempted once")
assertEqual(select(2, Catalog:thumbnailDisplay(book(40))), "failed", "a failed cover reports failed")
Catalog:scheduleThumbnailDownloads({ book(40) })
scheduler:drain()
assertEqual(#downloads, 1, "a failed cover is not requeued")
download_result = true

-- Failure state is scoped to the cover token, so a newer cover for the same
-- book is eligible immediately.
downloads = {}
download_result = false
Catalog:scheduleThumbnailDownloads({ book(45, "2026-01-01T00:00:00Z") })
scheduler:drain()
download_result = true
Catalog:scheduleThumbnailDownloads({ book(45, "2026-02-01T00:00:00Z") })
scheduler:drain()
assertEqual(#downloads, 2, "new cover token retries after an older token failed")

-- An interrupted worker says nothing about its covers, so they stay retriable
-- instead of being remembered as failures.
scheduler:drain()
downloads = {}
local real_run_in_subprocess = Catalog.client.runInSubprocess
Catalog.client.runInSubprocess = function()
    return false
end
Catalog:scheduleThumbnailDownloads({ book(50) })
scheduler:drain()
assertEqual(select(2, Catalog:thumbnailDisplay(book(50))), "loading", "an interrupted cover stays loading")
Catalog.client.runInSubprocess = real_run_in_subprocess
Catalog:scheduleThumbnailDownloads({ book(50) })
scheduler:drain()
assertEqual(#downloads, 1, "an interrupted cover is retried later")

-- Legacy cleanup runs once and records its version.
files["/data/cache/bookorbit/7.jpg"] = { mtime = 10 }
files["/data/cache/bookorbit/7_2026.jpg"] = { mtime = 10 }
dir_listings = 0
Catalog:cleanLegacyThumbnails()
assertEqual(dir_listings, 1, "legacy cleanup walks the cache once")
assertEqual(files["/data/cache/bookorbit/7.jpg"], nil, "legacy filename removed")
assertEqual(files["/data/cache/bookorbit/7_2026.jpg"] ~= nil, true, "versioned filename kept")
assertEqual(Catalog.settings.catalog_thumbnail_cleanup_version, 1, "cleanup version recorded")

dir_listings = 0
Catalog:cleanLegacyThumbnails()
assertEqual(dir_listings, 0, "a recorded cleanup version never walks again")

-- Pruning is write-triggered and throttled to once per catalog session.
Catalog.thumbnail_cache_written = false
Catalog.thumbnail_cache_pruned = false
dir_listings = 0
Catalog:maybePruneThumbnailCache()
assertEqual(dir_listings, 0, "no write means no cache maintenance")

Catalog.thumbnail_cache_written = true
Catalog:maybePruneThumbnailCache()
assertEqual(dir_listings, 1, "a write triggers one maintenance pass")

Catalog.thumbnail_cache_written = true
Catalog:maybePruneThumbnailCache()
assertEqual(dir_listings, 1, "further writes in the same session do not re-prune")

-- Large maintenance work is split across callbacks and converges on the cap.
files = {}
for index = 1, 650 do
    files[string.format("/data/cache/bookorbit/%d_20260101000000.jpg", index)] = { mtime = index }
end
Catalog.thumbnail_cache_pruned = false
Catalog.thumbnail_cache_written = true
Catalog:maybePruneThumbnailCache()
assertEqual(scheduler:pendingCount() > 0, true, "large prune yields to the scheduler")
scheduler:drain()
local remaining = 0
for path in pairs(files) do
    if path:match("%.jpg$") then remaining = remaining + 1 end
end
assertEqual(remaining, 600, "chunked prune retains the configured newest covers")

os.remove = real_remove

print("bookorbit_catalog_thumbnails_test.lua: ok")
