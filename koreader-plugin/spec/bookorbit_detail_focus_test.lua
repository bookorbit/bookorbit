-- The book detail page's rules, checked without a screen: what the page
-- says about a book (series, files, action, shelves, authors, pager) comes
-- from pure functions in bookorbit_detail_data, and the page's D-pad layout
-- from the rows the view hands back.

local function identity(value) return value end

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;koreader-plugin/spec/?.lua;" .. package.path

package.loaded["document/documentregistry"] = { hasProvider = function() return true end }
package.loaded["util"] = {
    trim = function(value) return tostring(value or ""):match("^%s*(.-)%s*$") end,
    fixUtf8 = function(value) return value end,
    htmlToPlainTextIfHtml = identity,
}
package.loaded["ffi/util"] = {
    template = function(pattern, ...)
        local args = { ... }
        return (pattern:gsub("%%(%d)", function(i) return tostring(args[tonumber(i)]) end))
    end,
}
package.loaded["gettext"] = setmetatable({}, { __call = function(_, value) return value end })

local DetailData = require("bookorbit_detail_data")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)), 2)
    end
end

-- ---------------------------------------------------------------- series

local function members(list)
    local out = {}
    for _, m in ipairs(list) do table.insert(out, { id = m[1], seriesIndex = m[2], readStatus = m[3], title = m[4] or ("Book " .. tostring(m[2])) }) end
    return out
end

local hp = {
    id = 133, title = "Prisoner of Azkaban", seriesName = "Harry Potter", seriesIndex = "3", readStatus = "reading",
    seriesMembers = members({ { 131, "1", nil }, { 128, "2", "read" }, { 133, "3", "reading" }, { 130, "4", nil }, { 132, "5", "read" } }),
}
local s = DetailData.series(hp)
assertEqual(s.total, 5, "every member is on the path, this book included")
assertEqual(s.books[s.current].id, 133, "this book sits at its index")
assertEqual(s.read, 2, "read members are counted")
assertEqual(s.next.id, 130, "next is the first unread book after this one")
assertEqual(s.complete, true, "a run 1..N held in full is complete")
assertEqual(DetailData.kicker(hp, s), "Book 3 of 5 · Harry Potter", "a complete run says of N")

