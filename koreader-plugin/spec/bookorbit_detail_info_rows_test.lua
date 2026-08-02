-- The Book info sheet is built from a pure helper so the long-tail metadata
-- can be asserted without a screen: null skipping, series index trimming, size
-- and date formatting, and the download button's size suffix.

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;koreader-plugin/spec/?.lua;" .. package.path

local function identity(value) return value end

local function stubWidget()
    local widget = {}
    widget.__index = widget
    function widget:new(opts)
        opts = opts or {}
        return setmetatable(opts, widget)
    end
    function widget:extend(opts)
        local child = setmetatable(opts or {}, { __index = self })
        child.__index = child
        child.new = widget.new
        child.extend = widget.extend
        return child
    end
    function widget:getSize() return { w = 0, h = 0 } end
    return widget
end

package.loaded["ui/bidi"] = { auto = identity, dirpath = identity, filepath = identity }
package.loaded["ffi/blitbuffer"] = { COLOR_GRAY = 0 }
package.loaded["ui/widget/button"] = stubWidget()
package.loaded["ui/widget/buttondialog"] = stubWidget()
package.loaded["ui/widget/container/centercontainer"] = stubWidget()
package.loaded["ui/widget/container/leftcontainer"] = stubWidget()
package.loaded["ui/widget/container/inputcontainer"] = stubWidget()
package.loaded["ui/widget/horizontalgroup"] = stubWidget()
package.loaded["ui/widget/horizontalspan"] = stubWidget()
package.loaded["ui/widget/verticalgroup"] = stubWidget()
package.loaded["ui/widget/verticalspan"] = stubWidget()
package.loaded["ui/widget/linewidget"] = stubWidget()
package.loaded["ui/widget/textboxwidget"] = stubWidget()
package.loaded["ui/widget/textviewer"] = stubWidget()
package.loaded["ui/widget/infomessage"] = stubWidget()
package.loaded["ui/widget/keyvaluepage"] = stubWidget()
package.loaded["ui/geometry"] = stubWidget()
package.loaded["ui/gesturerange"] = stubWidget()
package.loaded["ui/font"] = { getFace = function() return { size = 12 } end }
package.loaded["ui/size"] = { line = { medium = 1 } }
package.loaded["ui/network/manager"] = { isConnected = function() return true end }
package.loaded["device"] = { screen = { scaleBySize = function(_, value) return value end } }
package.loaded["ui/uimanager"] = { show = function() end, close = function() end }
package.loaded["document/documentregistry"] = { hasProvider = function() return true end }
package.loaded["util"] = {
    trim = function(value) return tostring(value or ""):match("^%s*(.-)%s*$") end,
    fixUtf8 = function(value) return value end,
    htmlToPlainTextIfHtml = identity,
}
package.loaded["ffi/util"] = {
    template = function(pattern, a, b)
        return (pattern:gsub("%%1", tostring(a)):gsub("%%2", tostring(b)))
    end,
}
package.loaded["gettext"] = setmetatable({}, { __call = function(_, value) return value end })
local widget_stub = stubWidget()
package.loaded["bookorbit_catalog_widgets"] = {
    buildCoverWidget = function() return widget_stub:new() end,
    buildDetailPill = function() return widget_stub:new() end,
    buildDetailProgressBar = function() return widget_stub:new() end,
    detailRatingStarWidth = function() return 20 end,
    DetailRelatedCard = stubWidget(),
    DetailTabButton = stubWidget(),
    DetailRatingStar = stubWidget(),
}

local CatalogDetail = require("bookorbit_catalog_detail")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)), 2)
    end
end

local function rowValue(rows, key)
    for _, row in ipairs(rows) do
        if row.key == key then return row.value end
    end
end

local function rowCount(rows, key)
    local count = 0
    for _, row in ipairs(rows) do
        if row.key == key then count = count + 1 end
    end
    return count
end

-- Series index formatting

