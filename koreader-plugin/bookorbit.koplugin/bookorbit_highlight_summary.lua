--[[--
Highlight sync summary helpers for BookOrbit.

Keeps the persisted diagnostic shape, count aggregation and concise user
messages consistent across open-book exchange, per-book sync and sweep.
]]

local T = require("ffi/util").template
local _ = require("gettext")

local HighlightSummary = {}

local COUNT_FIELDS = {
    "uploaded",
    "applied",
    "deleted",
    "failed",
    "skipped",
    "touched_books",
}

local ACTIONABLE_ERRORS = {
    auth = true,
    network = true,
    unsupported_server = true,
    partial_failure = true,
}

local function numberValue(value)
    value = tonumber(value)
    if not value or value < 0 then return 0 end
    return value
end

function HighlightSummary.normalize(summary)
    summary = summary or {}
    local normalized = {
        event = summary.event,
        reason = summary.reason,
        at = summary.at or os.time(),
        message = summary.message,
    }
    for _, field in ipairs(COUNT_FIELDS) do
        normalized[field] = numberValue(summary[field])
    end
    return normalized
end

function HighlightSummary.add(summary, result, opts)
    summary = HighlightSummary.normalize(summary)
    result = result or {}
    opts = opts or {}

    for _, field in ipairs(COUNT_FIELDS) do
        summary[field] = summary[field] + numberValue(result[field])
    end
    if opts.skipped then
        summary.skipped = summary.skipped + numberValue(opts.skipped)
    end
    if opts.closed_book and numberValue(result.applied) + numberValue(result.deleted) > 0 then
        summary.touched_books = summary.touched_books + 1
    end
    if result.had_errors and numberValue(result.failed) == 0 then
        summary.failed = summary.failed + 1
    end
    return summary
end

function HighlightSummary.hasCounts(summary)
    summary = HighlightSummary.normalize(summary)
    for _, field in ipairs(COUNT_FIELDS) do
        if summary[field] > 0 then return true end
    end
    return false
end

function HighlightSummary.hasRemoteChanges(summary)
    summary = HighlightSummary.normalize(summary)
    return summary.applied + summary.deleted > 0
end

function HighlightSummary.actionableError(summary, err)
    if ACTIONABLE_ERRORS[err] then return err end
    summary = HighlightSummary.normalize(summary)
    if summary.failed > 0 then return "partial_failure" end
end

function HighlightSummary.message(summary)
    summary = HighlightSummary.normalize(summary)
    local text = T(_("Highlights synced: %1 uploaded, %2 applied, %3 deleted."),
        summary.uploaded, summary.applied, summary.deleted)
    if summary.failed > 0 or summary.skipped > 0 then
        text = text .. "\n" .. T(_("Failed: %1. Skipped: %2."), summary.failed, summary.skipped)
    end
    if summary.touched_books > 0 then
        text = text .. "\n" .. T(_("%1 closed book(s) updated."), summary.touched_books)
    end
    return text
end

function HighlightSummary.diagnosticsText(summary)
    if type(summary) ~= "table" then return _("none") end
    return HighlightSummary.message(summary)
end

return HighlightSummary
