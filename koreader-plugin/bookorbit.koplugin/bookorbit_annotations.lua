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
local UPLOAD_CHUNK = 50

local BookOrbitAnnotations = {}

-- An exchange may be skipped only for a short while. It is the sole channel
-- that delivers server-side highlight changes to the device, and a drained
-- lifecycle entry can be hours old, so an unbounded skip would park web-created
-- highlights until the book's next open.
BookOrbitAnnotations.EXCHANGE_MAX_AGE = 6 * 3600

-- Records that the local set in `signature` was fully exchanged, which is what
-- lets the next drained lifecycle sync skip a book nothing happened to.
function BookOrbitAnnotations.rememberExchanged(book, signature, now)
    if not book or type(signature) ~= "string" or signature == "" then return end
    book.annSignature = signature
    book.annExchangedAt = now or os.time()
end

function BookOrbitAnnotations.canSkipExchange(book, signature, now)
    if not book then return false end
    if type(signature) ~= "string" or signature == "" then return false end
    if book.annSignature ~= signature then return false end
    local exchanged_at = book.annExchangedAt
    if type(exchanged_at) ~= "number" then return false end
    now = now or os.time()
    if exchanged_at > now then return false end
    return (now - exchanged_at) <= BookOrbitAnnotations.EXCHANGE_MAX_AGE
end

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

local function noteHash(note)
    local hash = 5381
    for index = 1, #note do
        hash = (hash * 33 + note:byte(index)) % 4294967296
    end
    return hash
end

-- KOReader stamps datetime_updated only when a save flips an item between
-- highlight and note, so rewriting an existing note's text moves no timestamp
-- and the watermark never sees it. Each exchange remembers the notes it saw;
-- a note that differs from that record was edited since and goes up stamped
-- with the time its snapshot was taken, which is what the server judges edits
-- by. A queued snapshot can be older than the last exchange; stamping it with
-- the upload time would let its stale note overwrite a newer edit.
function BookOrbitAnnotations.noteEditedSince(book, annotation)
    local hashes = book.annNoteHashes
    if type(hashes) ~= "table" or not annotation.note then return false end
    local remembered = hashes[BookOrbitAnnotations.buildKey(annotation.datetime, annotation.pos0)]
    return remembered ~= nil and remembered ~= noteHash(annotation.note)
end

-- Remembers each note in the exchanged set and when. Only notes are kept, and
-- a book past the key cap keeps none, so the state stays small.
function BookOrbitAnnotations.rememberNotes(book, normalized, now)
    if #normalized > MAX_KEYS_PER_BOOK then
        book.annNoteHashes = nil
        book.annNotesAt = nil
        return
    end
    local hashes = {}
    for _, annotation in ipairs(normalized) do
        if annotation.note then
            hashes[BookOrbitAnnotations.buildKey(annotation.datetime, annotation.pos0)] = noteHash(annotation.note)
        end
    end
    book.annNoteHashes = hashes
    book.annNotesAt = now
end

-- An item the server just applied carries the server's stamp, which is newer
-- than the upload watermark (read from the list taken before the pull), so the
-- next exchange would send the server its own copy back. Each applied item's
-- stamp is kept until the watermark passes it; a local change after the apply
-- restamps the item (style, color, a note save) or shows in the note record,
-- and goes up as usual.
local function appliedEntry(annotation)
    local pos0 = annotation.pos0
    if type(pos0) ~= "string" then pos0 = BookOrbitSidecar.serializePos(pos0) end
    if type(annotation.datetime) ~= "string" or annotation.datetime == "" or not pos0 then return nil end
    return {
        key = BookOrbitAnnotations.buildKey(annotation.datetime, pos0),
        stamp = annotation.datetime_updated or annotation.datetime,
    }
end

local function addApplied(stamps, annotation)
    local entry = appliedEntry(annotation)
    if entry then table.insert(stamps, entry) end
end

local function pruneApplied(book)
    local applied = book.annApplied
    if type(applied) ~= "table" then return end
    local watermark = book.annWatermark or ""
    local kept = 0
    for key, stamp in pairs(applied) do
        if stamp <= watermark then applied[key] = nil else kept = kept + 1 end
    end
    if kept == 0 then book.annApplied = nil end
end