assertEqual(CatalogDetail.formatSeriesIndex(3), "3", "a whole index drops the decimal")
assertEqual(CatalogDetail.formatSeriesIndex(3.0), "3", "a trailing .0 is trimmed")
assertEqual(CatalogDetail.formatSeriesIndex(1.5), "1.5", "a half index keeps one decimal")
assertEqual(CatalogDetail.formatSeriesIndex(1.25), "1.25", "two decimals survive")
assertEqual(CatalogDetail.formatSeriesIndex(nil), nil, "no index formats to nothing")
assertEqual(CatalogDetail.formatSeriesIndex("nonsense"), nil, "an unparsable index formats to nothing")

assertEqual(CatalogDetail.detailSeriesText({ seriesName = "Discworld", seriesIndex = 3.0 }), "Discworld #3",
    "the series text pairs name and index")
assertEqual(CatalogDetail.detailSeriesText({ seriesName = "Discworld" }), "Discworld",
    "a series with no index shows just the name")
assertEqual(CatalogDetail.detailSeriesText({ seriesIndex = 3 }), nil, "an index without a name is not a series line")
assertEqual(CatalogDetail.detailSeriesLine({ seriesName = "Discworld", seriesIndex = 3 }), "Discworld #3  \u{203A}",
    "the hero line carries the tap chevron")
assertEqual(CatalogDetail.detailSeriesLine({}), nil, "no series means no hero line")

-- Series navigation params

local by_id = CatalogDetail.detailSeriesParams({ seriesId = 12, seriesName = "Discworld" })
assertEqual(by_id.seriesId, 12, "a series id drives the books context")
assertEqual(by_id.sort, "series", "a series list sorts by series order")
local by_name = CatalogDetail.detailSeriesParams({ seriesName = "Discworld" })
assertEqual(by_name.series, "Discworld", "without an id the name drives the context")
assertEqual(by_name.seriesId, nil, "no id is invented")
assertEqual(CatalogDetail.detailSeriesParams({}), nil, "a book with no series has no context")

-- Book info rows

local full = {
    seriesId = 12,
    seriesName = "Discworld",
    seriesIndex = 3.0,
    publisher = "Gollancz",
    publishedDate = "1987-06-01T00:00:00.000Z",
    publishedYear = 1987,
    language = "en",
    isbn13 = "9780552131056",
    isbn10 = "0552131059",
    pageCount = 285,
    libraryName = "Fiction",
    collections = { { id = 1, name = "Favourites" }, { id = 2, name = "To reread" } },
    files = {
        { id = 1, format = "epub", sizeBytes = 2411724 },
        { id = 2, format = "m4b", sizeBytes = nil, durationSeconds = 7200 },
    },
    addedAt = "2026-02-14T09:30:00.000Z",
    -- Deliberately excluded: already on the page or in existing viewers.
    genres = { "Fantasy" },
    tags = { "funny" },
    rating = 5,
    readStatus = "read",
    description = "A book.",
    subtitle = "A Discworld Novel",
}

local rows = CatalogDetail.bookInfoRows(full)
assertEqual(rowValue(rows, "Series"), "Discworld #3", "series row carries name and trimmed index")
assertEqual(rows[1].key, "Series", "series leads the sheet")
assertEqual(rows[1].series_params.seriesId, 12, "the series row is tappable")
assertEqual(rows[1].series_title, "Discworld", "the series row names the list it opens")
assertEqual(rowValue(rows, "Publisher"), "Gollancz", "publisher is shown")
assertEqual(rowValue(rows, "Published"), "1987-06-01", "an ISO timestamp is reduced to its date")
assertEqual(rowValue(rows, "Language"), "en", "language is shown")
assertEqual(rowValue(rows, "ISBN-13"), "9780552131056", "isbn13 is shown")
assertEqual(rowValue(rows, "ISBN-10"), "0552131059", "isbn10 is shown")
assertEqual(rowValue(rows, "Pages"), "285", "page count is shown")
assertEqual(rowValue(rows, "Library"), "Fiction", "library is shown")
assertEqual(rowValue(rows, "Collections"), "Favourites, To reread", "collections are comma joined")
assertEqual(rowCount(rows, "File"), 2, "one row per file")
assertEqual(rows[10].value, "EPUB - 2.3 MB", "a file row shows format and size")
assertEqual(rows[11].value, "M4B - 2 h", "a sizeless audio file falls back to its duration")
assertEqual(rowValue(rows, "Added"), "2026-02-14", "added date is reduced to its date")
assertEqual(rowValue(rows, "Genres"), nil, "genres stay off the sheet")
assertEqual(rowValue(rows, "Tags"), nil, "tags stay off the sheet")
assertEqual(rowValue(rows, "Rating"), nil, "rating stays off the sheet")
assertEqual(rowValue(rows, "Subtitle"), nil, "subtitle stays off the page and the sheet")

