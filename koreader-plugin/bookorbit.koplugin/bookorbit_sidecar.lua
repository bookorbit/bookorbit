--[[--
Extracts syncable data from a book's sidecar without opening the document.

The normalizers are shared with the per-book snapshot sync, which feeds them
the live in-memory annotation list and summary table instead of sidecar data
(both have the same shape), so server-side annotation keys stay stable no
matter which path uploaded them.
]]

local DocSettings = require("docsettings")
local BookList = require("ui/widget/booklist")
local lfs = require("libs/libkoreader-lfs")

local ALLOWED_DRAWERS = {
    lighten = true,
    underscore = true,
    strikeout = true,
    invert = true,
}

local ALLOWED_STATUSES = {
    reading = true,
    complete = true,
    abandoned = true,
}

local BookOrbitSidecar = {}

function BookOrbitSidecar.sidecarMtime(file)
    local sidecar_file = DocSettings:findSidecarFile(file)
    if not sidecar_file then return nil end
    return lfs.attributes(sidecar_file, "modification")
end

local function isDeviceDatetime(value)
    return type(value) == "string" and value:match("^%d%d%d%d%-%d%d%-%d%d %d%d:%d%d:%d%d$") ~= nil
end

local function isDateOnly(value)
    return type(value) == "string" and value:match("^%d%d%d%d%-%d%d%-%d%d$") ~= nil
end

local function truncate(value, max_len)
    if type(value) ~= "string" then return nil end
    if #value > max_len then
        return value:sub(1, max_len)
    end
    return value
end

-- PDF positions are tables; serialize them canonically by hand so the
-- server-side annotation key (md5 of datetime|pos0) stays stable across syncs.
local function serializePos(pos)
    if type(pos) == "string" then
        return pos, "xpointer"
    end
    if type(pos) == "table" and type(pos.page) == "number" then
        return string.format('{"page":%d,"x":%.2f,"y":%.2f}', pos.page, tonumber(pos.x) or 0, tonumber(pos.y) or 0), "pdf"
    end
    return nil
end

-- Returns normalized annotations plus the max effective datetime; accepts the
-- raw sidecar list or the live ui.annotation.annotations array.
function BookOrbitSidecar.normalizeAnnotations(raw)
    local annotations = {}
    local max_datetime = ""
    for _, a in ipairs(raw or {}) do
        -- drawer == nil marks a position-only bookmark; those are skipped in v1.
        if ALLOWED_DRAWERS[a.drawer] and isDeviceDatetime(a.datetime) then
            local pos0, pos_format = serializePos(a.pos0)
            if pos0 then
                local pos1 = serializePos(a.pos1)
                local entry = {
                    datetime = a.datetime,
                    datetimeUpdated = isDeviceDatetime(a.datetime_updated) and a.datetime_updated or nil,
                    drawer = a.drawer,
                    color = truncate(a.color, 30),
                    text = truncate(a.text, 10000),
                    note = truncate(a.note, 5000),
                    chapter = truncate(a.chapter, 500),
                    pageno = type(a.pageno) == "number" and math.floor(a.pageno) or nil,
                    posFormat = pos_format,
                    pos0 = truncate(pos0, 4000),
                    pos1 = truncate(pos1, 4000),
                }
                table.insert(annotations, entry)
                local effective = entry.datetimeUpdated or entry.datetime
                if effective > max_datetime then
                    max_datetime = effective
                end
            end
        end
    end
    return annotations, max_datetime
end

-- Validates a summary table (sidecar or live doc_settings reference) into a
-- fresh plain table; never returns the input reference.
function BookOrbitSidecar.normalizeSummary(summary)
    if type(summary) ~= "table" then summary = {} end
    local rating = nil
    if type(summary.rating) == "number" and summary.rating >= 1 and summary.rating <= 5 then
        rating = math.floor(summary.rating)
    end
    local review_note = truncate(summary.note, 10000)
    return {
        status = ALLOWED_STATUSES[summary.status] and summary.status or nil,
        status_modified = isDateOnly(summary.modified) and summary.modified or nil,
        rating = rating,
        review_note = review_note,
    }
end

local function dateKey(value)
    if type(value) ~= "string" then return nil end
    local key = value:sub(1, 10)
    return isDateOnly(key) and key or nil
end

local function maxDateKey(a, b)
    if not a then return b end
    if not b then return a end
    return a >= b and a or b
end

function BookOrbitSidecar.stateFromServerResult(result)
    if type(result) ~= "table" then return nil end
    local has_rating = type(result.ratingSet) == "boolean"
    local has_review = type(result.reviewNoteSet) == "boolean"
    if not has_rating and not has_review then return nil end

    local state = {
        rating_known = has_rating,
        rating = has_rating and result.ratingSet and type(result.rating) == "number" and math.floor(result.rating) or nil,
        review_known = has_review,
        review_note = has_review and result.reviewNoteSet and truncate(result.reviewNote, 10000) or nil,
        modified = maxDateKey(dateKey(result.ratingUpdatedAt), dateKey(result.reviewUpdatedAt)),
    }
    return state
