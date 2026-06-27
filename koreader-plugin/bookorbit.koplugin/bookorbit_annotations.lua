--[[--
Two-way annotation exchange with BookOrbit.

Uploads local highlight changes, applies server-side changes (web-created
highlights, note/style edits, deletions) and reports back an acknowledgment so
the server only marks entries delivered once they really landed on-device.

Apply modes:
- live: the book is open; entries are verified against crengine
  (isXPointerInDocument + getTextFromXPointers) and repaired through
  findAllText when the server-generated xpointer does not resolve to the
  highlighted text. crengine has the final word; corrected positions are sent
  back in the ack so the server stores them.
- sidecar: the book is closed; entries are merged into the sidecar annotations
  table and annotations_externally_modified is set, the same path KOHighlights
  uses, so KOReader re-validates and re-sorts on next open.
- skip: upload-only (suspend path); pending server changes stay queued because
  no ack is sent for them.
]]

local DocSettings = require("docsettings")
local Event = require("ui/event")
local UIManager = require("ui/uimanager")
local logger = require("logger")
local md5 = require("ffi/sha2").md5
local util = require("util")

local BookOrbitSidecar = require("bookorbit_sidecar")

local MAX_KEYS_PER_BOOK = 5000
local MAX_PULL_ROUNDS = 10

local BookOrbitAnnotations = {}

function BookOrbitAnnotations.buildKey(datetime, pos0)
    return md5(datetime .. "|" .. pos0)
end

-- Returns the stored upload watermark, resetting it when it sits in the
-- device's future: bad data there (e.g. a server that minted UTC datetimes)
-- would swallow every new annotation. The re-upload is a server-side no-op.
function BookOrbitAnnotations.readWatermark(book, device_now)
    local watermark = book.annWatermark or ""
    if watermark > device_now then
        watermark = ""
        book.annWatermark = ""
    end
    return watermark
end

-- Advances the watermark, capped at the device clock so a future-dated entry
-- cannot freeze it; such an entry just re-uploads until time passes it.
function BookOrbitAnnotations.advanceWatermark(book, ann_max_datetime, device_now)
    if not ann_max_datetime or ann_max_datetime == "" then return end
    local advance = ann_max_datetime
    if advance > device_now then
        advance = device_now
    end
    if advance > (book.annWatermark or "") then
        book.annWatermark = advance
    end
end

-- Key list for deletion detection, built from normalized entries so the
-- serialized pos0 matches what the server hashed at upload time.
function BookOrbitAnnotations.collectKeys(normalized)
    local keys = {}
    for _, a in ipairs(normalized) do
        table.insert(keys, { k = BookOrbitAnnotations.buildKey(a.datetime, a.pos0), dt = a.datetime })
    end
    return keys
end

local function normalizeText(text)
    if type(text) ~= "string" then return "" end
    return util.trim(text:gsub("%s+", " "))
end

local function findByDatetime(annotations, datetime)
    for index, a in ipairs(annotations or {}) do
        if a.datetime == datetime then
            return index, a
        end
    end
end

-- crengine verification: both endpoints must resolve and, when the server
-- knows the highlighted text, the extracted range must match it.
local function verifyRange(document, pos0, pos1, text)
    if type(pos0) ~= "string" or type(pos1) ~= "string" then return false end
    local ok0, in0 = pcall(document.isXPointerInDocument, document, pos0)
    local ok1, in1 = pcall(document.isXPointerInDocument, document, pos1)
    if not (ok0 and in0 and ok1 and in1) then return false end
    local wanted = normalizeText(text)
    if wanted == "" then return true end
    local ok, extracted = pcall(document.getTextFromXPointers, document, pos0, pos1)
    return ok and type(extracted) == "string" and normalizeText(extracted) == wanted
end