function BookOrbitAnnotations.rememberApplied(book, entries)
    if not entries or #entries == 0 then return end
    local applied = type(book.annApplied) == "table" and book.annApplied or {}
    local count = 0
    for _ in pairs(applied) do count = count + 1 end
    for _, entry in ipairs(entries) do
        if applied[entry.key] == nil then count = count + 1 end
        applied[entry.key] = entry.stamp
    end
    -- Past the cap the record is dropped: the cost is one harmless echo per item.
    book.annApplied = count <= MAX_KEYS_PER_BOOK and applied or nil
    pruneApplied(book)
end

function BookOrbitAnnotations.isAppliedCopy(book, annotation, effective)
    local applied = book.annApplied
    if type(applied) ~= "table" then return false end
    return applied[BookOrbitAnnotations.buildKey(annotation.datetime, annotation.pos0)] == effective
end

-- A note rewritten since the notes were remembered, whose own stamp is no
-- later than that moment: nothing dated the rewrite. A highlight just received
-- from the server carries a datetime past the upload watermark, so its first
-- rewrite would otherwise go up with that older datetime and be dropped.
local function needsEditStamp(book, annotation, effective, watermark)
    if not BookOrbitAnnotations.noteEditedSince(book, annotation) then return false end
    return effective <= (book.annNotesAt or watermark)
end

local function editedAt(annotation, datetime)
    local change = {}
    for field, value in pairs(annotation) do change[field] = value end
    change.datetimeUpdated = datetime
    return change
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

local ackApplied
local applyEditFields

local function normalizePos(pos)
    if type(pos) ~= "string" then return "" end
    return util.trim(pos)
end

local function sameRangeAndText(annotation, entry)
    local text = normalizeText(entry.text)
    if text == "" or normalizePos(entry.pos0) == "" then return false end
    if normalizeText(annotation.text) ~= text then return false end
    if normalizePos(annotation.pos0) ~= normalizePos(entry.pos0) then return false end
    local entry_pos1 = normalizePos(entry.pos1)
    if entry_pos1 ~= "" and normalizePos(annotation.pos1) ~= entry_pos1 then return false end
    return true
end

local function rangeKey(item)
    local text = normalizeText(item.text)
    local pos0 = normalizePos(item.pos0)
    if text == "" or pos0 == "" then return nil end
    return text .. "\0" .. pos0
end

--[[--
Identity lookup over one annotation list.

A remote batch resolves every entry against the local list, and a plain scan
per entry makes that quadratic. The index keys both identities the resolver
uses: the exact datetime and the normalized range plus text. Ambiguous keys
(the same datetime or the same range on several entries) deliberately stay on
the scanning path, because that is what the ambiguous case has always resolved
to and the scan order defines which duplicate wins.

The list is mutated during the same pass, so the index tracks that: an append
patches in place, anything that shifts positions (an insert elsewhere, a
removal) marks the index stale and the next lookup rebuilds it.

Every entry of a batch is a different server row, so a local highlight an entry
was matched to or created for is claimed and never resolves another entry.
Without that, two highlights made in the same second arriving in one batch (a
fresh copy re-offered everything) collapse into one: the second matches the
first by datetime and is moved onto it.
]]
local IdentityIndex = {}
IdentityIndex.__index = IdentityIndex

local function addSlot(map, key, index, annotation)
    if not key then return end
    local slot = map[key]
    if slot then
        slot.count = slot.count + 1
        return
    end
    map[key] = { index = index, annotation = annotation, count = 1 }
end

function IdentityIndex:rebuild()
    local by_datetime, by_range = {}, {}
    for index, annotation in ipairs(self.annotations) do
        local datetime = annotation.datetime
        if type(datetime) == "string" and datetime ~= "" then
            addSlot(by_datetime, datetime, index, annotation)
        end
        addSlot(by_range, rangeKey(annotation), index, annotation)
    end
    self.by_datetime = by_datetime
    self.by_range = by_range
    self.stale = false
end

function IdentityIndex.new(annotations)
    local self = setmetatable({ annotations = annotations or {}, claims = {} }, IdentityIndex)
    self:rebuild()
    return self
end

function IdentityIndex:claim(annotation, entry)
    if annotation then self.claims[annotation] = entry end
end

function IdentityIndex:claimedByOther(annotation, entry)
    local owner = self.claims[annotation]
    return owner ~= nil and owner ~= entry
end

function IdentityIndex:invalidate()
    self.stale = true
end

-- Only valid when the annotation really is the new last element; any other
-- insertion shifts later positions and must invalidate instead.
function IdentityIndex:noteAppended(annotation)
    if self.stale then return end
    local index = #self.annotations
    if self.annotations[index] ~= annotation then
        self.stale = true
        return
    end
    local datetime = annotation.datetime
    if type(datetime) == "string" and datetime ~= "" then
        addSlot(self.by_datetime, datetime, index, annotation)
    end
    addSlot(self.by_range, rangeKey(annotation), index, annotation)