end

function BookOrbitSidecar.rememberServerState(book, state)
    if not book or not state then return end
    if state.rating_known then
        book.ratingSyncedKnown = true
        book.ratingSynced = state.rating
    end
    if state.review_known then
        book.reviewSyncedKnown = true
        book.reviewSyncedNote = state.review_note
    end
end

function BookOrbitSidecar.rememberUploadedState(book, summary, payload)
    if not book or not payload then return end
    if payload.rating ~= nil or payload.ratingCleared then
        book.ratingSyncedKnown = true
        book.ratingSynced = summary.rating
    end
    if payload.reviewNote ~= nil or payload.reviewCleared then
        book.reviewSyncedKnown = true
        book.reviewSyncedNote = summary.review_note
    end
end

function BookOrbitSidecar.buildStatePayload(hash, book, summary, force_pull)
    local status_changed = summary.status ~= nil
        and (summary.status_modified or "") ~= (book.statusSyncedModified or "")

    local rating_known = book.ratingSyncedKnown == true or book.ratingSynced ~= nil
    local rating_changed = false
    if summary.rating ~= nil then
        rating_changed = not rating_known or summary.rating ~= book.ratingSynced
    elseif rating_known and book.ratingSynced ~= nil then
        rating_changed = true
    end

    local review_known = book.reviewSyncedKnown == true or book.reviewSyncedNote ~= nil
    local review_changed = false
    if summary.review_note ~= nil then
        review_changed = not review_known or summary.review_note ~= book.reviewSyncedNote
    elseif review_known and book.reviewSyncedNote ~= nil then
        review_changed = true
    end

    if not status_changed and not rating_changed and not review_changed then
        return force_pull and { hash = hash } or nil
    end

    local payload = { hash = hash }
    if status_changed then
        payload.status = summary.status
        payload.statusModified = summary.status_modified
    end
    if rating_changed then
        if summary.rating ~= nil then
            payload.rating = summary.rating
        else
            payload.ratingCleared = true
        end
        payload.statusModified = payload.statusModified or summary.status_modified
    end
    if review_changed then
        if summary.review_note ~= nil then
            payload.reviewNote = summary.review_note
        else
            payload.reviewCleared = true
        end
        payload.reviewModified = summary.status_modified
    end
    return payload, status_changed, rating_changed, review_changed
end

local function applySummary(doc_settings, state)
    if not doc_settings or not state then return false end
    local summary = doc_settings:readSetting("summary") or {}
    local touched = false
    if state.rating_known and summary.rating ~= state.rating then
        summary.rating = state.rating
        touched = true
    end
    if state.review_known and summary.note ~= state.review_note then
        summary.note = state.review_note
        touched = true
    end
    if touched then
        summary.modified = state.modified or os.date("%Y-%m-%d", os.time())
        doc_settings:saveSetting("summary", summary)
    end
    return touched
end

function BookOrbitSidecar.applyServerStateLive(ui, state)
    if not ui or not ui.doc_settings then return false end
    local touched = applySummary(ui.doc_settings, state)
    if touched and ui.document and ui.document.file and state.rating_known then
        BookList.setBookInfoCacheProperty(ui.document.file, "rating", state.rating)
    end
    return touched
end

function BookOrbitSidecar.applyServerStateSidecar(file, state)
    if not file or not state then return false end
    local doc_settings = DocSettings:open(file)
    local touched = applySummary(doc_settings, state)
    if touched then
        doc_settings:flush()
        if state.rating_known then
            BookList.setBookInfoCacheProperty(file, "rating", state.rating)
        end
    end
    return touched
end

function BookOrbitSidecar.extract(file)
    if not DocSettings:hasSidecarFile(file) then return nil end

    local doc_settings = DocSettings:open(file)
    local summary = BookOrbitSidecar.normalizeSummary(doc_settings:readSetting("summary"))
    local annotations, max_datetime = BookOrbitSidecar.normalizeAnnotations(doc_settings:readSetting("annotations"))

    local last_position = doc_settings:readSetting("last_xpointer")
    if not last_position then
        local last_page = doc_settings:readSetting("last_page")
        if last_page then
            last_position = tostring(last_page)
        end
    end

    return {
        md5 = doc_settings:readSetting("partial_md5_checksum"),
        percent_finished = doc_settings:readSetting("percent_finished"),
        last_position = last_position,
        status = summary.status,
        status_modified = summary.status_modified,
        rating = summary.rating,
        review_note = summary.review_note,
        annotations = annotations,
        annotations_count = #annotations,
        annotations_max_datetime = max_datetime,
    }
end

return BookOrbitSidecar
