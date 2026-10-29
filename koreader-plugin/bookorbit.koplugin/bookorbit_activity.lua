--[[--
The last few sync events, kept on the device for the Sync status page.

Each event is a short sentence with an optional detail line. A repeat of the
newest event within ten minutes (a periodic progress push, a retry) replaces
it instead of filling the list, so the page shows what changed, not a log.
]]

local _ = require("gettext")
local T = require("ffi/util").template

local Activity = {}

Activity.MAX = 12
local MERGE_WINDOW = 10 * 60

local SUCCESS_TEXT = {
    sweep = function() return _("Synced your library") end,
    book_sync = function() return _("Synced this book") end,
    progress_push = function() return _("Sent reading progress") end,
    progress_pull = function() return _("Pulled reading progress") end,
    connection_test = function() return _("Connection test passed") end,
    lifecycle_unmatched = function() return _("Skipped a book not in BookOrbit") end,
}

local ERROR_TEXT = {
    sweep = function() return _("Library sync failed") end,
    book_sync = function() return _("Book sync failed") end,
    progress_push = function() return _("Could not send progress") end,
    progress_pull = function() return _("Could not pull progress") end,
    match_open_book = function() return _("Could not match the open book") end,
    lifecycle_outbox = function() return _("Changes are waiting to send") end,
    connection_test = function() return _("Connection test failed") end,
    update_check = function() return _("Update check failed") end,
    highlight_sync = function() return _("Highlight sync needs attention") end,
}

function Activity.list(settings)
    local log = settings and settings.activity_log
    return type(log) == "table" and log or {}
end

-- entry: { kind, text, sub, warn, at }
function Activity.record(settings, entry)
    if type(settings) ~= "table" or type(entry) ~= "table" or not entry.text then return end
    local log = Activity.list(settings)
    local at = entry.at or os.time()
    local head = log[1]
    if head and head.kind == entry.kind and head.text == entry.text and at - (head.at or 0) < MERGE_WINDOW then
        head.at, head.sub, head.warn = at, entry.sub, entry.warn or nil
    else
        table.insert(log, 1, { kind = entry.kind, text = entry.text, sub = entry.sub, warn = entry.warn or nil, at = at })
    end
    while #log > Activity.MAX do table.remove(log) end
    settings.activity_log = log
end

function Activity.recordSuccess(settings, event, message)
    local text = SUCCESS_TEXT[event]
    if not text then return end
    Activity.record(settings, { kind = event, text = text(), sub = message })
end

function Activity.recordError(settings, event, message)
    local text = ERROR_TEXT[event]
    Activity.record(settings, { kind = event, text = text and text() or _("Sync failed"), sub = message, warn = true })
end

-- Highlights that actually moved; a sync with nothing to exchange says nothing.
function Activity.recordHighlights(settings, summary)
    if type(summary) ~= "table" then return end
    local sent = (summary.uploaded or 0) + (summary.bm_uploaded or 0)
    local received = (summary.applied or 0) + (summary.deleted or 0) + (summary.bm_applied or 0) + (summary.bm_deleted or 0)
    if sent + received == 0 then return end
    Activity.record(settings, {
        kind = "highlights",
        text = T(_("Highlights: %1 sent, %2 received"), sent, received),
    })
end

return Activity
