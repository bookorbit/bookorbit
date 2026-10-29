-- A matched copy whose bytes differ from the library file (a manual link to a
-- calibre-sent copy, say) keeps its match: highlight and bookmark exchanges skip
-- it without counting a failure, and the server's answer for it never reads as
-- "not in your library".

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;koreader-plugin/spec/?.lua;" .. package.path

package.loaded["docsettings"] = {
    open = function()
        return {
            readSetting = function() return nil end,
            saveSetting = function() end,
            makeTrue = function() end,
            flush = function() end,
        }
    end,
    hasSidecarFile = function() return false end,
    findSidecarFile = function() return nil end,
}
package.loaded["datastorage"] = { getSettingsDir = function() return "/tmp" end }
package.loaded["luasettings"] = { open = function() return { readSetting = function(_, _, default) return default end } end }
package.loaded["dump"] = function() return "" end
package.loaded["ui/event"] = { new = function(_, name, payload) return { name = name, payload = payload } end }
package.loaded["ui/uimanager"] = { setDirty = function() end }
package.loaded["ui/widget/booklist"] = { setBookInfoCacheProperty = function() end }
package.loaded["logger"] = { dbg = function() end }
package.loaded["ffi/sha2"] = { md5 = function(value) return value end }
package.loaded["ffi/util"] = {
    template = function(text, ...)
        local values = { ... }
        return (text:gsub("%%(%d+)", function(index) return tostring(values[tonumber(index)]) end))
    end,
}
package.loaded["gettext"] = function(value) return value end
package.loaded["util"] = { trim = function(value) return tostring(value or ""):match("^%s*(.-)%s*$") end }
package.loaded["libs/libkoreader-lfs"] = { attributes = function() return nil end }
package.loaded["bookorbit_capabilities"] = {
    supports = function() return true end,
    markUnsupported = function() end,
}

local BookOrbitState = require("bookorbit_state")
local BookOrbitAnnotations = require("bookorbit_annotations")
local BookOrbitBookmarks = require("bookorbit_bookmarks")
local HighlightSummary = require("bookorbit_highlight_summary")
local Diagnostics = require("bookorbit_highlight_diagnostics")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)), 2)
    end
end

local function newState()
    return BookOrbitState.snapshot({ books = {}, unmatched = {}, files = {}, statsRows = {}, global = {} })
end

-- The match records the flag, a later compatible match clears it, and a new
-- server identity starts from a clean record.
local state = newState()
state:setMatched("digest", 10, 20, "/books/copy.epub", "v1", false)
assertEqual(state:getBook("digest").positionIncompatible, true, "an incompatible match is flagged")
state:setMatched("digest", 10, 20, "/books/copy.epub", "v1")
assertEqual(state:getBook("digest").positionIncompatible, nil, "a match without the field (older server, compatible copy) clears it")
state:setMatched("digest", 10, 20, "/books/copy.epub", "v1", false)
state:setMatched("digest", 11, 21, "/books/copy.epub", "v1", true)
assertEqual(state:getBook("digest").positionIncompatible, nil, "a different book or file is a fresh record")
state:markPositionIncompatible("digest")
assertEqual(state:getBook("digest").positionIncompatible, true, "an exchange can record what it learned")
state:markPositionIncompatible("unknown")
assertEqual(state:getBook("unknown"), nil, "marking an unmatched digest does not invent a match")

local function highlight(datetime, pos0)
    return { drawer = "lighten", datetime = datetime, pos0 = pos0, pos1 = pos0 .. ".9", text = "text" }
end

-- A flagged book never reaches the server and reports nothing as failed.
local flagged = newState()
flagged:setMatched("digest", 10, 20, "/books/copy.epub", "v1", false)
local requests = 0
local silent_client = {
    exchangeAnnotations = function() requests = requests + 1 end,
    exchangeAck = function() requests = requests + 1 end,
    exchangeBookmarks = function() requests = requests + 1 end,
    exchangeBookmarksAck = function() requests = requests + 1 end,
}
local ann = BookOrbitAnnotations.exchangeBook({
    client = silent_client,
    state = flagged,
    digest = "digest",
    annotations = { highlight("2026-10-26 08:00:00", "/body/p[1]") },
    ann_max_datetime = "2026-10-26 08:00:00",
    ann_signature = "sig",
    apply_mode = "sidecar",
    file = "/books/copy.epub",
})
assertEqual(ann.incompatible, 1, "the highlight exchange reports the skip")
assertEqual(ann.had_errors, false, "a skip is not a failure")
assertEqual(ann.uploaded, 0, "nothing is claimed as uploaded")
local bm = BookOrbitBookmarks.exchangeBook({
    client = silent_client,
    state = flagged,
    digest = "digest",
    bookmarks = { { datetime = "2026-10-26 08:00:00", pos = "/body/p[2]", pageno = 2 } },
    bm_signature = "sig",
    apply_mode = "sidecar",
    file = "/books/copy.epub",
})
assertEqual(bm.incompatible, 1, "the bookmark exchange reports the skip")
assertEqual(bm.had_errors, false, "a bookmark skip is not a failure")
assertEqual(requests, 0, "a flagged book sends no request")
assertEqual(flagged:getBook("digest").annWatermark, "", "the highlight watermark stays put for a later compatible exchange")

