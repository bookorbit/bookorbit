-- A place BookOrbit holds without a position can only be reached by percentage,
-- which lands on a page boundary, so a jump there must not leave a prompt that
-- offers the same place again on the next sync.

local function read(path)
    local file = assert(io.open(path))
    local source = file:read("*a")
    file:close()
    return source
end

local source = read("koreader-plugin/bookorbit.koplugin/bookorbit_progress_sync.lua")
local same = assert(source:match("(function ProgressSync:isSamePlace.-\nend)\n"))
local chunk = assert(loadstring("local ProgressSync = {}\n" .. same .. "\nreturn ProgressSync"))
local ProgressSync = chunk()

local function plugin(pages)
    local p = setmetatable({}, { __index = ProgressSync })
    p.ui = { document = { getPageCount = function() return pages end } }
    return p
end

local p = plugin(167)
-- 60% of 167 pages is page 100.2: the jump lands on page 100, 59.88%.
assert(p:isSamePlace({ percentage = 0.6, progress = nil }, 100 / 167, "/body/p[3]"),
    "a percentage-only place within a page is where the reader already is")
assert(p:isSamePlace({ percentage = 0.6, progress = "" }, 100 / 167, "/body/p[3]"),
    "an empty position counts as none")
-- Another device on page 135 (0.8083) reaches this copy on page 134 (0.8024).
assert(p:isSamePlace({ percentage = 0.8083, progress = nil }, 134 / 167, "/body/p[3]"),
    "a percentage jump that rounds down to the page start is still the same place")
assert(not p:isSamePlace({ percentage = 0.62, progress = nil }, 100 / 167, "/body/p[3]"),
    "more than a page away is a different place")
assert(not p:isSamePlace({ percentage = 0.6, progress = "/body/p[9]" }, 100 / 167, "/body/p[3]"),
    "an exact position elsewhere is never rounded into this one")
assert(p:isSamePlace({ percentage = 0.4, progress = "/body/p[3]" }, 0.6, "/body/p[3]"),
    "the same exact position is the same place whatever the percentages say")
assert(p:isSamePlace({ percentage = 0.5, progress = nil }, 0.5, nil),
    "equal percentages are the same place, as before")

local unknown = plugin(nil)
assert(not unknown:isSamePlace({ percentage = 0.6, progress = nil }, 0.5988, "/body/p[3]"),
    "without a page count only the exact comparison applies")
local closed = setmetatable({}, { __index = ProgressSync })
assert(not closed:isSamePlace({ percentage = 0.6, progress = nil }, 0.5988, "/body/p[3]"),
    "without an open document only the exact comparison applies")

-- The jump itself: page mode goes to the page the other device reported.
local sync_to = assert(source:match("(function ProgressSync:syncToProgress.-\nend)\n"))
local function jumper(view_mode, pages, has_pages)
    local events = {}
    local env = setmetatable({
        Event = { new = function(_, name, value) return { name = name, value = value } end },
        logger = { dbg = function() end },
    }, { __index = _G })
    local loaded = assert(loadstring("local ProgressSync = {}\n" .. sync_to .. "\nreturn ProgressSync"))
    setfenv(loaded, env)
    local jp = setmetatable({}, { __index = loaded() })
    jp.ui = {
        handleEvent = function(_, event) table.insert(events, event) end,
        document = { info = { number_of_pages = pages, has_pages = has_pages } },
        rolling = not has_pages and { view = { view_mode = view_mode } } or nil,
    }
    return jp, events
end

local paged, paged_events = jumper("page", 167, false)
paged:syncToProgress(nil, 135 / 167)
assert(paged_events[1].name == "GotoPage" and paged_events[1].value == 135, "page mode lands on the reported page, not one short")
paged:syncToProgress("", 0)
assert(paged_events[2].value == 1, "the start of the book is page 1")
paged:syncToProgress(nil, 1)
assert(paged_events[3].value == 167, "the end of the book is the last page")

local scrolled, scrolled_events = jumper("scroll", 167, false)
scrolled:syncToProgress(nil, 0.6)
assert(scrolled_events[1].name == "GotoPercent" and math.abs(scrolled_events[1].value - 60) < 1e-9, "scroll mode keeps the offset jump")

local pdf, pdf_events = jumper(nil, 40, true)
pdf:syncToProgress(nil, 0.5)
assert(pdf_events[1].name == "GotoPercent", "a paged document keeps the percentage jump")

local exact, exact_events = jumper("page", 167, false)
exact:syncToProgress("/body/p[3]", 0.6)
assert(exact_events[1].name == "GotoXPointer", "an exact position still wins")

print("bookorbit_same_place_test: ok")
