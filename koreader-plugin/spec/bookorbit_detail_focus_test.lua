-- D-Pad reachability on the book detail page: that its header walks vertically
-- like the stack it draws, and that every pill row keeps one reachable trigger.
--
-- Every pill in a detail row opens the same full list, so exactly one of them is
-- registered for D-Pad focus. The overflow "+N" pill is the natural pick, but a
-- row short enough to fit has no "+N" - and without a fallback the list becomes
-- unreachable on a device that cannot tap a pill.

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;koreader-plugin/spec/?.lua;" .. package.path

local function identity(value) return value end

local function stubWidget(width)
    local widget = {}
    widget.__index = widget
    -- Mirrors KOReader's own Widget:new, which runs init(): a pill derives its
    -- size there, and without it every pill measures zero and nothing overflows.
    function widget:new(opts)
        local instance = setmetatable(opts or {}, self)
        if instance.init then instance:init() end
        return instance
    end
    function widget:extend(opts)
        local child = setmetatable(opts or {}, { __index = self })
        child.__index = child
        child.new = widget.new
        child.extend = widget.extend
        return child
    end
    -- A pill widget sizes itself from the dimen it derived in init, so honour
    -- that first; otherwise fall back to the stub's own fixed width.
    function widget:getSize()
        if self.dimen then return self.dimen end
        return { w = self.width or width or 0, h = 0 }
    end
    return widget
end

package.loaded["ui/bidi"] = { auto = identity, dirpath = identity, filepath = identity }
package.loaded["ffi/blitbuffer"] = { COLOR_GRAY = 0 }
for _, name in ipairs({
    "ui/widget/button", "ui/widget/buttondialog", "ui/widget/container/centercontainer",
    "ui/widget/container/leftcontainer", "ui/widget/container/inputcontainer",
    "ui/widget/horizontalgroup", "ui/widget/horizontalspan", "ui/widget/verticalgroup",
    "ui/widget/verticalspan", "ui/widget/linewidget", "ui/widget/textboxwidget",
    "ui/widget/textviewer", "ui/widget/infomessage", "ui/widget/keyvaluepage",
    "ui/geometry", "ui/gesturerange",
}) do
    package.loaded[name] = stubWidget()
end
package.loaded["ui/font"] = { getFace = function() return { size = 12 } end }
package.loaded["ui/size"] = { line = { medium = 1 } }
package.loaded["ui/network/manager"] = { isConnected = function() return true end }
package.loaded["device"] = { screen = { scaleBySize = function(_, value) return value end } }
package.loaded["ui/uimanager"] = { show = function() end, close = function() end }
package.loaded["document/documentregistry"] = { hasProvider = function() return true end }
package.loaded["util"] = {
    trim = function(value) return tostring(value or ""):match("^%s*(.-)%s*$") end,
    fixUtf8 = identity,
    htmlToPlainTextIfHtml = identity,
}
package.loaded["ffi/util"] = {
    template = function(pattern, a) return (pattern:gsub("%%1", tostring(a))) end,
}
package.loaded["gettext"] = setmetatable({}, { __call = function(_, value) return value end })

-- Each pill reports a fixed width so overflow can be forced by narrowing the row.
local PILL_W = 100
package.loaded["bookorbit_catalog_widgets"] = {
    buildCoverWidget = function() return stubWidget(PILL_W):new() end,
    buildDetailPill = function() return stubWidget(PILL_W):new{ width = PILL_W } end,
    buildDetailProgressBar = function() return stubWidget():new() end,
    detailRatingStarWidth = function() return 20 end,
    DetailRelatedCard = stubWidget(),
    DetailTabButton = stubWidget(),
    DetailRatingStar = stubWidget(),
    focusable = identity,
    focusNavigation = function() return true end,
}

local CatalogDetail = require("bookorbit_catalog_detail")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)), 2)
    end
end

local function buildRow(items, width)
    local page = {}
    page.showFullList = function() end
    page.buildDetailPillRow = CatalogDetail.buildDetailPillRow
    page:buildDetailPillRow(items, width, "Genres", "focus_pill")
    return page
end

-- A row wide enough for every pill has no overflow button, so the first pill
-- carries the focus instead of nothing at all.
local page = buildRow({ "NOVELS" }, 1000)
assertEqual(page.focus_pill ~= nil, true, "a single pill is reachable by focus")
assertEqual(page.focus_pill.text, "NOVELS", "and it is the pill that was drawn")

page = buildRow({ "NOVELS", "FICTION", "CLASSICS" }, 1000)
assertEqual(page.focus_pill ~= nil, true, "a row that fits entirely is still reachable")
assertEqual(page.focus_pill.text, "NOVELS", "via its first pill")

-- A row too narrow overflows, and the "+N" pill keeps the focus: it is the one
-- that says how much is hidden.
page = buildRow({ "NOVELS", "FICTION", "CLASSICS", "ESSAYS" }, 250)
assertEqual(page.focus_pill ~= nil, true, "an overflowing row is reachable")
assertEqual(page.focus_pill.text:match("^%+") ~= nil, true,
    "via its overflow pill, not the first one")

-- No pills at all means nothing to reach, and no stale button left behind.
page = {}
page.showFullList = function() end
page.focus_pill = "stale"
page.buildDetailPillRow = CatalogDetail.buildDetailPillRow
local row = page:buildDetailPillRow({}, 1000, "Genres", "focus_pill")
assertEqual(row, nil, "an empty list builds no row")


-- The header is a vertical stack on screen, so the cursor walks it with Up and
-- Down. Only the rating stars share a row, because only they sit side by side.
local function rows(page)
    page.detailHeaderFocusRows = CatalogDetail.detailHeaderFocusRows
    return page:detailHeaderFocusRows()
end

local full = rows{
    detail_series_line = "series",
    detail_meta_line = "meta",
    detail_rating_stars = { "s1", "s2", "s3", "s4", "s5" },
    detail_more_pills_button = "pill",
    detail_status_button = "status",
    detail_download_button = "download",
}
assertEqual(#full, 6, "each header line gets its own focus row")
assertEqual(full[1][1], "series", "series line first")
assertEqual(full[2][1], "meta", "then the metadata line")
assertEqual(#full[3], 5, "the rating stars share one row")
assertEqual(full[4][1], "pill", "then the genre pill")
assertEqual(full[5][1], "status", "then the status button")
assertEqual(full[6][1], "download", "and the action button last")
for _, row in ipairs(full) do
    if row ~= full[3] then
        assertEqual(#row, 1, "every row but the stars holds a single control")
    end
end

-- Read and Download are the same slot, never both.
local on_device = rows{ detail_meta_line = "meta", detail_read_button = "read" }
assertEqual(#on_device, 2, "a book on the device drops the rows it has no controls for")
assertEqual(on_device[2][1], "read", "and offers Read in the action slot")

-- A sparse page must not leave empty rows for the cursor to fall into.
local sparse = rows{ detail_download_button = "download" }
assertEqual(#sparse, 1, "a header with one control builds one row")
assertEqual(sparse[1][1], "download", "holding that control")
assertEqual(#rows{}, 0, "a header with no controls builds no rows")

print("bookorbit_detail_focus_test.lua: ok")
