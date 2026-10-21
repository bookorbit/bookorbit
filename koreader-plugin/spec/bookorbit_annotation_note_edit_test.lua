-- KOReader leaves datetime_updated alone when a note's text changes but the
-- item stays a note, so the upload watermark alone never sees that edit. The
-- exchange remembers the notes it saw and uploads a changed one stamped now.

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
local _, first, first_signature = exchange(book, { noted("first note") })
assertEqual(#first, 1, "a new note goes up on its first exchange")
assert(type(book.annNoteHashes) == "table", "the exchange remembers the notes it saw")

local _, unchanged = exchange(book, { noted("first note") })
assertEqual(#unchanged, 0, "an untouched note is not uploaded again")

local before = os.date("%Y-%m-%d %H:%M:%S")
local _, edited, edited_signature = exchange(book, { noted("rewritten note") })
assertEqual(#edited, 1, "a note rewritten without a new timestamp is uploaded")
assertEqual(edited[1].note, "rewritten note", "the upload carries the new text")
assert(edited[1].datetimeUpdated ~= nil and edited[1].datetimeUpdated >= before,
    "the upload is stamped with the device clock so the server treats it as the latest edit")
assertEqual(edited[1].datetime, "2026-07-08 09:00:00", "the identity datetime is untouched")
assert(edited_signature ~= first_signature, "a note rewrite changes the skip signal")

local _, settled = exchange(book, { noted("rewritten note") })
assertEqual(#settled, 0, "once delivered, the rewritten note stops uploading")

-- A snapshot queued before the latest exchange holds an older state of the
-- notes than the device has already reported. Its note is not an edit: the
-- server takes a field the device changed whenever nothing else did, so
-- sending it would put the old note back (S-30). Nor may it replace the
-- notes remembered from the newer list.
local queued_at = os.time() - 3600
local _, stale = exchange(book, { noted("rewritten note before the queue drained") }, queued_at)
assertEqual(#stale, 0, "a note from a list older than the last exchange is not sent")
local _, current = exchange(book, { noted("rewritten note") })
assertEqual(#current, 0, "and the notes remembered from the newer list stay")
local _, future = exchange(book, { noted("note from a snapshot dated ahead") }, os.time() + 3600)
assert(future[1].datetimeUpdated <= os.date("%Y-%m-%d %H:%M:%S"), "a capture time ahead of the clock is capped")

-- A book exchanged by an older plugin has a watermark but no remembered notes.
-- Nothing may be guessed as edited until one exchange has recorded them.
local upgraded = { annWatermark = "2026-07-08 10:00:00" }
local _, after_upgrade = exchange(upgraded, { noted("note from before the upgrade") })
assertEqual(#after_upgrade, 0, "an upgraded book uploads nothing on its first exchange")
assert(type(upgraded.annNoteHashes) == "table", "and remembers its notes from then on")
local _, upgraded_edit = exchange(upgraded, { noted("edited after the upgrade") })
assertEqual(#upgraded_edit, 1, "the next rewrite on an upgraded book is uploaded")

-- A failed upload must not record the edit as delivered.
local failing = {}
exchange(failing, { noted("kept note") })
local _, retried = (function()
    local normalized, max_datetime, signature = BookOrbitSidecar.normalizeAnnotations({ noted("edit that failed") })
    BookOrbitAnnotations.exchangeBook({
        client = { exchangeAnnotations = function() return nil, 500 end },
        state = { getBook = function() return failing end, setUnmatched = function() end },
        digest = "abc123",
        annotations = normalized,
        ann_max_datetime = max_datetime,
        ann_signature = signature,
        apply_mode = "sidecar",
        file = "/books/one.epub",
    })
    return exchange(failing, { noted("edit that failed") })
end)()
assertEqual(#retried, 1, "an edit whose upload failed is sent again on the next exchange")

print("bookorbit_annotation_note_edit_test: ok")