-- Re-anchors an entry by searching its highlighted text, picking the hit
-- nearest to the page the broken xpointer pointed at (when derivable).
local function repairRange(document, entry)
    local needle = type(entry.text) == "string" and util.trim(entry.text) or ""
    if needle == "" or not document.findAllText then return nil end

    local page_hint
    if type(entry.pos0) == "string" then
        local ok, page = pcall(document.getPageFromXPointer, document, entry.pos0)
        if ok and type(page) == "number" then page_hint = page end
    end

    local ok, hits = pcall(document.findAllText, document, needle, true, 0, 20, false)
    pcall(document.clearSelection, document)
    if not ok or type(hits) ~= "table" or #hits == 0 then return nil end

    local best = hits[1]
    if page_hint and #hits > 1 then
        local best_distance = math.huge
        for _, hit in ipairs(hits) do
            local okp, page = pcall(document.getPageFromXPointer, document, hit.start)
            if okp and type(page) == "number" then
                local distance = math.abs(page - page_hint)
                if distance < best_distance then
                    best_distance = distance
                    best = hit
                end
            end
        end
    end
    if verifyRange(document, best.start, best["end"], entry.text) then
        return best.start, best["end"]
    end
    return nil
end

local function ackApplied(entry, opts)
    return {
        serverId = entry.serverId,
        version = entry.version,
        status = opts.failed and "failed" or "applied",
        verified = opts.verified or false,
        corrected = opts.corrected or false,
        pos0 = opts.pos0,
        pos1 = opts.pos1,
        pageno = opts.pageno,
        datetimeUpdated = entry.datetimeUpdated,
    }
end

local function applyEditFields(annotation, entry)
    annotation.drawer = entry.drawer or annotation.drawer
    annotation.color = entry.color or annotation.color
    if entry.text and entry.text ~= "" then annotation.text = entry.text end
    annotation.note = entry.note
    if entry.chapter then annotation.chapter = entry.chapter end
    if entry.datetimeUpdated then annotation.datetime_updated = entry.datetimeUpdated end
end

-- Applies server changes to the OPEN book through ReaderAnnotation, so the
-- view, footer and bookmark list stay coherent. Returns ack tables.
function BookOrbitAnnotations.applyLive(ui, to_apply)
    local applied, deleted = {}, {}
    local document = ui.document
    local annotations = ui.annotation.annotations
    local touched = 0

    for _, entry in ipairs(to_apply.add or {}) do
        local existing_index = findByDatetime(annotations, entry.datetime)
        if existing_index then
            -- Idempotent retry of an earlier apply that lost its ack.
            table.insert(applied, ackApplied(entry, { verified = true, pos0 = entry.pos0, pos1 = entry.pos1 }))
        elseif entry.posFormat ~= "xpointer" or not ui.rolling then
            -- PDF adds from the web are out of scope; never expected here.
            table.insert(applied, ackApplied(entry, { failed = true }))
        else
            local pos0, pos1 = entry.pos0, entry.pos1
            local verified = verifyRange(document, pos0, pos1, entry.text)
            local corrected = false
            if not verified then
                local repaired0, repaired1 = repairRange(document, entry)
                if repaired0 then
                    pos0, pos1 = repaired0, repaired1
                    verified = true
                    corrected = true
                end
            end
            if not verified then
                logger.dbg("BookOrbit: annotation apply failed, no verifiable position:", entry.serverId)
                table.insert(applied, ackApplied(entry, { failed = true }))
            else
                local item = {
                    datetime = entry.datetime,
                    datetime_updated = entry.datetimeUpdated,
                    drawer = entry.drawer,
                    color = entry.color,
                    text = entry.text,
                    note = entry.note,
                    chapter = entry.chapter,
                    page = pos0,
                    pos0 = pos0,
                    pos1 = pos1,
                }
                ui.annotation:addItem(item)
                ui:handleEvent(Event:new("AnnotationsModified", { item, nb_highlights_added = 1 }))
                touched = touched + 1
                table.insert(applied, ackApplied(entry, {
                    verified = true,
                    corrected = corrected,
                    pos0 = pos0,
                    pos1 = pos1,
                    pageno = type(item.pageno) == "number" and item.pageno or nil,
                }))
            end
        end
    end

    for _, entry in ipairs(to_apply.edit or {}) do
        local index, annotation = findByDatetime(annotations, entry.datetime)
        if not index then
            logger.dbg("BookOrbit: annotation edit target missing:", entry.serverId)
            table.insert(applied, ackApplied(entry, { failed = true }))
        else
            applyEditFields(annotation, entry)
            ui:handleEvent(Event:new("AnnotationsModified", { annotation, index_modified = index }))
            touched = touched + 1
            table.insert(applied, ackApplied(entry, { verified = true }))
        end
    end

    for _, entry in ipairs(to_apply.delete or {}) do
        local index, annotation = findByDatetime(annotations, entry.datetime)
        if index then
            if ui.paging then
                pcall(ui.highlight.writePdfAnnotation, ui.highlight, "delete", annotation)
            end
            ui.bookmark:removeItemByIndex(index)
            touched = touched + 1
        end
        -- Missing entries were already deleted locally; ack either way.
        table.insert(deleted, { serverId = entry.serverId, status = "applied" })
    end

    if touched > 0 then
        UIManager:setDirty("all", "ui")
    end
    return applied, deleted, touched
