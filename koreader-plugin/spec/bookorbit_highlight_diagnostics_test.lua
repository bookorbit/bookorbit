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

local Diagnostics = require("bookorbit_highlight_diagnostics")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

assertEqual(Diagnostics.openHighlightsText{ annotation_sync = false, has_open_book = true }, "two-way sync off", "disabled state")
assertEqual(Diagnostics.openHighlightsText{ annotation_sync = true }, "no reader book", "no open book state")
assertEqual(Diagnostics.openHighlightsText{ annotation_sync = true, has_open_book = true, matched = true }, "matched, idle", "matched idle state")
assertEqual(Diagnostics.openHighlightsText{
    annotation_sync = true,
    has_open_book = true,
    matched = true,
    scheduler_status = { phase = "scheduled" },
}, "matched, sync scheduled", "matched scheduled state")
assertEqual(Diagnostics.openHighlightsText{
    annotation_sync = true,
    has_open_book = true,
    matched = false,
    scheduler_status = { phase = "matching" },
}, "unmatched, retrying match", "match retry state")
assertEqual(Diagnostics.openHighlightsText{
    annotation_sync = true,
    has_open_book = true,
    matched = false,
    last_highlight_sync = { skipped = 1 },
}, "unmatched, skipped", "unmatched skipped state")

assertEqual(Diagnostics.retryText(), "none", "empty retry state")
assertEqual(Diagnostics.retryText{ pending = true }, "pending", "pending retry state")

local text = Diagnostics.lastSyncText({
    uploaded = 1,
    applied = 2,
    deleted = 3,
    failed = 4,
    skipped = 5,
    at = 123,
}, function()
    return "14:31"
end)
assertEqual(text, "1 uploaded, 2 applied, 3 deleted, 4 failed, 5 skipped at 14:31", "last sync summary")
assertEqual(Diagnostics.lastSyncText(nil), "never", "missing summary")

print("bookorbit_highlight_diagnostics_test.lua: ok")