end

function IdentityIndex:identityOf(annotation)
    return annotation.datetime, rangeKey(annotation)
end

-- An applied change can rewrite the datetime or the highlighted text, moving
-- the entry's keys. Repointing a key that may be shared with another entry is
-- not safe, so the index is dropped and rebuilt on the next lookup.
function IdentityIndex:noteMutated(annotation, previous_datetime, previous_range_key)
    if self.stale then return end
    if annotation.datetime ~= previous_datetime or rangeKey(annotation) ~= previous_range_key then
        self.stale = true
    end
end

function IdentityIndex:find(entry)
    if self.stale then self:rebuild() end

    local datetime = entry.datetime
    if type(datetime) == "string" and datetime ~= "" then
        local slot = self.by_datetime[datetime]
        if slot and slot.count == 1 and not self:claimedByOther(slot.annotation, entry) then
            return slot.index, slot.annotation
        end
    end

    local key = rangeKey(entry)
    if not key then return nil end
    local slot = self.by_range[key]
    if not slot then return nil end
    if slot.count == 1 then
        if sameRangeAndText(slot.annotation, entry) and not self:claimedByOther(slot.annotation, entry) then
            return slot.index, slot.annotation
        end
        return nil
    end
    for index, annotation in ipairs(self.annotations) do
        if sameRangeAndText(annotation, entry) and not self:claimedByOther(annotation, entry) then
            return index, annotation
        end
    end
end

local function applyIdentityFields(annotation, entry)
    if type(entry.datetime) == "string" and entry.datetime ~= "" then
        annotation.datetime = entry.datetime
    end
    applyEditFields(annotation, entry)
end

local function ackExisting(entry, annotation, verified)
    return ackApplied(entry, {
        verified = verified == true,
        pos0 = annotation.pos0 or entry.pos0,
        pos1 = annotation.pos1 or entry.pos1,
        pageno = type(annotation.pageno) == "number" and annotation.pageno or entry.pageno,
    })
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
    if type(entry.pos0) == "string" and verifyRange(document, entry.pos0, entry.pos0, "") then
        local ok, page = pcall(document.getPageFromXPointer, document, entry.pos0)
        if ok and type(page) == "number" then page_hint = page end
    end

    local ok, hits = pcall(document.findAllText, document, needle, true, 0, 20, false)
    pcall(document.clearSelection, document)
    if not ok or type(hits) ~= "table" or #hits == 0 then return nil end
    if #hits > 1 and not page_hint then return nil end

    local best = hits[1]
    if page_hint and #hits > 1 then
        local best_distance = math.huge
        local ambiguous = false
        for _, hit in ipairs(hits) do
            local okp, page = pcall(document.getPageFromXPointer, document, hit.start)
            if okp and type(page) == "number" then
                local distance = math.abs(page - page_hint)
                if distance < best_distance then
                    best_distance = distance
                    best = hit
                    ambiguous = false
                elseif distance == best_distance then
                    ambiguous = true
                end
            end
        end
        if ambiguous then return nil end
    end
    if verifyRange(document, best.start, best["end"], entry.text) then
        return best.start, best["end"]
    end
    return nil
end

local function updateVerifiedRange(ui, annotation, entry)
    local pos0, pos1 = entry.pos0 or annotation.pos0, entry.pos1 or annotation.pos1
    local corrected = false
    if not verifyRange(ui.document, pos0, pos1, entry.text) then
        pos0, pos1 = repairRange(ui.document, {
            pos0 = pos0, pos1 = pos1, text = entry.text,
        })
        corrected = true
    end
    if not pos0 or not pos1 then return false end
    annotation.page, annotation.pos0, annotation.pos1 = pos0, pos0, pos1
    annotation.bookorbit_pending_verification = nil
    if ui.annotation.updateAnnotations then ui.annotation:updateAnnotations(true, true) end
    return true, corrected
end

ackApplied = function(entry, opts)
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

