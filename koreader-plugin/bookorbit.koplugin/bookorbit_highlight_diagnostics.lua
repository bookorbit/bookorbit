local T = require("ffi/util").template
local _ = require("gettext")

local HighlightDiagnostics = {}

local function count(value)
    value = tonumber(value)
    if not value or value < 0 then return 0 end
    return value
end

local function hasOpenBook(ctx)
    return ctx and ctx.has_open_book == true
end

function HighlightDiagnostics.lastSyncText(summary, format_time)
    if type(summary) ~= "table" then return _("never") end
    local text = T(_("%1 uploaded, %2 applied, %3 deleted, %4 failed, %5 skipped"),
        count(summary.uploaded), count(summary.applied), count(summary.deleted),
        count(summary.failed), count(summary.skipped))
    local at = tonumber(summary.at)
    if at and at > 0 then
        local when = format_time and format_time(at) or os.date("%H:%M", at)
        text = T(_("%1 at %2"), text, when)
    end
    return text
end

function HighlightDiagnostics.retryText(status)
    if type(status) == "table" and status.pending then
        return _("pending")
    end
    return _("none")
end

function HighlightDiagnostics.openHighlightsText(ctx)
    ctx = ctx or {}
    if not ctx.annotation_sync then
        return _("two-way sync off")
    end
    if not hasOpenBook(ctx) then
        return _("no reader book")
    end

    local pending = ctx.scheduler_status
    local matched = ctx.matched == true
    if type(pending) == "table" then
        if matched then
            return _("matched, sync scheduled")
        end
        if pending.phase == "matching" then
            return _("unmatched, retrying match")
        end
        return _("unmatched, sync scheduled")
    end

    if matched then
        return _("matched, idle")
    end
    local last = ctx.last_highlight_sync
    if type(last) == "table" and count(last.skipped) > 0 then
        return _("unmatched, skipped")
    end
    return _("unmatched, idle")
end

return HighlightDiagnostics
