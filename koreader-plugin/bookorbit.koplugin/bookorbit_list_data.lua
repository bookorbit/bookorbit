--[[--
View-model rules for the list pages: books, authors, series and shelves.

Pure functions over catalog payloads. Nothing here builds a widget or reads
the screen, so the rules the pages follow (what a status cell says, how a
caption steps down, how a series counts) are tested without KOReader.
]]

local T = require("ffi/util").template
local _ = require("gettext")

local BoardData = require("bookorbit_board_data")

local ListData = {}

local READING = { reading = true, rereading = true }
local FINISHED = { read = true, skimmed = true }

-- Where a book stands for this reader: finished, reading, want, paused,
-- abandoned or unread. A progress strictly between 0 and 100 without a status
-- counts as reading, as it does on the home page.
function ListData.stateOf(book)
    local status = book and book.readStatus
    if FINISHED[status] then return "finished" end
    if READING[status] then return "reading" end
    if status == "want_to_read" then return "want" end
    if status == "on_hold" then return "paused" end
    if status == "abandoned" then return "abandoned" end
    local p = tonumber(book and book.progressPercentage)
    if p and p > 0 and p < 100 then return "reading" end
    return "unread"
end

-- 34%, <1% for a started book, never 100% before it is finished.
function ListData.pctLabel(book)
    local p = tonumber(book and book.progressPercentage)
    if not p then return nil end
    if p > 0 and p < 0.5 then return "<1%" end
    if p < 100 and p >= 99.5 then return "99%" end
    return tostring(math.floor(p + 0.5)) .. "%"
end

function ListData.plural(n, one, many)
    if n == 1 then return T(one, n) end
    return T(many, n)
end

function ListData.bookCount(n)
    return ListData.plural(n, _("%1 book"), _("%1 books"))
end

local function formats(book)
    local out = {}
    for _i, f in ipairs(book and book.formats or {}) do table.insert(out, string.upper(tostring(f))) end
    return out
end
ListData.formats = formats

local AUDIO = { m4b = true, mp3 = true, m4a = true }
function ListData.hasAudio(book)
    for _i, f in ipairs(book and book.formats or {}) do
        if AUDIO[string.lower(tostring(f))] then return true end
    end
    return false
end

-- The first letter a list groups an entry under: A to Z, "#" for anything
-- else. Common Latin accents fold to their letter, as the server's do.
local FOLD = {
    ["À"] = "A", ["Á"] = "A", ["Â"] = "A", ["Ã"] = "A", ["Ä"] = "A", ["Å"] = "A", ["à"] = "A", ["á"] = "A", ["â"] = "A", ["ã"] = "A", ["ä"] = "A", ["å"] = "A",
    ["Ç"] = "C", ["ç"] = "C", ["È"] = "E", ["É"] = "E", ["Ê"] = "E", ["Ë"] = "E", ["è"] = "E", ["é"] = "E", ["ê"] = "E", ["ë"] = "E",
    ["Ì"] = "I", ["Í"] = "I", ["Î"] = "I", ["Ï"] = "I", ["ì"] = "I", ["í"] = "I", ["î"] = "I", ["ï"] = "I",
    ["Ñ"] = "N", ["ñ"] = "N", ["Ò"] = "O", ["Ó"] = "O", ["Ô"] = "O", ["Õ"] = "O", ["Ö"] = "O", ["Ø"] = "O", ["ò"] = "O", ["ó"] = "O", ["ô"] = "O", ["õ"] = "O", ["ö"] = "O", ["ø"] = "O",
    ["Ù"] = "U", ["Ú"] = "U", ["Û"] = "U", ["Ü"] = "U", ["ù"] = "U", ["ú"] = "U", ["û"] = "U", ["ü"] = "U", ["Ý"] = "Y", ["ý"] = "Y", ["ÿ"] = "Y",
}
function ListData.letterOf(str)
    str = tostring(str or ""):gsub("^%s+", "")
    local first = str:sub(1, 1)
    if first:match("%a") then return first:upper() end
    local two = str:sub(1, 2)
    if FOLD[two] then return FOLD[two] end
    return "#"