end

-- Merges server changes into the sidecar of a CLOSED book and raises
-- annotations_externally_modified so KOReader re-validates and sorts on open.
function BookOrbitAnnotations.applySidecar(file, to_apply)
    local applied, deleted = {}, {}
    local doc_settings = DocSettings:open(file)
    local annotations = doc_settings:readSetting("annotations") or {}
    local touched = 0

    for _, entry in ipairs(to_apply.add or {}) do
        if entry.posFormat ~= "xpointer" then
            table.insert(applied, ackApplied(entry, { failed = true }))
        else
            local existing = findByDatetime(annotations, entry.datetime)
            if not existing then
                table.insert(annotations, {
                    datetime = entry.datetime,
                    datetime_updated = entry.datetimeUpdated,
                    drawer = entry.drawer,
                    color = entry.color,
                    text = entry.text,
                    note = entry.note,
                    chapter = entry.chapter,
                    pageno = entry.pageno,
                    page = entry.pos0,
                    pos0 = entry.pos0,
                    pos1 = entry.pos1,
                })
                touched = touched + 1
            end
            -- Unverified until the book is opened; the server keeps it pending.
            table.insert(applied, ackApplied(entry, { pos0 = entry.pos0, pos1 = entry.pos1, pageno = entry.pageno }))
        end
    end

    for _, entry in ipairs(to_apply.edit or {}) do
        local index, annotation = findByDatetime(annotations, entry.datetime)
        if not index then
            table.insert(applied, ackApplied(entry, { failed = true }))
        else
            applyEditFields(annotation, entry)
            touched = touched + 1
            table.insert(applied, ackApplied(entry, {}))
        end
    end

    for _, entry in ipairs(to_apply.delete or {}) do
        local index = findByDatetime(annotations, entry.datetime)
        if index then
            table.remove(annotations, index)
            touched = touched + 1
        end
        table.insert(deleted, { serverId = entry.serverId, status = "applied" })
    end

    if touched > 0 then
        doc_settings:saveSetting("annotations", annotations)
        doc_settings:makeTrue("annotations_externally_modified")
        doc_settings:flush()
    end
    return applied, deleted, touched
end

