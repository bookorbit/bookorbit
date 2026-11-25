-- Proves the Sync status page's activity list: newest first, a repeat within
-- ten minutes replaces the newest entry, the list stays short, failures are
-- flagged, and a highlight sync that moved nothing records nothing.

package.loaded["gettext"] = function(text)
    return text
end

package.loaded["ffi/util"] = {
    template = function(text, ...)
        local values = { ... }
        return (text:gsub("%%(%d+)", function(index)
            return tostring(values[tonumber(index)])
        end))
    end,
}

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local Activity = require("bookorbit_activity")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local settings = {}
Activity.record(settings, { kind = "sweep", text = "Synced your library", at = 1000 })
Activity.record(settings, { kind = "progress_push", text = "Sent reading progress", at = 1100 })
local log = Activity.list(settings)
assertEqual(#log, 2, "two events recorded")
assertEqual(log[1].kind, "progress_push", "the newest event comes first")

-- A periodic push repeats every few page turns; it replaces the newest entry.
Activity.record(settings, { kind = "progress_push", text = "Sent reading progress", at = 1300 })
assertEqual(#Activity.list(settings), 2, "a repeat within ten minutes does not add a row")
assertEqual(Activity.list(settings)[1].at, 1300, "the repeat updates the time")
Activity.record(settings, { kind = "progress_push", text = "Sent reading progress", at = 1300 + 11 * 60 })
assertEqual(#Activity.list(settings), 3, "a repeat after ten minutes is its own row")

-- The list is bounded.
for i = 1, 30 do
    Activity.record(settings, { kind = "k" .. i, text = "event " .. i, at = 5000 + i })
end
assertEqual(#Activity.list(settings), Activity.MAX, "the list keeps the newest few")
assertEqual(Activity.list(settings)[1].text, "event 30", "the newest survives")

-- Success and failure wording.
settings = {}
Activity.recordSuccess(settings, "sweep", "37 books, 12 reading events, 4 highlights")
Activity.recordError(settings, "progress_push", "server not reachable")
log = Activity.list(settings)
assertEqual(log[1].text, "Could not send progress", "a failure gets its own sentence")
assertEqual(log[1].warn, true, "a failure is flagged")
assertEqual(log[1].sub, "server not reachable", "the reason is the detail line")
assertEqual(log[2].text, "Synced your library", "a library sync is named")
Activity.recordSuccess(settings, "unknown_event", "x")
assertEqual(#Activity.list(settings), 2, "events the page does not describe are skipped")

-- Highlights: only when something moved.
Activity.recordHighlights(settings, { uploaded = 0, applied = 0, deleted = 0 })
assertEqual(#Activity.list(settings), 2, "an empty exchange records nothing")
Activity.recordHighlights(settings, { uploaded = 4, applied = 1, deleted = 0, bm_uploaded = 1 })
assertEqual(Activity.list(settings)[1].text, "Highlights: 5 sent, 1 received", "highlights and bookmarks are counted together")

-- Entries keep keys and numbers, so the page writes them in the language
-- KOReader uses when it is shown, not the one they were recorded in.
local later = {}
Activity.recordSuccess(later, "book_sync", Activity.detail("reading_upload", 2, 0))
Activity.recordError(later, "sweep", Activity.detail("error", "network"))
Activity.recordError(later, "progress_push", Activity.detail("error", 500))
local list = Activity.list(later)
assertEqual(Activity.sub(list[3]), "2 reading events, 0 highlights uploaded", "success detail from its key")
assertEqual(Activity.sub(list[2]), "server not reachable", "error detail from its code")
assertEqual(Activity.sub(list[1]), "server error 500", "an HTTP status as a detail")
list[3].text = "Libro sincronizado"
list[3].sub = "texto guardado"
assertEqual(Activity.title(list[3]), "Synced this book", "the title follows the current language, not the stored words")
assertEqual(Activity.sub(list[3]), "2 reading events, 0 highlights uploaded", "the detail follows the current language too")
assertEqual(Activity.title({ kind = "something_new", text = "Stored words" }), "Stored words", "an unknown kind keeps its stored words")
assertEqual(Activity.sub({ kind = "book_sync", sub = "Older entry" }), "Older entry", "an entry from before keys keeps its stored detail")
assertEqual(Activity.title(Activity.list(settings)[1]), "Highlights: 5 sent, 1 received", "highlight counts are kept as numbers")
assertEqual(Activity.detailText(Activity.detail("library", 3, 10, 1, 2)),
    "3 books, 10 reading events, 1 highlights. 2 books need to be opened and synced once to recover their reading history.",
    "library summary with books that need opening")
assertEqual(Activity.detailText("plain words"), "plain words", "stored words pass through")
assertEqual(Activity.detailText(nil), nil, "no detail")

print("bookorbit_activity_test.lua: ok")
