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

-- Bookmarks are counted separately from highlights: they are a different user
-- surface, and folding them together would make "3 applied" unreadable.
local BOOKMARK_COUNT_FIELDS = {
    "bm_uploaded",
    "bm_applied",
    "bm_deleted",
    "bm_failed",
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
    for _, field in ipairs(BOOKMARK_COUNT_FIELDS) do
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

-- Bookmark exchange results share the highlight result shape, so they are
-- folded into their own counters rather than the highlight ones.
function HighlightSummary.addBookmarks(summary, result)
    summary = HighlightSummary.normalize(summary)
    result = result or {}
    summary.bm_uploaded = summary.bm_uploaded + numberValue(result.uploaded)
    summary.bm_applied = summary.bm_applied + numberValue(result.applied)
    summary.bm_deleted = summary.bm_deleted + numberValue(result.deleted)
    summary.bm_failed = summary.bm_failed + numberValue(result.failed)
    if result.had_errors and numberValue(result.failed) == 0 then
        summary.bm_failed = summary.bm_failed + 1
    end
    return summary
end

function HighlightSummary.hasBookmarkCounts(summary)
    summary = HighlightSummary.normalize(summary)
    for _, field in ipairs(BOOKMARK_COUNT_FIELDS) do
        if summary[field] > 0 then return true end
    end
    return false
end

function HighlightSummary.hasCounts(summary)
    summary = HighlightSummary.normalize(summary)
    for _, field in ipairs(COUNT_FIELDS) do
        if summary[field] > 0 then return true end
    end
    return HighlightSummary.hasBookmarkCounts(summary)
end

function HighlightSummary.hasRemoteChanges(summary)
    summary = HighlightSummary.normalize(summary)
    return summary.applied + summary.deleted > 0
end

function HighlightSummary.hasRemoteBookmarkChanges(summary)
    summary = HighlightSummary.normalize(summary)
    return summary.bm_applied + summary.bm_deleted > 0
end

function HighlightSummary.actionableError(summary, err)
    if ACTIONABLE_ERRORS[err] then return err end
    summary = HighlightSummary.normalize(summary)
    if summary.failed > 0 or summary.bm_failed > 0 then return "partial_failure" end
end

function HighlightSummary.message(summary)
    summary = HighlightSummary.normalize(summary)
    local text = T(_("Highlights synced: %1 uploaded, %2 applied, %3 deleted."),
        summary.uploaded, summary.applied, summary.deleted)
    if summary.failed > 0 or summary.skipped > 0 then
        text = text .. "\n" .. T(_("Failed: %1. Skipped: %2."), summary.failed, summary.skipped)
    end
    if HighlightSummary.hasBookmarkCounts(summary) then
        text = text .. "\n" .. T(_("Bookmarks: %1 uploaded, %2 applied, %3 deleted."),
            summary.bm_uploaded, summary.bm_applied, summary.bm_deleted)
        if summary.bm_failed > 0 then
            text = text .. "\n" .. T(_("Bookmarks failed: %1."), summary.bm_failed)
        end
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