-- Null skipping

local sparse = CatalogDetail.bookInfoRows({ libraryName = "Fiction" })
assertEqual(#sparse, 1, "rows without a value are skipped entirely")
assertEqual(sparse[1].key, "Library", "the one known value survives")
assertEqual(#CatalogDetail.bookInfoRows({}), 0, "a book with no metadata collapses to nothing")
assertEqual(#CatalogDetail.bookInfoRows(nil), 0, "a missing detail collapses to nothing")

-- publishedYear is the fallback when there is no full date, and an unexpected
-- date string is shown verbatim rather than dropped.
assertEqual(rowValue(CatalogDetail.bookInfoRows({ publishedYear = 1987 }), "Published"), "1987",
    "the year stands in for a missing date")
assertEqual(rowValue(CatalogDetail.bookInfoRows({ publishedDate = "Spring 1987" }), "Published"), "Spring 1987",
    "an unparsable date is display-only, not dropped")

-- A file with neither size nor duration still names its format.
assertEqual(rowValue(CatalogDetail.bookInfoRows({ files = { { format = "cbz" } } }), "File"), "CBZ",
    "a file with no size still lists its format")

-- Download button label

local menu = { nextDownloadFile = function(_, files) return files[1] end }
setmetatable(menu, { __index = CatalogDetail })

assertEqual(menu:downloadButtonLabel({}), "No supported format", "no supported file says so")
assertEqual(menu:downloadButtonLabel({ { format = "epub", sizeBytes = 2411724 } }), "Download EPUB - 2.3 MB",
    "the button carries the format and the size")
assertEqual(menu:downloadButtonLabel({ { format = "epub" } }), "Download (EPUB)",
    "an unknown size leaves the original label untouched")

-- Hero series line
--
-- Asserted through buildDetailHeader rather than against the helper directly:
-- the helper is a plain function, and the header used to call it as a method,
-- which passed the catalog as the detail and silently dropped the line from
-- every book page. Only the real call path catches that.

local header_menu = setmetatable({
    available_height = 800,
    inner_dimen = { w = 600, h = 900 },
    on_device = {},
    current_context = { supported_files = {} },
}, { __index = CatalogDetail })
function header_menu:thumbnailDisplay() return nil, "failed" end
function header_menu:isOnDevice() return false end
function header_menu:readStatusLabel() return nil end
function header_menu:supportedFiles() return {} end
function header_menu:onDeviceFilePath() return nil end
function header_menu:downloadButtonLabel() return "Download" end

header_menu:buildDetailHeader({
    title = "The Left Hand of Darkness",
    authors = { "Ursula K. Le Guin" },
    seriesName = "Hainish Cycle",
    seriesIndex = 4,
}, 600)
assertEqual(header_menu.detail_series_line ~= nil, true,
    "a book in a series renders its hero series line")

header_menu:buildDetailHeader({ title = "Standalone", authors = { "Someone" } }, 600)
assertEqual(header_menu.detail_series_line, nil,
    "a book with no series renders no series line")

print("bookorbit_detail_info_rows_test.lua: ok")
