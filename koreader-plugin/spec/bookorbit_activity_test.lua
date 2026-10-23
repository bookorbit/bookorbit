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

print("bookorbit_activity_test.lua: ok")
