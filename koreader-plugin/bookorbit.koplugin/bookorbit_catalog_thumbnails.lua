--[[--
Thumbnail cache mixin for the BookOrbit catalog browser.

Owns the on-disk cover cache (cache/bookorbit): versioned paths, download
scheduling with progressive repaints, next-page prefetching and size-capped
pruning. Installed onto the catalog controller as regular methods.
]]

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

local CatalogThumbnails = {}

-- Removes pre-versioning cache files ("<id>.jpg"). They were keyed by book id
-- only, so after a library rescan reassigned ids they showed the wrong cover.
function CatalogThumbnails:cleanLegacyThumbnails()
    local dir = self.thumbnail_cache_dir
    if not dir or lfs.attributes(dir, "mode") ~= "directory" then return end
    for name in lfs.dir(dir) do
        if name:match("^%d+%.jpg$") then
            os.remove(dir .. "/" .. name)
        end
    end
end

-- Deletes cached covers for the given books so a refresh re-downloads them,
-- guaranteeing fresh covers even if the cover changed without a new version.
function CatalogThumbnails:evictCachedCovers(books)
    for _, book in ipairs(books or {}) do
        local path = self:thumbnailPath(book)
        if path then os.remove(path) end
    end
end

function CatalogThumbnails:cancelThumbnailJobs()
    self.thumbnail_generation = self.thumbnail_generation + 1
end

-- Cover cache files are versioned by the book's updatedAt so a server-side
-- cover change or a library rescan (which reassigns book ids) invalidates the
-- cached image instead of showing the previous book's cover.
local function coverToken(book)
    local value = book and book.updatedAt
    if not value then return "0" end
    local token = tostring(value):gsub("%D", "")
    return token ~= "" and token or "0"
end

function CatalogThumbnails:thumbnailPath(book)
    if not book or not book.hasCover then return nil end
    if not util.makePath(self.thumbnail_cache_dir) then return nil end
    return self.thumbnail_cache_dir .. "/" .. tostring(book.id) .. "_" .. coverToken(book) .. ".jpg"
end

function CatalogThumbnails:cachedThumbnailPath(book)
    local path = self:thumbnailPath(book)
    if path and lfs.attributes(path, "mode") == "file" then
        return path
    end
    return nil
end

function CatalogThumbnails:thumbnailState(book)
    if not book or not book.hasCover then return "missing" end
    if self:cachedThumbnailPath(book) then return "ready" end
    if self.thumbnail_failures[tostring(book.id)] then return "failed" end
    return "loading"
end

function CatalogThumbnails:scheduleThumbnailDownloads(items)
    local queue = {}
    for _, book in ipairs(items or {}) do
        if book.hasCover and not self:cachedThumbnailPath(book) and not self.thumbnail_failures[tostring(book.id)] then
            table.insert(queue, book)
        end
    end
    if #queue == 0 then return end

    local generation = self.thumbnail_generation
    local function step()
        if generation ~= self.thumbnail_generation then return end

        for _ = 1, THUMBNAIL_BATCH_SIZE do
            local book = table.remove(queue, 1)
            if not book then break end

            local path = self:thumbnailPath(book)
            if path then
                local ok, err = self.client:downloadCatalogThumbnail(book.id, path)
                if ok then
                    self.thumbnail_failures[tostring(book.id)] = nil
                else
                    self.thumbnail_failures[tostring(book.id)] = true
                    logger.dbg("BookOrbit: thumbnail download failed", book.id, err)
                end
            end
        end

        if generation == self.thumbnail_generation then
            self:updateItems(nil, true)
            if #queue > 0 then
                UIManager:scheduleIn(0.05, step)
            else
                self:pruneThumbnailCache()
            end
        end
    end

    UIManager:scheduleIn(0.15, step)
end

-- Downloads covers for a future page into the disk cache without repainting the
-- current view, so paging forward shows covers immediately.
function CatalogThumbnails:prefetchThumbnails(items, generation)
    local queue = {}
    for _, book in ipairs(items or {}) do
        if book.hasCover and not self:cachedThumbnailPath(book) and not self.thumbnail_failures[tostring(book.id)] then
            table.insert(queue, book)
        end
    end
    if #queue == 0 then return end

    local function step()
        if generation ~= self.thumbnail_generation then return end
        local book = table.remove(queue, 1)
        if not book then
            self:pruneThumbnailCache()
            return
        end
        local path = self:thumbnailPath(book)
        if path then
            local ok = self.client:downloadCatalogThumbnail(book.id, path)
            if not ok then
                self.thumbnail_failures[tostring(book.id)] = true
            end
        end
        UIManager:scheduleIn(0.08, step)
    end
    UIManager:scheduleIn(0.08, step)
end

-- Fetches the next page's book list off the UI thread and warms its covers.
function CatalogThumbnails:prefetchNextPage(query, next_page)
    if not next_page then return end
    local generation = self.thumbnail_generation
    UIManager:scheduleIn(1.0, function()
        if generation ~= self.thumbnail_generation then return end
        NetworkMgr:runWhenConnected(function()
            if generation ~= self.thumbnail_generation then return end
            Trapper:wrap(function()
                local q = cloneParams(query)
                q.page = next_page
                local completed, result = Trapper:dismissableRunInSubprocess(function()
                    local ok, body = pcall(function()
                        return self.client:catalogBooks(q)
                    end)
                    return { body = ok and body or nil }
                end, true)
                if not completed or generation ~= self.thumbnail_generation then return end
                local body = result and result.body
                if body and body.items then
                    self:prefetchThumbnails(body.items, generation)
                end
            end)
        end)
    end)
end

-- Evicts the oldest cached covers once the cache exceeds its soft file cap.
function CatalogThumbnails:pruneThumbnailCache()
    local dir = self.thumbnail_cache_dir
    if not dir or lfs.attributes(dir, "mode") ~= "directory" then return end
    local files = {}
    for name in lfs.dir(dir) do
        if name:match("%.jpg$") then
            local path = dir .. "/" .. name
            local mtime = lfs.attributes(path, "modification")
            if mtime then
                table.insert(files, { path = path, mtime = mtime })
            end
        end
    end
    if #files <= THUMBNAIL_CACHE_MAX_FILES then return end
    table.sort(files, function(a, b) return a.mtime < b.mtime end)
    for i = 1, #files - THUMBNAIL_CACHE_MAX_FILES do
        os.remove(files[i].path)
    end
end

function CatalogThumbnails.install(Catalog)
    for name, fn in pairs(CatalogThumbnails) do
        if name ~= "install" then
            Catalog[name] = fn
        end
    end
end

return CatalogThumbnails