applyEditFields = function(annotation, entry)
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
    local applied, deleted, stamps = {}, {}, {}
    local document = ui.document
    local annotations = ui.annotation.annotations
    local lookup = IdentityIndex.new(annotations)
    local touched = 0
    local deleted_touched = 0

    for _, entry in ipairs(to_apply.add or {}) do
        local existing_index, existing_annotation = lookup:find(entry)
        lookup:claim(existing_annotation, entry)
        if existing_index then
            local verified, corrected = updateVerifiedRange(ui, existing_annotation, entry)
            if verified then
                applyIdentityFields(existing_annotation, entry)
                lookup:invalidate()
                local index = lookup:find(entry)
                ui:handleEvent(Event:new("AnnotationsModified", { existing_annotation, index_modified = index or existing_index }))
                touched = touched + 1
                addApplied(stamps, existing_annotation)
                local ack = ackExisting(entry, existing_annotation, true)
                ack.corrected = corrected
                table.insert(applied, ack)
            else
                table.insert(applied, ackApplied(entry, { failed = true }))
            end
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
                local index = ui.annotation:addItem(item)
                lookup:noteAppended(item)
                lookup:claim(item, entry)
                if ui.view and ui.view.footer and ui.view.footer.maybeUpdateFooter then
                    pcall(ui.view.footer.maybeUpdateFooter, ui.view.footer)
                end
                ui:handleEvent(Event:new("AnnotationsModified", {
                    item,
                    nb_highlights_added = 1,
                    index_modified = index,
                }))
                touched = touched + 1
                addApplied(stamps, item)
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
        local index, annotation = lookup:find(entry)
        lookup:claim(annotation, entry)
        if not index then
            logger.dbg("BookOrbit: annotation edit target missing:", entry.serverId)
            table.insert(applied, ackApplied(entry, { failed = true }))
        elseif type(annotation.pos0) ~= "string" then
            -- A page-position (PDF) highlight: nothing elsewhere can move it, so only its note,
            -- color and drawer change, and there is no xpointer range to verify.
            applyEditFields(annotation, entry)
            lookup:invalidate()
            local updated_index = lookup:find(entry)
            ui:handleEvent(Event:new("AnnotationsModified", { annotation, index_modified = updated_index or index }))
            touched = touched + 1
            addApplied(stamps, annotation)
            table.insert(applied, ackApplied(entry, {
                verified = true,
                pos0 = BookOrbitSidecar.serializePos(annotation.pos0),
                pos1 = BookOrbitSidecar.serializePos(annotation.pos1),
            }))
        else
            local verified, corrected = updateVerifiedRange(ui, annotation, entry)
            if verified then
                applyEditFields(annotation, entry)
                lookup:invalidate()
                local updated_index = lookup:find(entry)
                ui:handleEvent(Event:new("AnnotationsModified", { annotation, index_modified = updated_index or index }))
                touched = touched + 1
                addApplied(stamps, annotation)
                local ack = ackExisting(entry, annotation, true)
                ack.corrected = corrected
                table.insert(applied, ack)
            else
                table.insert(applied, ackApplied(entry, { failed = true }))
            end
        end
    end

    for _, entry in ipairs(to_apply.delete or {}) do
        local index, annotation = lookup:find(entry)
        if index then
            if ui.paging then
                pcall(ui.highlight.writePdfAnnotation, ui.highlight, "delete", annotation)
            end
            ui.bookmark:removeItemByIndex(index)
            lookup:invalidate()
            touched = touched + 1
            deleted_touched = deleted_touched + 1
        end
        -- Missing entries were already deleted locally; ack either way.
        table.insert(deleted, { serverId = entry.serverId, status = "applied" })
    end

    if touched > 0 then
        UIManager:setDirty("all", "ui")
    end
    return applied, deleted, touched, deleted_touched, stamps
end