local function hasPending(to_apply)
    return to_apply and (#(to_apply.add or {}) > 0 or #(to_apply.edit or {}) > 0 or #(to_apply.delete or {}) > 0)
end

--[[--
Full annotation exchange for one matched book. Blocking; callers run it from a
step machine or a scheduled task.

opts:
- client: BookOrbitApi instance
- state: BookOrbitState instance (book must already be matched)
- digest: partial md5 of the book file
- annotations: normalized annotation list (live or sidecar source)
- ann_max_datetime: max effective datetime of that list
- apply_mode: "live" | "sidecar" | "skip"
- ui: ReaderUI (required for apply_mode "live")
- file: book file path (required for apply_mode "sidecar")

Returns a result table { uploaded, applied, deleted, failed, had_errors } or
nil, err for auth/network level failures.
]]
function BookOrbitAnnotations.exchangeBook(opts)
    local book = opts.state:getBook(opts.digest)
    if not book then return nil, "unmatched" end

    local keys = BookOrbitAnnotations.collectKeys(opts.annotations)
    local keys_complete = #keys <= MAX_KEYS_PER_BOOK
    if not keys_complete then keys = {} end

    local device_now = os.date("%Y-%m-%d %H:%M:%S")
    local watermark = BookOrbitAnnotations.readWatermark(book, device_now)
    local delta = {}
    for _, annotation in ipairs(opts.annotations) do
        local effective = annotation.datetimeUpdated or annotation.datetime
        if effective > watermark then
            table.insert(delta, annotation)
        end
    end

    local result = { uploaded = 0, applied = 0, deleted = 0, failed = 0, had_errors = false }
    local response
    local first_request = true
    local upload_failed = false

    repeat
        local chunk = {}
        while #delta > 0 and #chunk < 50 do
            table.insert(chunk, table.remove(delta, 1))
        end
        local body, err = opts.client:exchangeAnnotations({
            {
                hash = opts.digest,
                keys = first_request and keys or {},
                keysComplete = first_request and keys_complete or false,
                changes = chunk,
            },
        })
        if not body then
            if err == 401 or err == 403 then return nil, "auth" end
            if err == 404 then return nil, "unsupported_server" end
            if type(err) ~= "number" then return nil, "network" end
            logger.dbg("BookOrbit: annotation exchange failed:", err)
            result.had_errors = true
            upload_failed = true
            break
        end
        for _, hash in ipairs(body.unmatched or {}) do
            if hash == opts.digest then
                opts.state:setUnmatched(opts.digest)
                return nil, "unmatched"
            end
        end
        response = body.results and body.results[1] or nil
        result.uploaded = result.uploaded + #chunk
        first_request = false
    until #delta == 0

    if not upload_failed then
        BookOrbitAnnotations.advanceWatermark(book, opts.ann_max_datetime, device_now)
    end

    if opts.apply_mode == "skip" then
        return result
    end

    local rounds = 0
    while response and hasPending(response.toApply) and rounds < MAX_PULL_ROUNDS do
        rounds = rounds + 1
        local applied, deleted, touched
        if opts.apply_mode == "live" and opts.ui and opts.ui.document then
            applied, deleted, touched = BookOrbitAnnotations.applyLive(opts.ui, response.toApply)
        elseif opts.apply_mode == "sidecar" and opts.file then
            applied, deleted, touched = BookOrbitAnnotations.applySidecar(opts.file, response.toApply)
        else
            break
        end

        result.applied = result.applied + touched
        for _, entry in ipairs(applied) do
            if entry.status == "failed" then result.failed = result.failed + 1 end
        end

        local ack_body, ack_err = opts.client:exchangeAck({
            { hash = opts.digest, applied = applied, deleted = deleted },
        })
        if not ack_body then
            logger.dbg("BookOrbit: annotation exchange ack failed:", ack_err)
            result.had_errors = true
            break
        end

        if not response.more then break end
        local body, err = opts.client:exchangeAnnotations({
            { hash = opts.digest, keys = {}, keysComplete = false, changes = {} },
        })
        if not body then
            logger.dbg("BookOrbit: annotation exchange follow-up failed:", err)
            result.had_errors = true
            break
        end
        response = body.results and body.results[1] or nil
    end

    return result
end

-- Convenience wrapper for the open book: collects live annotations, exchanges
-- and applies in place. Used by the reader-ready pull and the manual sync.
function BookOrbitAnnotations.exchangeOpenBook(opts)
    local ui = opts.ui
    if not ui or not ui.document then return nil, "no_document" end
    local annotations, ann_max = BookOrbitSidecar.normalizeAnnotations(ui.annotation and ui.annotation.annotations)
    return BookOrbitAnnotations.exchangeBook({
        client = opts.client,
        state = opts.state,
        digest = opts.digest,
        annotations = annotations,
        ann_max_datetime = ann_max,
        apply_mode = "live",
        ui = ui,
    })
end

return BookOrbitAnnotations
