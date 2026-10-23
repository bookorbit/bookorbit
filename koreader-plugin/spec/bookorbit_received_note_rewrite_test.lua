-- A highlight the server just sent carries a datetime past the upload
-- watermark. Its first note rewrite on KOReader went up with that datetime,
-- which the server ranked below the web edit that created the note, so the
-- rewrite was dropped and the two copies stayed different (D-08). A rewrite
-- the device itself dated (the note-save stamp) keeps its own time.

package.loaded["docsettings"] = {
    open = function()
        return {
            readSetting = function() return {} end,
            saveSetting = function() end,
            makeTrue = function() end,
            flush = function() end,
        }
    end,
    hasSidecarFile = function() return false end,
    findSidecarFile = function() return nil end,
}
package.loaded["ui/widget/booklist"] = { setBookInfoCacheProperty = function() end }
package.loaded["ui/event"] = { new = function(_, name, payload) return { name = name, payload = payload } end }
package.loaded["ui/uimanager"] = { setDirty = function() end }
package.loaded["logger"] = { dbg = function() end }
package.loaded["ffi/sha2"] = { md5 = function(value) return value end }
package.loaded["util"] = {
    trim = function(value) return tostring(value or ""):match("^%s*(.-)%s*$") end,
}
package.loaded["libs/libkoreader-lfs"] = { attributes = function() return nil end }

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local BookOrbitAnnotations = require("bookorbit_annotations")
local BookOrbitSidecar = require("bookorbit_sidecar")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local function noted(note)
    return {
        drawer = "lighten",
        datetime = "2026-07-08 09:00:00",
        pos0 = "/body/p[1]/text().0",
        pos1 = "/body/p[1]/text().12",
        text = "one highlight",
        note = note,
    }
end

local function exchange(book, raw, captured_at)
    local normalized, max_datetime, signature = BookOrbitSidecar.normalizeAnnotations(raw)
    local uploads = {}
    local result = BookOrbitAnnotations.exchangeBook({
        client = {
            exchangeAnnotations = function(_, books)
                for _, change in ipairs(books[1].changes) do table.insert(uploads, change) end
                return { results = { { toApply = {}, more = false } } }
            end,
        },
        state = { getBook = function() return book end, setUnmatched = function() end },
        digest = "abc123",
        annotations = normalized,
        ann_max_datetime = max_datetime,
        ann_signature = signature,
        captured_at = captured_at,
        apply_mode = "sidecar",
        file = "/books/one.epub",
    })
    return result, uploads, signature
end

local book = {}
-- What an exchange that applied the highlight leaves behind: the watermark from
-- the local list before the pull, and the notes remembered after the apply.
local received = {
    drawer = "lighten",
    datetime = "2026-07-08 11:05:54",
    pos0 = "/body/p[7]/text().52",
    pos1 = "/body/p[7]/text().157",
    text = "received highlight",
    note = "web note",
}
book.annWatermark = "2026-07-08 10:14:37"
BookOrbitAnnotations.rememberNotes(book, (BookOrbitSidecar.normalizeAnnotations({ received })), "2026-07-08 11:06:04")
assertEqual(book.annNotesAt, "2026-07-08 11:06:04", "remembering notes records when")

local rewritten = {}
for k, v in pairs(received) do rewritten[k] = v end
rewritten.note = "rewritten on KOReader"
local captured = os.time()
local _, first = exchange(book, { rewritten }, captured)
assertEqual(#first, 1, "the rewrite of a received note is uploaded")
assertEqual(first[1].note, "rewritten on KOReader", "with the new text")
assertEqual(first[1].datetimeUpdated, os.date("%Y-%m-%d %H:%M:%S", captured),
    "dated by its capture, not by the datetime the server sent")
assertEqual(first[1].datetime, "2026-07-08 11:05:54", "the identity datetime is untouched")

-- The note-save stamp dates the rewrite itself; that time is kept as it is.
local stamped_book = { annWatermark = "2026-07-08 10:14:37" }
BookOrbitAnnotations.rememberNotes(stamped_book, (BookOrbitSidecar.normalizeAnnotations({ received })), "2026-07-08 11:06:04")
local stamped = {}
for k, v in pairs(received) do stamped[k] = v end
stamped.note = "rewritten and stamped"
stamped.datetime_updated = "2026-07-08 11:06:30"
local _, own = exchange(stamped_book, { stamped }, os.time())
assertEqual(#own, 1, "a stamped rewrite is uploaded")
assertEqual(own[1].datetimeUpdated, "2026-07-08 11:06:30", "with the time it was saved")

-- Received and untouched: no rewrite to date.
local quiet_book = { annWatermark = "2026-07-08 10:14:37" }
BookOrbitAnnotations.rememberNotes(quiet_book, (BookOrbitSidecar.normalizeAnnotations({ received })), "2026-07-08 11:06:04")
local _, quiet = exchange(quiet_book, { received }, os.time())
for _, change in ipairs(quiet) do
    assert(change.datetimeUpdated == nil, "an untouched received note is not dated as an edit")
end

print("bookorbit_received_note_rewrite_test: ok")
