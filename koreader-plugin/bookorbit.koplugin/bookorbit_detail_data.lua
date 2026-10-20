--[[--
The book detail page's view model.

Everything the page draws comes from here: the server's detail payload plus
what only this device knows (the file on it, KOReader's reading statistics,
the sidecar's highlights, the list the page was opened from). The rules are
pure functions over plain tables so the specs can check them without a
screen; DetailData.build gathers their inputs from the catalog.
]]

local T = require("ffi/util").template
local _ = require("gettext")

local CatalogUtil = require("bookorbit_catalog_util")

local DetailData = {}

local DAY = 86400

-- Formats that are audio, not text: listed, never offered for KOReader.
local AUDIO_FORMATS = { m4b = true, mp3 = true, m4a = true, aac = true, flac = true, ogg = true, opus = true }

-- ------------------------------------------------------------ text helpers

local function trim(value)
    if type(value) ~= "string" then return nil end
    local text = value:gsub("^%s+", ""):gsub("%s+$", "")
    return text ~= "" and text or nil
end

-- The plugin's HTML cleanup, then the Goodreads "alternative cover" line
-- some imports open with.
function DetailData.cleanDescription(text)
    local cleaned = CatalogUtil.cleanDescriptionText(text)
    if not cleaned then return nil end
    cleaned = cleaned:gsub("^[Aa]n alternative cover for this ASIN can be found here%.?%s*", "")
    return trim(cleaned)
end

-- The main page runs paragraphs together: a clamped excerpt should not spend
-- a line on a paragraph break.
function DetailData.excerpt(description)
    if not description then return nil end
    return (description:gsub("%s*\n+%s*", " "))
end

-- A trailing ".0" is noise on a series index: 3, not 3.0.
function DetailData.seriesIndexText(index)
    local value = tonumber(index)
    if not value then return nil end
    if value == math.floor(value) then return tostring(math.floor(value)) end
    local text = string.format("%.2f", value):gsub("0+$", ""):gsub("%.$", "")
    return text
end

-- Genres then tags, without repeats (any case) and without an author's own
-- name, which some sources file as a genre.
function DetailData.chips(detail)
    local seen, out = {}, {}
    local authors = {}
    for _i, author in ipairs(detail.authors or {}) do
        if type(author) == "string" then authors[author:lower()] = true end
    end
    for _i, list in ipairs({ detail.genres or {}, detail.tags or {} }) do
        for _j, value in ipairs(list) do
            local text = trim(value)
            local key = text and text:lower()
            if key and not seen[key] and not authors[key] then
                seen[key] = true
                table.insert(out, text)
            end
        end
    end
    return out
end

-- The words every title in a list shares ("Harry Potter and the ...") are
-- dropped when the pager names a neighbour.
function DetailData.pagerTitle(title, titles)
    if type(title) ~= "string" then return nil end
    local words = {}
    for _i, t in ipairs(titles or {}) do
        if type(t) == "string" then
            local w = {}
            for word in t:gmatch("%S+") do table.insert(w, word) end
            table.insert(words, w)
        end
    end
    if #words < 2 then return title end
    local k = 0
    while true do
        local word = words[1][k + 1]
        if not word or k + 1 >= #words[1] then break end
        local all = true
        for _i, w in ipairs(words) do
            if w[k + 1] ~= word or k + 1 >= #w then all = false; break end
        end
        if not all then break end
        k = k + 1
    end
    if k < 2 then return title end
    local out = {}
    local index = 0
    for word in title:gmatch("%S+") do
        index = index + 1
        if index > k then table.insert(out, word) end
    end
    return #out > 0 and table.concat(out, " ") or title
end

-- ------------------------------------------------------------------ files

-- What each file is and whether KOReader can use it. Read-along is named only
-- when the source EPUB really carries narration; the audioless delivery of a
-- plain EPUB is just the EPUB.
-- opts: opens(format) -> bool, local_size(file) -> bytes on this device or nil,
-- on_device(file) -> bool.
function DetailData.files(detail, opts)
    opts = opts or {}
    local list = {}
    for _i, file in ipairs(detail.files or {}) do table.insert(list, file) end
    table.sort(list, function(a, b)
        local pa, pb = a.role == "primary" and 0 or 1, b.role == "primary" and 0 or 1
        if pa ~= pb then return pa < pb end
        return false
    end)
    local by_format, opens_at = {}, {}
    -- The main file is the first one this reader can open: the primary when it
    -- can, so a book whose primary is an audiobook leads with its ebook.
    local main
    for i, file in ipairs(list) do
        local fmt = string.lower(file.format or "")
        by_format[fmt] = (by_format[fmt] or 0) + 1
        opens_at[i] = AUDIO_FORMATS[fmt] ~= true and (opts.opens == nil or opts.opens(fmt) == true)
        if main == nil and opens_at[i] then main = file end
    end
    local usable, other = {}, {}
    for i, file in ipairs(list) do
        local fmt = string.lower(file.format or "")
        local audio = AUDIO_FORMATS[fmt] == true
        local opens = opens_at[i]
        local read_along = fmt == "epub" and file.sourceMediaOverlayAvailable == true
        local text_only = read_along and file.downloadVariant == "audioless_epub"
        local on_device = opts.on_device ~= nil and opts.on_device(file) == true
        local bytes = file.sizeBytes
        -- The audioless delivery of a plain EPUB is the same book; its source
        -- size is a fair size to show (never for a read-along, whose source
        -- carries the narration).
        if bytes == nil and not read_along then bytes = file.sourceSizeBytes end
        if on_device and opts.local_size then bytes = opts.local_size(file) or bytes end
        local title
        if audio then title = _("Audiobook")
        elseif read_along then title = _("Read-along edition")
        elseif not opens then title = T(_("%1 file"), fmt:upper())
        elseif by_format[fmt] > 1 then title = file == main and _("Main edition") or _("Another edition")
        elseif file == main then title = _("Main file")
        else title = _("Also available") end
        local entry = {
            file = file,
            format = fmt:upper(),
            title = title,
            audio = audio,
            opens = opens,
            read_along = read_along,
            text_only = text_only,
            on_device = on_device,
            size = bytes and CatalogUtil.formatBytes(bytes) or nil,
            duration = CatalogUtil.formatDuration(file.durationSeconds),
        }
        if opens then table.insert(usable, entry) else table.insert(other, entry) end
    end
    return usable, other
end

-- The sub-line under a file row, longest first; the view keeps the first
-- that fits.
function DetailData.fileSubs(entry)
    local function join(...)
        local parts = {}
        for i = 1, select("#", ...) do
            local v = select(i, ...)
            if v and v ~= "" then table.insert(parts, v) end
        end
        return table.concat(parts, " · ")
    end
    if entry.read_along and entry.text_only then
        return {
            join(entry.size, _("Text only here; narration plays in BookOrbit")),
            join(entry.size, _("Text only; narration in BookOrbit")),
            join(entry.size, _("Text only")),
        }
    end
    if entry.read_along then
        return { join(entry.size, _("With narration")), join(entry.size) }
    end
    return { join(entry.size) }
end

-- The one line naming files KOReader cannot use, longest first.
function DetailData.otherFilesSubs(other)
    local long, short = {}, {}
    for _i, entry in ipairs(other) do
        if entry.audio then
            table.insert(long, entry.duration and T(_("audiobook, %1"), entry.duration) or _("audiobook"))
            table.insert(short, _("audiobook"))
        else
            table.insert(long, T(_("%1 format"), entry.format))
            table.insert(short, entry.format)
        end
    end
    return {
        T(_("Not for KOReader: %1. In BookOrbit."), table.concat(long, "; ")),
        T(_("Not for KOReader: %1"), table.concat(long, "; ")),
        T(_("Not for KOReader: %1"), table.concat(short, ", ")),
        _("Not for KOReader"),
    }
end

-- --------------------------------------------------------------- shelves

-- Shelves never repeat a book: the author shelf drops series books, the
-- similar shelf drops both, and none shows the book itself.
function DetailData.shelves(detail)
    local by_id = {}
    for _i, section in ipairs(detail.relatedSections or {}) do
        if type(section) == "table" and section.id and type(section.books) == "table" then
            by_id[section.id] = section.books
        end
    end
    local seen = { [detail.id or -1] = true }
    local out = {}
    for _i, id in ipairs({ "series", "author", "similar" }) do
        local list = {}
        for _j, book in ipairs(by_id[id] or {}) do
            if book.id and not seen[book.id] then
                seen[book.id] = true
                table.insert(list, book)
            end
        end
        out[id] = list
    end
    return out
end

-- Similar books are scored mostly on genres and tags; a book with neither
-- gets an arbitrary list, so it gets no shelf.
function DetailData.similarFor(detail, shelves)
    local tagged = #(detail.genres or {}) + #(detail.tags or {}) > 0
    if not tagged or #(shelves.similar or {}) == 0 then return nil end
    return shelves.similar
end

-- The main page's shelves, as tabs: Similar books for a tagged book, then
-- the author's other books (series books dropped). short is the author tab's
-- label when the name does not fit.
function DetailData.shelfTabs(detail, shelves, author)
    local tabs = {}
    local similar = DetailData.similarFor(detail, shelves)
    if similar then table.insert(tabs, { kind = "similar", label = _("Similar books"), books = similar }) end
    if #(shelves.author or {}) > 0 and author then
        table.insert(tabs, { kind = "author", label = T(_("More by %1"), author), short = _("More by this author"), books = shelves.author })
    end
    return tabs
end

-- The shelf the main page shows: the chosen tab, else the first. Returns the
-- shelf and every tab.
function DetailData.mainShelf(detail, shelves, author, chosen)
    local tabs = DetailData.shelfTabs(detail, shelves, author)
    for _i, tab in ipairs(tabs) do
        if tab.kind == chosen then return tab, tabs end
    end
    return tabs[1], tabs
end

-- The series path: every book of the series with this one in place, by
-- index; the next one is the first after this one not yet read.
function DetailData.series(detail)
    if not trim(detail.seriesName) then return nil end
    local books = {}
    -- The full list when the server sends it; the capped related shelf
    -- otherwise (older servers).
    local members = type(detail.seriesMembers) == "table" and detail.seriesMembers or nil
    if not members then
        members = {}
        for _i, section in ipairs(detail.relatedSections or {}) do
            if section.id == "series" then
                for _j, book in ipairs(section.books or {}) do table.insert(members, book) end
            end
        end
    end
    for _i, book in ipairs(members) do
        if book.id ~= detail.id then
            table.insert(books, { id = book.id, title = book.title, index = DetailData.seriesIndexText(book.seriesIndex),
                sort = tonumber(book.seriesIndex), status = book.readStatus, book = book })
        end
    end
    table.insert(books, { id = detail.id, title = detail.title, index = DetailData.seriesIndexText(detail.seriesIndex),
        sort = tonumber(detail.seriesIndex), status = detail.readStatus, current = true, pct = tonumber(detail.progressPercentage) })
    table.sort(books, function(a, b)
        local sa, sb = a.sort or math.huge, b.sort or math.huge
        if sa ~= sb then return sa < sb end
        return (a.id or 0) < (b.id or 0)
    end)
    local current, read = nil, 0
    for index, book in ipairs(books) do
        if book.current then current = index end
        if book.status == "read" then read = read + 1 end
    end
    local next_book
    for index = (current or 0) + 1, #books do
        if books[index].status ~= "read" then next_book = books[index]; break end
    end
    -- Only a series this library holds more than this one book of gets a path.
    if #books < 2 then return nil end
    -- "Book 3 of 7" only when the library holds the whole run 1..N, each once.
    local complete = true
    for index, book in ipairs(books) do
        if book.sort ~= index then complete = false; break end
    end
    return { name = trim(detail.seriesName), books = books, current = current, total = #books, read = read, next = next_book, complete = complete }
end

-- "Book 3 of 7 · Harry Potter", "Book 18 · Absolute Batman", or the series
-- name alone when the book has no index.
function DetailData.kicker(detail, series)
    local name = trim(detail.seriesName)
    if not name then return nil end
    local index = DetailData.seriesIndexText(detail.seriesIndex)
    if not index then return name end
    if series and series.complete then
        return T(_("Book %1 of %2 · %3"), index, series.total, name)
    end
    return T(_("Book %1 · %2"), index, name)
end

-- The author line, longest first: every author, the first two and a count,
-- the first and a count.
function DetailData.authorLines(authors)
    local list = {}
    for _i, a in ipairs(authors or {}) do
        local name = trim(a)
        if name then table.insert(list, name) end
    end
    if #list == 0 then return {} end
    local out = { table.concat(list, ", ") }
    if #list > 2 then table.insert(out, T(_("%1, %2 and %3 more"), list[1], list[2], #list - 2)) end
    if #list > 1 then table.insert(out, T(_("%1 and %2 more"), list[1], #list - 1)) end
    return out
end

-- ---------------------------------------------------------------- facts

local LANGUAGES = { en = "English", eng = "English", english = "English", ja = "Japanese", ["ja-jp"] = "Japanese",
    fr = "French", de = "German", es = "Spanish", it = "Italian", pt = "Portuguese", nl = "Dutch" }

function DetailData.languageName(code)
    local text = trim(code)
    if not text then return nil end
    return LANGUAGES[text:lower()] or text
end

local MONTHS = { "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec" }

-- "18 Jun 2013" from an ISO date or timestamp.
function DetailData.dateLabel(value, with_year)
    if type(value) ~= "string" then return nil end
    local y, m, d = value:match("^(%d%d%d%d)%-(%d%d)%-(%d%d)")
    if not y then return nil end
    local month = _(MONTHS[tonumber(m)] or m)
    if with_year == false then return T(_("%1 %2"), tonumber(d), month) end
    return T(_("%1 %2 %3"), tonumber(d), month, y)
end

-- The More details ledger: every field the payload has.
function DetailData.facts(detail)
    local rows = {}
    local function add(key, value)
        if value ~= nil and value ~= "" then table.insert(rows, { key, tostring(value) }) end
    end
    add(_("Published"), DetailData.dateLabel(detail.publishedDate) or detail.publishedYear)
    add(_("Publisher"), trim(detail.publisher))
    add(_("Pages"), detail.pageCount)
    add(_("Language"), DetailData.languageName(detail.language))
    add(_("ISBN"), trim(detail.isbn13) or trim(detail.isbn10))
    add(_("Library"), trim(detail.libraryName))
    add(_("Added"), DetailData.dateLabel(detail.addedAt))
    local names = {}
    for _i, collection in ipairs(detail.collections or {}) do
        local name = trim(collection.name)
        if name then table.insert(names, name) end
    end
    if #names > 0 then add(#names > 1 and _("Collections") or _("Collection"), table.concat(names, ", ")) end
    return rows
end

-- The key facts strip on the main page: year, pages, language and the file.
function DetailData.spec(detail, usable, other)
    local items = {}
    if detail.publishedYear then table.insert(items, { tostring(detail.publishedYear), _("Published") }) end
    if detail.pageCount then table.insert(items, { tostring(detail.pageCount), _("Pages") }) end
    local lang = DetailData.languageName(detail.language)
    if lang then table.insert(items, { lang, _("Language") }) end
    local file
    for _i, entry in ipairs(usable) do if entry.on_device then file = entry; break end end
    file = file or usable[1]
    if file then
        local value = file.size and (file.format .. " · " .. file.size) or file.format
        table.insert(items, { value, file.on_device and _("On this device") or _("Not downloaded") })
    elseif #other > 0 then
        local audio
        for _i, entry in ipairs(other) do if entry.audio then audio = entry; break end end
        if audio then
            table.insert(items, { audio.size and (audio.format .. " · " .. audio.size) or audio.format, _("Audiobook") })
        else
            table.insert(items, { _("None"), _("Readable file") })
        end
    end
    return items
end

-- ---------------------------------------------------------------- action

-- The page's one action, with shorter labels for narrow buttons.
-- state: on_device, status, pct, offline, downloading = { pct, done, total }.
function DetailData.primary(state, usable, other)
    if state.downloading then
        return { kind = "downloading", icon = "download", pct = state.downloading.pct, sub = state.downloading.sub }
    end
    if state.on_device then
        if state.status == "read" then
            return { kind = "again", icon = "rotate-ccw", labels = { _("Read again") } }
        elseif (state.pct or 0) > 0 then
            return { kind = "continue", icon = "play", labels = { _("Continue reading"), _("Continue") } }
        end
        return { kind = "start", icon = "book-open", labels = { _("Start reading"), _("Read") } }
    end
    local file = usable[1]
    if not file then
        for _i, entry in ipairs(other or {}) do
            if entry.audio then
                return { kind = "none", icon = "headphones", labels = { _("Audiobook · listen in BookOrbit"), _("Audiobook only") } }
            end
        end
        return { kind = "none", icon = "x", labels = { _("No file KOReader can open"), _("Unavailable") } }
    end
    if state.offline then return { kind = "offline", icon = "cloud-off", labels = { _("Download when online"), _("Offline") } } end
    -- The format rides the label only when there is a choice to make.
    local choice = #usable > 1
    local labels = {}
    if choice and file.size then table.insert(labels, T(_("Download %1 · %2"), file.format, file.size)) end
    if file.size then table.insert(labels, T(_("Download · %1"), file.size)) end
    if choice then table.insert(labels, T(_("Download %1"), file.format)) end
    table.insert(labels, _("Download"))
    return { kind = "download", icon = "download", labels = labels, entry = file }
end

-- ---------------------------------------------------------------- progress

local function fmtDuration(min)
    min = math.floor((min or 0) + 0.5)
    if min < 60 then return T(_("%1 min"), min) end
    local h, m = math.floor(min / 60), min % 60
    if m == 0 then return T(_("%1 h"), h) end
    return T(_("%1 h %2 min"), h, m)
end
DetailData.formatDuration = fmtDuration

local function fmtShort(min)
    min = math.floor((min or 0) + 0.5)
    if min < 60 then return T(_("%1m"), min) end
    local h, m = math.floor(min / 60), min % 60
    if m == 0 then return T(_("%1h"), h) end
    return T(_("%1h %2m"), h, m)
end
DetailData.formatShortDuration = fmtShort

function DetailData.pctLabel(pct)
    local p = tonumber(pct)
    if not p then return nil end
    if p > 0 and p < 0.5 then return "<1%" end
    if p < 100 and p >= 99.5 then return "99%" end
    return tostring(math.floor(p + 0.5)) .. "%"
end

-- Where you stand. forecast: { minutes_left, per_day, day, date } from the
-- device's statistics, or nil.
function DetailData.progress(detail, forecast)
    local p = tonumber(detail.progressPercentage)
    if not p or p <= 0 then return nil end
    local out = { pct = p, label = DetailData.pctLabel(p) }
    local pages = tonumber(detail.pageCount)
    if pages and pages > 0 then
        local at = math.floor(pages * p / 100 + 0.5)
        out.page = T(_("p. %1 of %2"), at, pages)
        out.page_short = T(_("%1 / %2 pages"), at, pages)
    end
    if forecast and forecast.minutes_left and detail.readStatus ~= "read" then
        out.left = T(_("%1 left"), fmtDuration(forecast.minutes_left))
        out.left_short = T(_("%1 left"), fmtShort(forecast.minutes_left))
        out.finish = { day = forecast.day, short = forecast.short, date = forecast.date, per_day = math.floor((forecast.per_day or 0) + 0.5) }
    end
    return out
end

-- The reading path: furthest percentage reached by each day from the first
-- read to today, carried over days without reading. At most `max_days`
-- values (the oldest days are folded together).
function DetailData.readingPath(journal, now, max_days)
    if not journal or not journal.first_read or #(journal.path or {}) == 0 then return nil end
    local by_day = {}
    for _i, entry in ipairs(journal.path) do
        local total = entry.total or 0
        if total > 0 then by_day[entry.day] = math.min(100, entry.page / total * 100) end
    end
    local start = journal.first_read
    local days = math.max(1, math.floor((now - start) / DAY) + 1)
    local values, best = {}, 0
    for i = 0, days - 1 do
        local key = os.date("%Y-%m-%d", start + i * DAY)
        if by_day[key] and by_day[key] > best then best = by_day[key] end
        table.insert(values, best)
    end
    max_days = max_days or 120
    if #values > max_days then
        local folded = {}
        local step = #values / max_days
        for i = 1, max_days do folded[i] = values[math.min(#values, math.floor(i * step))] end
        values = folded
    end
    return values
end

-- ---------------------------------------------------------------- pager

-- The list the page was opened from: the books around this one and where it
-- sits. list: { label, titles, index, total, prev_title, next_title }.
function DetailData.pager(list)
    if not list or not list.total or list.total < 2 or not list.index then return nil end
    return {
        label = list.label,
        index = list.index,
        total = list.total,
        prev = list.has_prev and (DetailData.pagerTitle(list.prev_title, list.titles) or _("Previous")) or nil,
        next = list.has_next and (DetailData.pagerTitle(list.next_title, list.titles) or _("Next")) or nil,
    }
end

-- ---------------------------------------------------------------- build

local STATUS_LABELS = CatalogUtil.READ_STATUS_LABELS

function DetailData.statusLabel(status)
    return STATUS_LABELS[status or "unread"] or STATUS_LABELS.unread or _("Unread")
end

local function relativeDay(t, now)
    local BoardData = require("bookorbit_board_data")
    return BoardData.relativeDay(os.date("!%Y-%m-%dT%H:%M:%SZ", t), now)
end

-- Highlights in the book's sidecar: how many, and the newest.
local function sidecarHighlights(path)
    if not path then return nil end
    local ok, result = pcall(function()
        local DocSettings = require("docsettings")
        if not DocSettings:hasSidecarFile(path) then return nil end
        local Sidecar = require("bookorbit_sidecar")
        local list = Sidecar.normalizeAnnotations(DocSettings:open(path):readSetting("annotations"))
        local items = {}
        for _i, a in ipairs(list) do
            if trim(a.text) then table.insert(items, a) end
        end
        if #items == 0 then return nil end
        table.sort(items, function(a, b) return (a.datetimeUpdated or a.datetime) > (b.datetimeUpdated or b.datetime) end)
        return { count = #items, items = items }
    end)
    return ok and result or nil
end
DetailData.sidecarHighlights = sidecarHighlights

local function highlightView(entry)
    if not entry then return nil end
    local when = entry.datetime and DetailData.dateLabel(entry.datetime:gsub(" ", "T"), false)
    return { text = trim(entry.text), chapter = trim(entry.chapter), note = trim(entry.note), when = when }
end
DetailData.highlightView = highlightView

-- Builds the page's model. catalog: the catalog controller; context: the
-- detail context; now: os.time().
function DetailData.build(catalog, context, now)
    now = now or os.time()
    local NetworkMgr = require("ui/network/manager")
    local datetime = require("datetime")
    local BoardData = require("bookorbit_board_data")
    local detail = context.detail or {}
    local d = { detail = detail, now = now }

    d.title = trim(detail.title) or _("Untitled")
    d.subtitle = trim(detail.subtitle)
    local authors = {}
    for _i, a in ipairs(detail.authors or {}) do if trim(a) then table.insert(authors, trim(a)) end end
    d.authors = #authors > 0 and table.concat(authors, ", ") or nil
    d.author_first = authors[1]
    d.status = detail.readStatus or "unread"
    d.status_label = DetailData.statusLabel(d.status)
    d.rating = tonumber(detail.rating) or 0
    d.pct = tonumber(detail.progressPercentage)
    d.pages = tonumber(detail.pageCount)
    d.description = DetailData.cleanDescription(detail.description)
    d.excerpt = DetailData.excerpt(d.description)
    d.chips = DetailData.chips(detail)
    d.facts = DetailData.facts(detail)
    d.online = NetworkMgr:isConnected()
    d.offline = context.stale == true or not d.online
    d.clock = datetime.secondsToHour(now, G_reader_settings:isTrue("twelve_hour_clock"))

    local path, state = catalog:thumbnailDisplay(detail)
    d.cover_path, d.cover_state = path, state

    d.read_path = catalog:detailReadPath(detail)
    d.on_device = d.read_path ~= nil
    local lfs = require("libs/libkoreader-lfs")
    d.usable, d.other = DetailData.files(detail, {
        opens = function(fmt) return CatalogUtil.isSupportedFormat(fmt) and true or false end,
        on_device = function(file) return catalog:onDeviceFilePath(file) ~= nil end,
        local_size = function(file)
            local local_path = catalog:onDeviceFilePath(file)
            return local_path and lfs.attributes(local_path, "size") or nil
        end,
    })
    d.spec = DetailData.spec(detail, d.usable, d.other)

    local shelves = DetailData.shelves(detail)
    d.similar = DetailData.similarFor(detail, shelves)
    for _i, list in ipairs({ shelves.series or {}, shelves.author or {}, d.similar or {} }) do
        for _j, book in ipairs(list) do
            local cover, cover_state = catalog:thumbnailDisplay(book)
            book.cover_path, book.cover_state = cover, cover_state
        end
    end
    d.series = DetailData.series(detail)
    d.kicker = DetailData.kicker(detail, d.series)
    d.author_lines = DetailData.authorLines(detail.authors)
    d.shelf, d.shelf_tabs = DetailData.mainShelf(detail, shelves, d.author_first, context.detail_shelf)

    -- What this device's statistics say about the book.
    local md5
    if d.read_path then
        catalog._board_md5 = catalog._board_md5 or {}
        md5 = catalog._board_md5[d.read_path]
        if md5 == nil then
            local ok, util = pcall(require, "util")
            md5 = ok and util.partialMD5 and util.partialMD5(d.read_path) or false
            catalog._board_md5[d.read_path] = md5
        end
        md5 = md5 or nil
    end
    local forecast = md5 and BoardData.forecast({ progressPercentage = d.pct }, md5, now) or nil
    d.progress = DetailData.progress(detail, forecast)
    local Stats = require("bookorbit_stats_reader")
    local journal = md5 and Stats.getBookJournal(md5) or nil
    if journal and journal.seconds > 0 then
        local pace_info = md5 and Stats.getBookPace(md5, 14) or nil
        local per_hour = pace_info and pace_info.seconds_per_page and pace_info.seconds_per_page > 0 and math.floor(3600 / pace_info.seconds_per_page + 0.5) or nil
        d.journal = {
            started = DetailData.dateLabel(os.date("%Y-%m-%d", journal.first_read), false),
            time = fmtDuration(journal.seconds / 60),
            time_short = fmtShort(journal.seconds / 60),
            days = journal.days,
            last_read = relativeDay(journal.last_read, now),
            pace = per_hour and T(_("%1 pages an hour"), per_hour) or nil,
            pace_short = per_hour and T(_("%1 p/h"), per_hour) or nil,
            path = DetailData.readingPath(journal, now, 120),
        }
    end
    if d.status == "read" then
        local finished = detail.lastReadAt and DetailData.dateLabel(detail.lastReadAt, false)
        d.finished = { date = finished, journal = d.journal }
        if d.journal then d.journal.finished_on = finished end
    elseif not d.progress and d.pages then
        local records = BoardData.records(now)
        local per_hour = records and records.pages_per_hour and records.pages_per_hour > 0 and records.pages_per_hour or nil
        d.not_started = { pages = d.pages, estimate = per_hour and fmtDuration(math.floor(d.pages / per_hour * 60 / 10 + 0.5) * 10) or nil }
    end

    local hl = d.read_path and sidecarHighlights(d.read_path) or nil
    d.highlights = hl and { count = hl.count, latest = highlightView(hl.items[1]), items = hl.items } or nil

    d.primary = DetailData.primary({
        on_device = d.on_device,
        status = d.status,
        pct = d.pct,
        offline = not d.online,
        downloading = context.downloading,
    }, d.usable, d.other)

    d.pager = DetailData.pager(catalog:detailListPosition())
    d.back = context.back_label
    return d
end

return DetailData