-- Gaps, duplicates and a missing index: no "of N", and the unindexed book
-- sorts last.
local re = {
    id = 336, seriesName = "Resident Evil", seriesIndex = "3",
    seriesMembers = members({ { 232, "0", "read" }, { 233, "1" }, { 234, "2" }, { 335, "2" }, { 336, "3" }, { 334, nil } }),
}
local rs = DetailData.series(re)
assertEqual(rs.complete, false, "duplicates and a book 0 make the run incomplete")
assertEqual(DetailData.kicker(re, rs), "Book 3 · Resident Evil", "an incomplete run drops the count")
assertEqual(rs.books[#rs.books].id, 334, "a book without an index goes last")

-- Older servers send no member list: the capped related shelf stands in.
local legacy = {
    id = 133, seriesName = "Harry Potter", seriesIndex = "3",
    relatedSections = { { id = "series", books = { { id = 131, seriesIndex = "1" }, { id = 128, seriesIndex = "2" } } } },
}
assertEqual(DetailData.series(legacy).total, 3, "the related shelf builds the path on an older server")

-- One book of a series in the library gets no path, and the kicker keeps
-- its index.
local alone = { id = 470, seriesName = "The Poppy War", seriesIndex = 1, seriesMembers = members({ { 470, "1" } }) }
assertEqual(DetailData.series(alone), nil, "a lone series book has no path")
assertEqual(DetailData.kicker(alone, nil), "Book 1 · The Poppy War", "but still names its place")
assertEqual(DetailData.kicker({ seriesName = "Discworld" }, nil), "Discworld", "no index, just the name")
assertEqual(DetailData.kicker({}, nil), nil, "no series, no kicker")

-- ---------------------------------------------------------------- files

local function opens(fmt) return fmt == "epub" or fmt == "mobi" or fmt == "cbz" end
local usable, other = DetailData.files({ files = {
    { format = "m4b", role = "content", sizeBytes = 166191619, durationSeconds = 20927 },
    { format = "epub", role = "content", downloadVariant = "audioless_epub", sourceMediaOverlayAvailable = false, sizeBytes = nil, sourceSizeBytes = 312287 },
    { format = "epub", role = "primary", downloadVariant = "audioless_epub", sourceMediaOverlayAvailable = true, sizeBytes = nil, sourceSizeBytes = 166558581 },
    { format = "azw3", role = "content", sizeBytes = 680287 },
} }, { opens = opens })
assertEqual(#usable, 2, "the two EPUBs are usable")
assertEqual(usable[1].file.role, "primary", "the primary file leads")
assertEqual(usable[1].title, "Read-along edition", "an EPUB with narration is the read-along edition")
assertEqual(usable[1].text_only, true, "delivered without its narration")
assertEqual(usable[1].size, nil, "its stored size includes the audio, so none is shown")
assertEqual(usable[2].title, "Another edition", "a second EPUB is another edition")
assertEqual(usable[2].read_along, false, "a plain EPUB is never called read-along")
assertEqual(usable[2].size, "305 KB", "and shows the stored file's size")
assertEqual(#other, 2, "audio and formats KOReader cannot open are listed apart")
assertEqual(other[1].audio, true, "the M4B is audio")
assertEqual(other[2].opens, false, "the AZW3 cannot be opened")
assertEqual(DetailData.fileSubs(usable[1])[1], "Text only here; narration plays in BookOrbit", "the read-along explains itself")

-- The main file is the first this reader can open, so a primary it cannot use
-- never leaves the ebook it can labelled as a spare.
local function titles(entries)
    local out = {}
    for _, entry in ipairs(entries) do table.insert(out, entry.title) end
    return table.concat(out, ", ")
end
local audio_primary, audio_rest = DetailData.files({ files = {
    { format = "epub", role = "content" },
    { format = "m4b", role = "primary", durationSeconds = 3600 },
} }, { opens = opens })
assertEqual(titles(audio_primary), "Main file", "the only ebook beside an audiobook primary is the main file")
assertEqual(titles(audio_rest), "Audiobook", "the audiobook primary is listed apart")
assertEqual(titles((DetailData.files({ files = {
    { format = "mp3", role = "primary" },
    { format = "epub", role = "content" },
    { format = "epub", role = "content" },
} }, { opens = opens }))), "Main edition, Another edition", "two editions behind an audiobook primary still lead with one")
assertEqual(titles((DetailData.files({ files = {
    { format = "azw3", role = "primary" },
    { format = "epub", role = "content" },
} }, { opens = opens }))), "Main file", "a primary this reader cannot open hands the main file on")
assertEqual(titles((DetailData.files({ files = {
    { format = "mobi", role = "content" },
    { format = "epub", role = "primary" },
} }, { opens = opens }))), "Main file, Also available", "a primary this reader opens stays the main file")

-- --------------------------------------------------------------- action

local download = DetailData.primary({}, usable, other)
assertEqual(download.kind, "download", "a book not on the device downloads")
assertEqual(download.labels[1], "Download EPUB", "two usable files put the format in the label; a read-along has no size")
assertEqual(download.labels[#download.labels], "Download", "with a bare fallback for a narrow button")
local sized = DetailData.primary({}, { usable[2], usable[2] }, {})
assertEqual(sized.labels[1], "Download EPUB · 305 KB", "a known size rides the label too")
local single = DetailData.primary({}, { usable[2] }, {})
assertEqual(single.labels[1], "Download · 305 KB", "one usable file needs no format")
assertEqual(DetailData.primary({ on_device = true, pct = 34 }, usable, other).kind, "continue", "a started book continues")
assertEqual(DetailData.primary({ on_device = true, pct = 0 }, usable, other).kind, "start", "an untouched book starts")
assertEqual(DetailData.primary({ on_device = true, status = "read", pct = 100 }, usable, other).kind, "again", "a finished book reads again")
assertEqual(DetailData.primary({ offline = true }, usable, other).kind, "offline", "offline cannot download")
local audio_only = DetailData.primary({}, {}, { { audio = true } })
assertEqual(audio_only.labels[1], "Audiobook · listen in BookOrbit", "an audiobook-only book points to BookOrbit")
assertEqual(DetailData.primary({}, {}, { { audio = false } }).labels[1], "No file KOReader can open", "nothing usable says so")
assertEqual(DetailData.primary({ downloading = { pct = 46, sub = "212 KB of 460 KB" } }, usable, other).kind, "downloading",
    "a download in progress fills the button")

-- -------------------------------------------------------------- shelves

local detail = {
    id = 1, genres = { "Fantasy" }, tags = {},
    relatedSections = {
        { id = "series", books = { { id = 2 }, { id = 3 } } },
        { id = "author", books = { { id = 2 }, { id = 4 }, { id = 1 } } },
        { id = "similar", books = { { id = 3 }, { id = 4 }, { id = 5 } } },
    },
}
local shelves = DetailData.shelves(detail)
assertEqual(#shelves.author, 1, "the author shelf drops series books and the book itself")
assertEqual(shelves.author[1].id, 4, "keeping the author's other book")
assertEqual(#shelves.similar, 1, "the similar shelf drops what the others show")
assertEqual(DetailData.mainShelf(detail, shelves, "Author").kind, "similar", "a tagged book shows similar books")
local untagged = { id = 1, genres = {}, tags = {}, relatedSections = detail.relatedSections }
local fallback = DetailData.mainShelf(untagged, DetailData.shelves(untagged), "R. F. Kuang")
assertEqual(fallback.kind, "author", "an untagged book shows the author's other books instead")
assertEqual(fallback.label, "More by R. F. Kuang", "named after the author")
local shelf, tabs = DetailData.mainShelf(detail, shelves, "Author")
assertEqual(#tabs, 2, "a tagged book with other books by its author offers both as tabs")
assertEqual(tabs[1].kind .. "," .. tabs[2].kind, "similar,author", "Similar books first")
assertEqual(shelf.kind, "similar", "and shown first")
assertEqual(DetailData.mainShelf(detail, shelves, "Author", "author").kind, "author", "the chosen tab is the one shown")
assertEqual(DetailData.mainShelf(detail, shelves, "Author", "series").kind, "similar", "an unknown choice falls back to the first")
local _only, one = DetailData.mainShelf(untagged, DetailData.shelves(untagged), "R. F. Kuang")
assertEqual(#one, 1, "an untagged book has the author's shelf alone, no tabs")
assertEqual(tabs[2].short, "More by this author", "the author tab has a short label for long names")

-- ------------------------------------------------------------- authors

local lines = DetailData.authorLines({ "James Harren", "Frank Tieri", "Nick Dragotta", "Meredith McClaren", "A", "B" })
assertEqual(lines[1], "James Harren, Frank Tieri, Nick Dragotta, Meredith McClaren, A, B", "all authors first")
assertEqual(lines[2], "James Harren, Frank Tieri and 4 more", "then two and a count")
assertEqual(lines[3], "James Harren and 5 more", "then one and a count")
assertEqual(#DetailData.authorLines({}), 0, "no authors, no lines")

local chips = DetailData.chips({ authors = { "Colleen Hoover" }, genres = { "Fiction", "fiction", "Colleen Hoover" }, tags = { "Thriller" } })
assertEqual(#chips, 2, "repeats and the author's own name are dropped")
assertEqual(chips[2], "Thriller", "tags follow genres")

-- ---------------------------------------------------------------- pager

local titles = { "Harry Potter and the Sorcerer's Stone", "Harry Potter and the Chamber of Secrets", "Harry Potter and the Goblet of Fire" }
assertEqual(DetailData.pagerTitle(titles[2], titles), "Chamber of Secrets", "the shared lead words are dropped")
assertEqual(DetailData.pagerTitle("Verity", { "Verity", "Frankenstein" }), "Verity", "unrelated titles stay whole")
local pager = DetailData.pager({ label = "Harry Potter", index = 2, total = 7, titles = titles, has_prev = true, has_next = true,
    prev_title = titles[1], next_title = titles[3] })
assertEqual(pager.prev, "Sorcerer's Stone", "the pager names the previous book")
assertEqual(pager.next, "Goblet of Fire", "and the next")
assertEqual(DetailData.pager({ label = "x", index = 1, total = 1 }), nil, "a list of one has no pager")
assertEqual(DetailData.pager(nil), nil, "no list, no pager")

-- ------------------------------------------------------------ the text

assertEqual(DetailData.cleanDescription("<i>An alternative cover for this ASIN can be found <a href=\"x\">here</a></i><br /><br />Harry"),
    "Harry", "the Goodreads alternative-cover line is dropped")
assertEqual(DetailData.excerpt("One.\n\nTwo."), "One. Two.", "the excerpt runs paragraphs together")
assertEqual(DetailData.seriesIndexText("3.0"), "3", "a trailing .0 is trimmed")

local progress = DetailData.progress({ progressPercentage = 73.4561, pageCount = 547, readStatus = "reading" },
    { minutes_left = 234, per_day = 25, day = "Tuesday", date = "20 Oct" })
assertEqual(progress.label, "73%", "the percentage is rounded")
assertEqual(progress.page_short, "402 / 547 pages", "pages come from the page count")
assertEqual(progress.left, "3 h 54 min left", "time left comes from the forecast")
assertEqual(progress.finish.day, "Tuesday", "and the finish day")
assertEqual(DetailData.progress({ progressPercentage = 0 }), nil, "an unstarted book has no progress")

local path = DetailData.readingPath({ first_read = os.time() - 2 * 86400,
    path = { { day = os.date("%Y-%m-%d", os.time() - 2 * 86400), page = 10, total = 100 }, { day = os.date("%Y-%m-%d"), page = 34, total = 100 } } }, os.time())
assertEqual(#path, 3, "one value per day since the book was started")
assertEqual(path[2], 10, "a day without reading carries the last value")
assertEqual(path[3], 34, "and the path ends at today's page")

-- ------------------------------------------------------- the focus layout

-- The page hands back its controls as rows, top to bottom. With a sheet open
-- the cursor moves only through the sheet; otherwise never into it, and it
-- opens on the action row.
package.loaded["ui/widget/buttondialog"] = {}
package.loaded["ui/widget/infomessage"] = {}
package.loaded["ui/widget/keyvaluepage"] = {}
package.loaded["ui/network/manager"] = { isConnected = function() return true end }
package.loaded["ui/widget/textviewer"] = {}
package.loaded["ui/uimanager"] = { scheduleIn = function() end, unschedule = function() end, setDirty = function() end }
package.loaded["ui/geometry"] = { new = function(_, o) return o end }
package.loaded["bookorbit_delivery"] = {}
local rows_out = {
    { id = "header", "back", "menu" }, { id = "jacket", "kicker" }, { id = "verdict", "s1", "s2" }, { id = "actions", "primary", "details" },
    { id = "series", "n1" }, { id = "shelf", "c1", "c2" }, { id = "pager", "prev", "next" },
    { id = "sheet-head", "close" }, { id = "sheet-stars", "1", "2" }, { id = "menu-1", "read" },
}
package.loaded["bookorbit_detail_view"] = {
    build = function() return {}, rows_out, {} end,
}
local CatalogDetail = require("bookorbit_catalog_detail")
local function layoutFor(sheet)
    local catalog = setmetatable({
        current_context = { detail = { id = 1 }, detail_sheet = sheet },
        item_group = {}, inner_dimen = { w = 600 }, available_height = 800,
    }, { __index = CatalogDetail })
    catalog.prepareCustomUpdate = function(self) self.layout = {} end
    catalog.finishCustomUpdate = function() end
    catalog.ensureOnDeviceCurrent = function() end
    catalog.scheduleThumbnailDownloads = function() end
    catalog.detailMenuItems = function() return {} end
    catalog.detailScheduleClock = function() end
    local real = DetailData.build
    DetailData.build = function() return { usable = {}, other = {} } end
    catalog:updateDetailItems()
    DetailData.build = real
    return catalog.layout
end
local page = layoutFor(nil)
assertEqual(#page, 7, "the page's rows, without the sheet's")
assertEqual(page[4].id, "actions", "the action row keeps its place")
assertEqual(page[4].is_primary, true, "and the cursor opens there")
local sheet = layoutFor("verdict")
assertEqual(#sheet, 3, "with a sheet open only its rows remain")
assertEqual(sheet[1].id, "sheet-head", "starting at its close button")

print("bookorbit_detail_focus_test.lua: ok")