-- A book the local state still thinks is compatible learns it from the reply,
-- keeps its match and is not counted as failed.
local learning = newState()
learning:setMatched("digest", 10, 20, "/books/copy.epub", "v1")
local ann_reply = BookOrbitAnnotations.exchangeBook({
    client = {
        exchangeAnnotations = function() return { results = {}, unmatched = {}, positionIncompatible = { "digest" } } end,
        exchangeAck = function() error("no ack for a skipped book") end,
    },
    state = learning,
    digest = "digest",
    annotations = { highlight("2026-10-26 08:00:00", "/body/p[1]") },
    ann_max_datetime = "2026-10-26 08:00:00",
    ann_signature = "sig",
    apply_mode = "sidecar",
    file = "/books/copy.epub",
})
assertEqual(ann_reply.incompatible, 1, "the reply turns into a skip")
assertEqual(ann_reply.uploaded, 0, "the rejected chunk is not counted as uploaded")
assertEqual(learning:getBook("digest") ~= nil, true, "the match survives")
assertEqual(learning.unmatched["digest"], nil, "the book is not recorded as unmatched")
assertEqual(learning:getBook("digest").positionIncompatible, true, "the flag is recorded for later exchanges")
assertEqual(learning:getBook("digest").annWatermark, "", "the watermark does not advance past highlights that never synced")

local bm_learning = newState()
bm_learning:setMatched("digest", 10, 20, "/books/copy.epub", "v1")
local bm_reply = BookOrbitBookmarks.exchangeBook({
    client = {
        exchangeBookmarks = function() return { results = {}, unmatched = {}, positionIncompatible = { "digest" } } end,
        exchangeBookmarksAck = function() error("no ack for a skipped book") end,
    },
    state = bm_learning,
    digest = "digest",
    bookmarks = { { datetime = "2026-10-26 08:00:00", pos = "/body/p[2]", pageno = 2 } },
    bm_signature = "sig",
    apply_mode = "sidecar",
    file = "/books/copy.epub",
})
assertEqual(bm_reply.incompatible, 1, "the bookmark reply turns into a skip")
assertEqual(bm_learning.unmatched["digest"], nil, "the bookmark reply keeps the match")
assertEqual(bm_learning:getBook("digest").positionIncompatible, true, "the bookmark reply records the flag")

-- A truly unmatched answer still drops the match, as before.
local dropping = newState()
dropping:setMatched("digest", 10, 20, "/books/copy.epub", "v1")
local dropped, dropped_err = BookOrbitAnnotations.exchangeBook({
    client = { exchangeAnnotations = function() return { results = {}, unmatched = { "digest" } } end },
    state = dropping,
    digest = "digest",
    annotations = {},
    ann_signature = "sig",
    apply_mode = "skip",
})
assertEqual(dropped, nil, "an unmatched answer has no result")
assertEqual(dropped_err, "unmatched", "and reports unmatched")
assertEqual(dropping:getBook("digest"), nil, "and drops the local match")

-- Summaries say what happened without calling it a failure.
local summary = HighlightSummary.add(nil, ann)
summary = HighlightSummary.addBookmarks(summary, bm)
assertEqual(summary.incompatible, 1, "one skipped book is counted once, not per exchange")
assertEqual(summary.failed, 0, "no highlight failure")
assertEqual(summary.bm_failed, 0, "no bookmark failure")
assertEqual(HighlightSummary.actionableError(summary, nil), nil, "no partial failure is reported")
assert(HighlightSummary.message(summary):find("different file from the one in BookOrbit", 1, true),
    "the message names the reason")
assertEqual(HighlightSummary.normalize({}).incompatible, 0, "older persisted summaries read as zero")

assertEqual(Diagnostics.openHighlightsText{
    annotation_sync = true,
    has_open_book = true,
    matched = true,
    position_incompatible = true,
}, "not synced: this copy differs from BookOrbit's file", "diagnostics name the state")
assertEqual(Diagnostics.openHighlightsText{
    annotation_sync = true,
    has_open_book = true,
    matched = true,
}, "matched, idle", "a compatible match reads as before")

assertEqual(Diagnostics.lastSyncText({ incompatible = 2, at = 0 }),
    "0 uploaded, 0 applied, 0 deleted, 0 failed, 0 skipped, 2 not synced (different copy)",
    "the last-sync row counts different copies apart from skips")
assertEqual(Diagnostics.lastSyncText({ uploaded = 1, at = 0 }),
    "1 uploaded, 0 applied, 0 deleted, 0 failed, 0 skipped", "a compatible sync reads as before")

print("bookorbit_position_incompatible_test: ok")
