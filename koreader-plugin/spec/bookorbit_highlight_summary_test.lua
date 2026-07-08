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

local HighlightSummary = require("bookorbit_highlight_summary")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local summary = HighlightSummary.normalize{
    event = "book_sync",
    reason = "manual",
    uploaded = "2",
    applied = 1,
    deleted = nil,
}
assertEqual(summary.uploaded, 2, "uploaded is normalized")
assertEqual(summary.deleted, 0, "missing deleted count becomes zero")

summary = HighlightSummary.add(summary, { uploaded = 3, applied = 2, deleted = 1 }, { closed_book = true })
assertEqual(summary.uploaded, 5, "uploaded is aggregated")
assertEqual(summary.applied, 3, "applied is aggregated")
assertEqual(summary.deleted, 1, "deleted is aggregated")
assertEqual(summary.touched_books, 1, "closed book touch is counted")

summary = HighlightSummary.add(summary, { had_errors = true }, { skipped = 2 })
assertEqual(summary.failed, 1, "had_errors increments failed when no failed count exists")
assertEqual(summary.skipped, 2, "skipped is aggregated")

assertEqual(HighlightSummary.hasCounts(summary), true, "summary has counts")
assertEqual(HighlightSummary.hasRemoteChanges(summary), true, "summary has remote changes")
assertEqual(HighlightSummary.actionableError(summary), "partial_failure", "failed count is actionable")
assertEqual(HighlightSummary.actionableError({}, "unsupported_server"), "unsupported_server", "unsupported server is actionable")
assertEqual(HighlightSummary.actionableError({ skipped = 1 }, "unmatched"), nil, "unmatched skip is not actionable")

local message = HighlightSummary.message(summary)
assertEqual(message:match("Highlights synced: 5 uploaded, 3 applied, 1 deleted%.") ~= nil, true, "message has concise counts")
assertEqual(message:match("Failed: 1%. Skipped: 2%.") ~= nil, true, "message has failure counts")
assertEqual(message:match("1 closed book%(s%) updated%.") ~= nil, true, "message has closed book count")

print("bookorbit_highlight_summary_test.lua: ok")
