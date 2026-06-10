--[[--
Extracts syncable data from a book's sidecar without opening the document.

The normalizers are shared with the per-book snapshot sync, which feeds them
the live in-memory annotation list and summary table instead of sidecar data
(both have the same shape), so server-side annotation keys stay stable no
matter which path uploaded them.
]]

local DocSettings = require("docsettings")
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
    return {
        status = ALLOWED_STATUSES[summary.status] and summary.status or nil,
        status_modified = isDateOnly(summary.modified) and summary.modified or nil,
        rating = rating,
    }
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
        annotations = annotations,
        annotations_count = #annotations,
        annotations_max_datetime = max_datetime,
    }
end

return BookOrbitSidecar
