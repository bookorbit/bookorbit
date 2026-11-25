--[[--
The last few sync events, kept on the device for the Sync status page.

Each event is a short sentence with an optional detail line. A repeat of the
newest event within ten minutes (a periodic progress push, a retry) replaces
it instead of filling the list, so the page shows what changed, not a log.

An entry keeps what it is (kind, warn, and a detail as a key with its
numbers) next to the words it had when it was recorded, so the page writes it
in the language KOReader uses now. Entries recorded before that, or details
that are not one of the keys below (a book title), show their stored words.
]]

local _ = require("bookorbit_gettext")
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

local ERROR_LABELS = {
    auth = function() return _("login failed") end,
    network = function() return _("server not reachable") end,
    server = function() return _("server request failed") end,
    invalid_json = function() return _("invalid server response") end,
    unsupported_server = function() return _("server update required") end,
    body_too_large = function() return _("request too large") end,
    background_request_interrupted = function() return _("background request interrupted") end,
    partial_failure = function() return _("partial sync failure") end,
    outbox_persistence = function() return _("lifecycle sync could not be saved") end,
}

-- A sync failure in words: a known code, an HTTP status, or the fallback.
function Activity.errorLabel(err, fallback)
    if ERROR_LABELS[err] then return ERROR_LABELS[err]() end
    if err == 401 or err == 403 then return ERROR_LABELS.auth() end
    if type(err) == "number" then return T(_("server error %1"), err) end
    return fallback or tostring(err or _("unknown error"))
end

local DETAILS = {
    reading_upload = function(a)
        return T(_("%1 reading events, %2 highlights uploaded"), a[1] or 0, a[2] or 0)
    end,
    library = function(a)
        local text = T(_("%1 books, %2 reading events, %3 highlights"), a[1] or 0, a[2] or 0, a[3] or 0)
        local ambiguous = tonumber(a[4]) or 0
        if ambiguous <= 0 then return text end
        -- TRANSLATORS: two sentences of a sync summary; %1 is the first, %2 the second.
        return T(_("%1. %2"), text, T(_.ngettext("1 book needs to be opened and synced once to recover its reading history.", "%1 books need to be opened and synced once to recover their reading history.", ambiguous), ambiguous))
    end,
    progress_pushed = function() return _("Progress pushed") end,
    progress_pulled = function() return _("Progress pulled") end,
    connection_ok = function() return _("Connection test succeeded") end,
    error = function(a) return Activity.errorLabel(a[1]) end,
}

-- A detail kept as a key and its values, written out when it is shown.
function Activity.detail(key, ...)
    return { key = key, args = { ... } }
end

-- The words for a detail: a key from Activity.detail, or stored text.
function Activity.detailText(value)
    if type(value) == "table" then
        local render = DETAILS[value.key]
        if render then return render(type(value.args) == "table" and value.args or {}) end
        return nil
    end
    return value
end

-- The words for an entry's first line, in the current language when its kind
-- is known.
function Activity.title(entry)
    if type(entry) ~= "table" then return "" end
    if entry.kind == "highlights" and entry.sent then
        return T(_("Highlights: %1 sent, %2 received"), entry.sent, entry.received or 0)
    end
    local texts = entry.warn and ERROR_TEXT or SUCCESS_TEXT
    local text = texts[entry.kind]
    return text and text() or entry.text or ""
end

-- The words for an entry's detail line, or nil.
function Activity.sub(entry)
    if type(entry) ~= "table" then return nil end
    return entry.detail and Activity.detailText(entry.detail) or entry.sub
end

function Activity.list(settings)
    local log = settings and settings.activity_log
    return type(log) == "table" and log or {}
end

-- entry: { kind, text, sub, detail, warn, sent, received, at }
function Activity.record(settings, entry)
    if type(settings) ~= "table" or type(entry) ~= "table" or not entry.text then return end
    local log = Activity.list(settings)
    local at = entry.at or os.time()
    local head = log[1]
    if head and head.kind == entry.kind and head.text == entry.text and at - (head.at or 0) < MERGE_WINDOW then
        head.at, head.sub, head.detail, head.warn = at, entry.sub, entry.detail, entry.warn or nil
        head.sent, head.received = entry.sent, entry.received
    else
        table.insert(log, 1, {
            kind = entry.kind, text = entry.text, sub = entry.sub, detail = entry.detail, warn = entry.warn or nil,
            sent = entry.sent, received = entry.received, at = at,
        })
    end
    while #log > Activity.MAX do table.remove(log) end
    settings.activity_log = log
end

-- message: words, or a detail from Activity.detail.
local function split(message)
    if type(message) == "table" then return Activity.detailText(message), message end
    return message, nil
end

function Activity.recordSuccess(settings, event, message)
    local text = SUCCESS_TEXT[event]
    if not text then return end
    local sub, detail = split(message)
    Activity.record(settings, { kind = event, text = text(), sub = sub, detail = detail })
end

function Activity.recordError(settings, event, message)
    local text = ERROR_TEXT[event]
    local sub, detail = split(message)
    Activity.record(settings, { kind = event, text = text and text() or _("Sync failed"), sub = sub, detail = detail, warn = true })
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
        sent = sent,
        received = received,
    })
end

return Activity