-- Merges server changes into the sidecar of a CLOSED book and raises
-- annotations_externally_modified so KOReader re-validates and sorts on open.
function BookOrbitAnnotations.applySidecar(file, to_apply)
    local applied, deleted, stamps = {}, {}, {}
    local doc_settings = DocSettings:open(file)
    local annotations = doc_settings:readSetting("annotations") or {}
    local lookup = IdentityIndex.new(annotations)
    local touched = 0
    local deleted_touched = 0

    for _, entry in ipairs(to_apply.add or {}) do
        if entry.posFormat ~= "xpointer" then
            table.insert(applied, ackApplied(entry, { failed = true }))
        else
            local existing_index, existing = lookup:find(entry)
            lookup:claim(existing, entry)
            if existing_index then
                local previous_datetime, previous_range = lookup:identityOf(existing)
                applyIdentityFields(existing, entry)
                existing.bookorbit_pending_verification = true
                lookup:noteMutated(existing, previous_datetime, previous_range)
                touched = touched + 1
                addApplied(stamps, existing)
            else
                local item = {
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
                    bookorbit_pending_verification = true,
                }
                table.insert(annotations, item)
                lookup:noteAppended(item)
                lookup:claim(item, entry)
                touched = touched + 1
                addApplied(stamps, item)
            end
            -- Unverified until the book is opened; the server keeps it pending.
            table.insert(applied, ackExisting(entry, existing or {
                pos0 = entry.pos0,
                pos1 = entry.pos1,
                pageno = entry.pageno,
            }, false))
        end
    end

    for _, entry in ipairs(to_apply.edit or {}) do
        local index, annotation = lookup:find(entry)
        lookup:claim(annotation, entry)
        if not index then
            table.insert(applied, ackApplied(entry, { failed = true }))
        else
            local previous_datetime, previous_range = lookup:identityOf(annotation)
            applyEditFields(annotation, entry)
            -- Page-position (PDF) entries have no xpointer range for the next open to verify.
            if type(annotation.pos0) == "string" then
                annotation.bookorbit_pending_verification = true
            end
            if entry.pos0 and entry.pos1 then
                annotation.page, annotation.pos0, annotation.pos1 = entry.pos0, entry.pos0, entry.pos1
            end
            lookup:noteMutated(annotation, previous_datetime, previous_range)
            touched = touched + 1
            addApplied(stamps, annotation)
            if type(annotation.pos0) == "string" then
                table.insert(applied, ackApplied(entry, {}))
            else
                table.insert(applied, ackApplied(entry, {
                    verified = true,
                    pos0 = BookOrbitSidecar.serializePos(annotation.pos0),
                    pos1 = BookOrbitSidecar.serializePos(annotation.pos1),
                }))
            end
        end
    end

    for _, entry in ipairs(to_apply.delete or {}) do
        local index = lookup:find(entry)
        if index then
            table.remove(annotations, index)
            lookup:invalidate()
            touched = touched + 1
            deleted_touched = deleted_touched + 1
        end
        table.insert(deleted, { serverId = entry.serverId, status = "applied" })
    end

    if touched > 0 then
        doc_settings:saveSetting("annotations", annotations)
        doc_settings:makeTrue("annotations_externally_modified")
        doc_settings:flush()
    end
    return applied, deleted, touched, deleted_touched, stamps
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
- ann_signature: change signal for that list, recorded on a complete exchange
- captured_at: os.time() the list was read; dates notes rewritten without a timestamp
- sidecar_state: "known", "new" or nil, from BookOrbitSidecar.sidecarState
- apply_mode: "live" | "sidecar" | "skip"
- ui: ReaderUI (required for apply_mode "live")
- file: book file path (required for apply_mode "sidecar")

