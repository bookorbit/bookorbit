--[[--
Each book's chapters, kept for the Chapter line widget.

A book's table of contents only exists while the book is open, and opening a
book just to draw a dashboard tile would be far too slow. So when a book
closes its contents are copied (title, page and depth of each entry, plus the
page count they were measured in) and written after the close has finished,
to cache/bookorbit/chapters/<md5>.lua. Only the most recent books are kept.

stations() turns a saved map into the stops the widget draws: the level of
the contents that reads like chapters, without entries too short to matter.
]]

-- KOReader modules are loaded when first used, so the board's data module
-- (which reads chapter maps) loads without them in specs.
local function lfs() return require("libs/libkoreader-lfs") end
local function logger() return require("logger") end

local ChapterMap = {}

ChapterMap.KEEP = 24
-- Entries shorter than this share of the book (title pages, a copyright
-- page, a dedication) fold into the stop that follows them.
ChapterMap.MIN_SPAN = 0.01
-- A level with at least this many entries reads as chapters.
ChapterMap.MIN_STOPS = 6

local dir = nil
local memo = {}

local function chaptersDir()
    if not dir then
        dir = require("datastorage"):getDataDir() .. "/cache/bookorbit/chapters"
        require("util").makePath(dir)
    end
    return dir
end

local function validMd5(md5)
    return type(md5) == "string" and md5:match("^%x+$") ~= nil
end

-- The contents of the open book, copied out of the reader. Nil when the book
-- has none.
function ChapterMap.capture(ui)
    if not ui or not ui.document or not ui.toc then return nil end
    pcall(ui.toc.fillToc, ui.toc)
    local toc = ui.toc.toc
    if type(toc) ~= "table" or #toc == 0 then return nil end
    local ok, pages = pcall(ui.document.getPageCount, ui.document)
    if not ok or not tonumber(pages) or pages <= 0 then return nil end
    local entries = {}
    for _i, item in ipairs(toc) do
        if type(item) == "table" and tonumber(item.page) then
            table.insert(entries, {
                t = tostring(item.title or ""):gsub("^%s+", ""):gsub("%s+$", ""),
                p = tonumber(item.page),
                d = tonumber(item.depth) or 1,
            })
        end
    end
    if #entries == 0 then return nil end
    return { pages = pages, entries = entries, at = os.time() }
end

local function prune()
    local files = {}
    for name in lfs().dir(chaptersDir()) do
        if name:match("%.lua$") then
            local path = chaptersDir() .. "/" .. name
            table.insert(files, { path = path, at = lfs().attributes(path, "modification") or 0 })
        end
    end
    if #files <= ChapterMap.KEEP then return end
    table.sort(files, function(a, b) return a.at > b.at end)
    for i = ChapterMap.KEEP + 1, #files do os.remove(files[i].path) end
end

function ChapterMap.save(md5, map)
    if not validMd5(md5) or type(map) ~= "table" then return false end
    local path = chaptersDir() .. "/" .. md5 .. ".lua"
    local f = io.open(path .. ".tmp", "w")
    if not f then return false end
    f:write("return " .. require("dump")(map))
    f:close()
    os.rename(path .. ".tmp", path)
    memo[md5] = map
    pcall(prune)
    return true
end

-- Copies the contents now, while the reader still exists, and writes them
-- once the close has finished.
function ChapterMap.remember(ui, md5)
    if not validMd5(md5) then return end
    local ok, map = pcall(ChapterMap.capture, ui)
    if not ok then
        logger().dbg("BookOrbit: chapters not captured:", map)
        return
    end
    if not map then return end
    require("ui/uimanager"):nextTick(function()
        local saved, err = pcall(ChapterMap.save, md5, map)
        if not saved then logger().warn("BookOrbit: chapters not saved:", err) end
    end)
end

function ChapterMap.load(md5)
    if not validMd5(md5) then return nil end
    if memo[md5] ~= nil then return memo[md5] or nil end
    local path = chaptersDir() .. "/" .. md5 .. ".lua"
    local map = false
    if lfs().attributes(path, "mode") == "file" then
        local ok, value = pcall(dofile, path)
        if ok and type(value) == "table" and type(value.entries) == "table" then map = value end
    end
    memo[md5] = map
    return map or nil
end

function ChapterMap._reset()
    memo = {}
    dir = nil
end

-- The stops for a map: { title, pct } where pct is where the stop starts,
-- 0 to 100. Uses the shallowest level of the contents that has at least
-- MIN_STOPS entries (a book in parts gets its chapters, not four parts),
-- then folds entries shorter than MIN_SPAN of the book into the next one.
-- The last entry always stays: it is the end of the line.
function ChapterMap.stations(map)
    if type(map) ~= "table" or type(map.entries) ~= "table" or not tonumber(map.pages) or map.pages <= 0 then return nil end
    local max_depth = 1
    for _i, e in ipairs(map.entries) do max_depth = math.max(max_depth, e.d or 1) end
    local depth = max_depth
    for level = 1, max_depth do
        local count = 0
        for _i, e in ipairs(map.entries) do
            if (e.d or 1) <= level then count = count + 1 end
        end
        if count >= ChapterMap.MIN_STOPS then
            depth = level
            break
        end
    end
    local picked = {}
    for _i, e in ipairs(map.entries) do
        if (e.d or 1) <= depth then
            table.insert(picked, { title = e.t ~= "" and e.t or nil, pct = math.max(0, math.min(100, (e.p - 1) / map.pages * 100)) })
        end
    end
    local stops = {}
    for i, s in ipairs(picked) do
        local next_pct = picked[i + 1] and picked[i + 1].pct or 100
        if s.title and (next_pct - s.pct >= ChapterMap.MIN_SPAN * 100 or i == #picked) then
            table.insert(stops, s)
        end
    end
    if #stops < 2 then return nil end
    return stops
end

return ChapterMap