end

-- "A", "A – C".
function ListData.letterRange(letters)
    if not letters or #letters == 0 then return nil end
    if #letters == 1 or letters[1] == letters[#letters] then return letters[1] end
    return letters[1] .. " – " .. letters[#letters]
end

-- The letters a run of entries covers, in order, each once.
function ListData.lettersOf(entries, letter_of)
    local seen, out = {}, {}
    for _i, e in ipairs(entries or {}) do
        local l = letter_of(e)
        if l and not seen[l] then seen[l] = true; table.insert(out, l) end
    end
    return out
end

-- "Mon D" style "finished on" label: the month and year a finished book was
-- last read.
function ListData.finishedOn(book)
    return BoardData.monthYear(book and book.lastReadAt)
end

ListData.duration = BoardData.formatDuration
ListData.shortDuration = BoardData.formatShortDuration

-- The right-hand cell of a book row: a value on top and words under it.
-- o.minutes_left: KOReader's own forecast for a book on this device.
-- o.narrow: the cell is too narrow for "4 h 25 min left".
-- Returns { kind, pct, label, bottom }.
function ListData.statusCell(book, o)
    o = o or {}
    local state = ListData.stateOf(book)
    if state == "reading" then
        local bottom
        if book.readStatus == "rereading" then bottom = _("Rereading")
        elseif o.minutes_left then
            bottom = T(_("%1 left"), o.narrow and ListData.shortDuration(o.minutes_left) or ListData.duration(o.minutes_left))
        else bottom = BoardData.relativeDay(book.lastReadAt, o.now) end
        return { kind = "reading", pct = tonumber(book.progressPercentage) or 0, label = ListData.pctLabel(book) or "0%", bottom = bottom }
    elseif state == "finished" then
        return { kind = "finished", label = _("Read"), bottom = ListData.finishedOn(book) }
    elseif state == "want" then
        return { kind = "want", label = _("To read"), bottom = formats(book)[1] }
    end
    local f = formats(book)
    return { kind = "format", label = table.concat({ f[1], f[2] }, " · "), bottom = ListData.hasAudio(book) and _("with audio") or nil }
end

-- The gray line under a cover in a grid: the value first, then words that
-- may be dropped when the cell is narrow. Runs: { t, b }.
function ListData.bookMeta(book, o)
    o = o or {}
    local state = ListData.stateOf(book)
    if state == "reading" then
        local after
        if o.minutes_left then after = T(_(" · %1 left"), ListData.shortDuration(o.minutes_left))
        elseif book.readStatus == "rereading" then after = _(" · rereading")
        else after = " · " .. (BoardData.relativeDay(book.lastReadAt, o.now) or "") end
        return { { t = ListData.pctLabel(book) or "0%", b = true }, { t = after } }
    elseif state == "finished" then
        local on = ListData.finishedOn(book)
        return { { t = _("Read"), b = true }, { t = on and (" · " .. on) or "" } }
    elseif state == "want" then
        return { { t = _("To read"), b = true } }
    end
    local f = formats(book)
    if o.author == false or not (book.authors and book.authors[1]) then
        return { { t = table.concat(f, ", ") } }
    end
    return { { t = book.authors[1] } }
end

-- Inside one series titles often share their first words ("Harry Potter and
-- the"). A one-line caption drops them and keeps what tells the books apart.
function ListData.distinctTitles(books)
    local out = {}
    if not books or #books < 2 then
        for _i, b in ipairs(books or {}) do out[b.id] = b.title end
        return out
    end
    local words = {}
    for i, b in ipairs(books) do
        words[i] = {}
        for w in tostring(b.title or ""):gmatch("%S+") do table.insert(words[i], w) end
    end
    local k = 0
    while true do
        local all = true
        for i = 1, #books do
            local w = words[i]
            if #w <= k + 1 or w[k + 1]:lower() ~= words[1][k + 1]:lower() then all = false; break end
        end
        if not all then break end
        k = k + 1
    end
    for i, b in ipairs(books) do
        if k >= 2 then
            local rest = table.concat(words[i], " ", k + 1)
            out[b.id] = rest:sub(1, 1):upper() .. rest:sub(2)
        else
            out[b.id] = b.title
        end
    end
    return out
end

-- -------------------------------------------------------------- series
-- "3 of 7 books" when the series is known to have more than the library
-- holds, else "7 books".
function ListData.seriesCounts(entry)
    local count = tonumber(entry.count) or 0
    local expected = tonumber(entry.expectedCount)
    if expected and expected > count then return T(_("%1 of %2 books"), count, expected) end
    return ListData.bookCount(count)
end

function ListData.seriesWho(entry)
    local names = entry.authorNames or {}
    if #names == 0 then return nil end
    if #names > 1 then return T(_("%1 and others"), names[1]) end
    return names[1]
end

-- How far through a series the reader is, from memberStates.
function ListData.seriesProgress(entry)
    local states = entry.memberStates or {}
    local finished = tonumber(entry.finishedCount)
    local reading = tonumber(entry.readingCount)
    if not finished or not reading then
        finished, reading = 0, 0
        for _i, s in ipairs(states) do
            if s == "finished" then finished = finished + 1 elseif s == "reading" then reading = reading + 1 end
        end
    end
    local count = tonumber(entry.count) or #states
    return { count = count, finished = finished, reading = reading, all_done = count > 0 and finished >= count, states = states }
end

-- The label beside a series bar: "All 3 read", "1 of 3 read", "Reading".
function ListData.seriesBarLabel(p)
    if p.all_done then return T(_("All %1 read"), p.count), true end
    if p.finished > 0 then return T(_("%1 of %2 read"), p.finished, p.count), false end
    return _("Reading"), true
end

-- The gray line under a series in a grid.
function ListData.seriesMeta(entry)
    local p = ListData.seriesProgress(entry)
    local who = ListData.seriesWho(entry) or ""
    if p.count < 2 then
        local b = entry.previewBooks and entry.previewBooks[1]
        if b and ListData.stateOf(b) ~= "unread" then return ListData.bookMeta(b) end
        return { { t = who ~= "" and who or ListData.bookCount(1) } }
    end
    local tail = who ~= "" and (" · " .. who) or ""
    if p.all_done then return { { t = T(_("All %1 read"), p.count), b = true }, { t = tail } } end
    if p.finished > 0 then return { { t = T(_("%1 of %2 read"), p.finished, p.count) }, { t = tail } } end
    if p.reading > 0 then return { { t = _("Reading"), b = true }, { t = " · " .. ListData.bookCount(p.count) } } end
    return { { t = ListData.bookCount(p.count) }, { t = tail } }
end

-- -------------------------------------------------------------- authors
-- The right-hand cell of an author row, or nil.
function ListData.authorCell(entry)
    local count = tonumber(entry.count) or 0
    local reading = tonumber(entry.readingCount) or 0
    local finished = tonumber(entry.finishedCount) or 0
    local first = entry.previewBooks and entry.previewBooks[1]
    if reading > 0 then
        local bottom = count == 1 and first and ((ListData.pctLabel(first) or "0%") .. " " .. _("read")) or T(_("%1 of %2"), reading, count)
        return { kind = "reading", label = _("Reading"), bottom = bottom }
    end
    if count > 0 and finished >= count then
        return { kind = "finished", label = _("Read"), bottom = count > 1 and T(_("all %1"), count) or (first and ListData.finishedOn(first)) }
    end
    if finished > 0 then
        return { kind = "partial", label = T(_("%1 of %2"), finished, count), bottom = _("read") }
    end
    return nil
end

-- The gray line under an author: richest first; the view keeps the first
-- that fits.
function ListData.authorMetaVariants(entry)
    local count = tonumber(entry.count) or 0
    local reading = tonumber(entry.readingCount) or 0
    local finished = tonumber(entry.finishedCount) or 0
    if count == 1 then
        local b = entry.previewBooks and entry.previewBooks[1]
        local state = b and ListData.stateOf(b)
        if state == "reading" then
            return { { { t = _("Reading"), b = true }, { t = " · " .. (ListData.pctLabel(b) or "0%") } }, { { t = _("Reading"), b = true } } }
        elseif state == "finished" then
            local on = ListData.finishedOn(b)
            return { { { t = _("Read"), b = true }, { t = on and (" · " .. on) or "" } }, { { t = _("Read"), b = true } } }
        end
        return { { { t = ListData.bookCount(1) } } }
    end
    if reading > 0 then
        return {
            { { t = ListData.bookCount(count) .. " · " }, { t = T(_("%1 reading"), reading), b = true } },
            { { t = T(_("Reading %1 of %2"), reading, count), b = true } },
        }
    end
    if count > 0 and finished >= count then return { { { t = T(_("All %1 read"), count), b = true } } } end
    if finished > 0 then
        return { { { t = ListData.bookCount(count) .. " · " .. T(_("%1 read"), finished) } }, { { t = ListData.bookCount(count) } } }
    end
    return { { { t = ListData.bookCount(count) } } }
end

function ListData.authorSecond(entry)
    local line = ListData.bookCount(tonumber(entry.count) or 0)
    if entry.seriesName and entry.seriesName ~= "" then line = line .. " · " .. entry.seriesName end
    return line
end

-- A metadata provider's "See also: <pen name>" line can arrive glued to the
-- bio's first word ("See also: Robert GalbraithAlthough she..."). It is
-- dropped: the bio starts where a lower-case letter runs into a capital.
function ListData.cleanBio(text)
    if type(text) ~= "string" then return nil end
    if text:sub(1, 9) == "See also:" then
        local cut = text:find("%l%u", 10)
        if cut then text = text:sub(cut + 1) end
    end
    text = text:gsub("^%s+", "")
    return text ~= "" and text or nil
end

-- -------------------------------------------------------------- paging
-- Rows of at least min_row that fill h exactly: { n, rh }.
function ListData.fillRows(h, min_row)
    local n = math.max(1, math.floor(h / min_row))
    return { n = n, rh = math.floor(h / n) }
end

-- The page holding a 0-based index, 1-based.
function ListData.pageOf(index, per)
    if not index or not per or per < 1 then return 1 end
    return math.floor(index / per) + 1
end

-- Pages counted around the screen's first entry (0-based start): the pages
-- before it, the first of which may be short, and the pages from it to the
-- end. { page, pages, has_prev, has_next, start, per }.
function ListData.windowPaging(start, per, total, has_next)
    local before = math.ceil(start / per)
    local page = before + 1
    local pages = total and math.max(page, before + math.ceil(math.max(0, total - start) / per)) or nil
    local more
    if total then more = start + per < total else more = has_next == true end
    return { page = page, pages = pages, has_prev = start > 0, has_next = more, start = start, per = per }
end

-- Buckets ({ key, index }) as a set of letters with entries.
function ListData.presentLetters(buckets)
    local out = {}
    for _i, b in ipairs(buckets or {}) do out[b.key] = b.index end
    return out
end

-- Splits n rows between sections holding counts[i] entries: an even share
-- each, no section more than it holds, a spare row to the earliest.
function ListData.shareRows(n, counts)
    local rows, left = {}, n
    for i = 1, #counts do rows[i] = 0 end
    local open = true
    while left > 0 and open do
        open = false
        for i = 1, #counts do
            if left > 0 and rows[i] < counts[i] then
                rows[i] = rows[i] + 1
                left = left - 1
                open = true
            end
        end
    end
    return rows
end

return ListData