Returns a result table { uploaded, applied, deleted, failed, had_errors } or
nil, err for auth/network level failures.
]]
function BookOrbitAnnotations.exchangeBook(opts)
    local book = opts.state:getBook(opts.digest)
    if not book then return nil, "unmatched" end

    local keys = BookOrbitAnnotations.collectKeys(opts.key_annotations or opts.annotations)
    local keys_complete = opts.keys_complete ~= false and #keys <= MAX_KEYS_PER_BOOK
    if opts.file and opts.state.hasOtherCopy and opts.state:hasOtherCopy(opts.digest, opts.file) then
        keys_complete = false
    end
    local sidecar_state
    sidecar_state, keys_complete = BookOrbitSidecar.resolveExchangeState(opts.client, opts.sidecar_state, keys_complete)
    if not keys_complete then keys = {} end

    local device_now = os.date("%Y-%m-%d %H:%M:%S")
    local watermark = BookOrbitAnnotations.readWatermark(book, device_now)
    local captured_at = type(opts.captured_at) == "number" and os.date("%Y-%m-%d %H:%M:%S", opts.captured_at) or device_now
    if captured_at > device_now then captured_at = device_now end
    -- A list read before the notes were last remembered (a queued snapshot, a
    -- sidecar older than the open book) is older than what the device already
    -- reported. Its notes are not edits, and must not replace the record.
    local older_list = book.annNotesAt ~= nil and captured_at < book.annNotesAt
    local delta = {}
    for _, annotation in ipairs(opts.annotations) do
        local effective = annotation.datetimeUpdated or annotation.datetime
        if not older_list and needsEditStamp(book, annotation, effective, watermark) then
            table.insert(delta, editedAt(annotation, captured_at))
        elseif effective > watermark and not BookOrbitAnnotations.isAppliedCopy(book, annotation, effective) then
            table.insert(delta, annotation)
        end
    end

    local result = { uploaded = 0, applied = 0, deleted = 0, failed = 0, unverified = 0, had_errors = false }
    local response
    local first_request = true
    local upload_failed = false
    -- Consumed through a head cursor: removing from the front of a Lua array
    -- shifts every remaining element, which turns a long delta into O(n^2).
    local cursor = 1

    repeat
        local chunk = {}
        while cursor <= #delta and #chunk < UPLOAD_CHUNK do
            table.insert(chunk, delta[cursor])
            cursor = cursor + 1
        end
        local body, err = opts.client:exchangeAnnotations({
            {
                hash = opts.digest,
                keys = first_request and keys or {},
                keysComplete = first_request and keys_complete or false,
                sidecarState = first_request and sidecar_state or nil,
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
    until cursor > #delta

    if not upload_failed then
        BookOrbitAnnotations.advanceWatermark(book, opts.ann_max_datetime, device_now)
        pruneApplied(book)
        if not older_list then BookOrbitAnnotations.rememberNotes(book, opts.annotations, captured_at) end
    end

    -- Recorded only when the complete key set went out and nothing was left
    -- undelivered: the skip rule reads this stamp, so anything the server will
    -- re-send must keep the next exchange mandatory.
    local function rememberComplete()
        if upload_failed or result.had_errors or result.failed > 0 or result.unverified > 0 then return end
        if not keys_complete then return end
        BookOrbitAnnotations.rememberExchanged(book, opts.ann_signature)
    end

    if opts.apply_mode == "skip" then
        if response and hasPending(response.toApply) then
            result.remote_pending = {
                to_apply = response.toApply,
                more = response.more == true,
            }
        else
            rememberComplete()
        end
        return result
    end

    local rounds = 0
    local pull_complete = true
    while response and hasPending(response.toApply) do
        if rounds >= MAX_PULL_ROUNDS then
            pull_complete = false
            break
        end
        rounds = rounds + 1
        local applied, deleted, touched, deleted_touched, stamps
        if opts.apply_mode == "live" and opts.ui and opts.ui.document then
            applied, deleted, touched, deleted_touched, stamps = BookOrbitAnnotations.applyLive(opts.ui, response.toApply)
        elseif opts.apply_mode == "sidecar" and opts.file then
            applied, deleted, touched, deleted_touched, stamps = BookOrbitAnnotations.applySidecar(opts.file, response.toApply)
        else
            pull_complete = false
            break
        end

        deleted_touched = deleted_touched or 0
        result.applied = result.applied + math.max(0, touched - deleted_touched)
        result.deleted = result.deleted + deleted_touched
        for _, entry in ipairs(applied) do
            if entry.status == "failed" then result.failed = result.failed + 1 end
            if entry.status == "applied" and entry.verified == false then result.unverified = result.unverified + 1 end
        end

        local ack_body, ack_err = opts.client:exchangeAck({
            { hash = opts.digest, applied = applied, deleted = deleted },
        })
        if not ack_body then
            logger.dbg("BookOrbit: annotation exchange ack failed:", ack_err)
            result.had_errors = true
            break
        end
        BookOrbitAnnotations.rememberApplied(book, stamps)

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

    if pull_complete then rememberComplete() end
    -- Notes the server just applied are the device's notes now; without this
    -- the next exchange would read them as local edits and send them back.
    if not upload_failed and result.applied > 0 and opts.apply_mode == "live" and opts.ui and opts.ui.annotation then
        BookOrbitAnnotations.rememberNotes(book, (BookOrbitSidecar.normalizeAnnotations(opts.ui.annotation.annotations)), os.date("%Y-%m-%d %H:%M:%S"))
    end
    return result
end

-- Convenience wrapper for the open book: collects live annotations, exchanges
-- and applies in place. Used by the reader-ready pull and the manual sync.
function BookOrbitAnnotations.exchangeOpenBook(opts)
    local ui = opts.ui
    if not ui or not ui.document then return nil, "no_document" end
    local annotations, ann_max, signature =
        BookOrbitSidecar.normalizeAnnotations(ui.annotation and ui.annotation.annotations)
    return BookOrbitAnnotations.exchangeBook({
        client = opts.client,
        state = opts.state,
        digest = opts.digest,
        annotations = annotations,
        ann_max_datetime = ann_max,
        ann_signature = signature,
        sidecar_state = opts.sidecar_state,
        apply_mode = "live",
        ui = ui,
        file = ui.document.file,
    })
end

return BookOrbitAnnotations
