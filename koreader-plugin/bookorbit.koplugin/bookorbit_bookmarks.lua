--[[--
Two-way exchange of position-only bookmarks (dogears) with BookOrbit.

Mirrors bookorbit_annotations in miniature. A dogear has no highlighted text,
so there is nothing to verify a repaired position against: the device checks
that the server's xpointer resolves and otherwise reports the entry as failed.

Why the whole local set is uploaded instead of a datetime delta: KOReader does
not stamp datetime_updated when the user edits a dogear note, so a watermark
would silently swallow every rename. Dogears are rare per book, the per-book
skip stamp keeps unchanged books off the wire entirely, and the server dedupes
by identity key, so re-sending the set costs one request and loses nothing.

Apply modes:
- live: the book is open; entries go through ReaderAnnotation so the dogear
  indicator, the bookmark list and the footer stay coherent.
- sidecar: the book is closed; entries are merged into the sidecar annotations
  table and annotations_externally_modified is set, so KOReader re-validates
  and re-sorts on next open.
- skip: upload-only (suspend path); pending server changes stay queued.
]]

local DocSettings = require("docsettings")
local Event = require("ui/event")
local UIManager = require("ui/uimanager")
local T = require("ffi/util").template
local _ = require("gettext")
local logger = require("logger")
local md5 = require("ffi/sha2").md5

local BookOrbitCapabilities = require("bookorbit_capabilities")
local BookOrbitSidecar = require("bookorbit_sidecar")

local MAX_KEYS_PER_BOOK = 500
local MAX_PULL_ROUNDS = 10
local UPLOAD_CHUNK = 50

local BookOrbitBookmarks = {}

BookOrbitBookmarks.CAPABILITY = "bookmarkSync"

-- Same bound as the highlight exchange: it is the only channel that delivers
-- web-created bookmarks, so a drained lifecycle entry may not skip forever.
BookOrbitBookmarks.EXCHANGE_MAX_AGE = 6 * 3600

-- Bookmark sync rides the existing two-way toggle and only runs against a
-- server that advertises the route, so a new plugin on an old server stays
-- dormant instead of collecting 404s.
function BookOrbitBookmarks.enabled(client, annotation_sync)
    if not annotation_sync or not client then return false end
    return BookOrbitCapabilities.supports(client, BookOrbitBookmarks.CAPABILITY) == true
end

-- Records a confirmed 404 on the bookmark route so the rest of the session
-- stops asking, matching how the other capability-gated routes downgrade.
function BookOrbitBookmarks.markUnsupported(client)
    if not client then return end
    BookOrbitCapabilities.markUnsupported(client, BookOrbitBookmarks.CAPABILITY)
end

function BookOrbitBookmarks.rememberExchanged(book, signature, now)
    if not book or type(signature) ~= "string" or signature == "" then return end
    book.bmSignature = signature
    book.bmExchangedAt = now or os.time()
end

function BookOrbitBookmarks.canSkipExchange(book, signature, now)
    if not book then return false end
    if type(signature) ~= "string" or signature == "" then return false end
    if book.bmSignature ~= signature then return false end
    local exchanged_at = book.bmExchangedAt
    if type(exchanged_at) ~= "number" then return false end
    now = now or os.time()
    if exchanged_at > now then return false end
    return (now - exchanged_at) <= BookOrbitBookmarks.EXCHANGE_MAX_AGE
end

function BookOrbitBookmarks.buildKey(datetime, pos)
    return md5(datetime .. "|" .. pos)
end

function BookOrbitBookmarks.collectKeys(normalized)
    local keys = {}
    for _, bookmark in ipairs(normalized) do
        table.insert(keys, { k = BookOrbitBookmarks.buildKey(bookmark.datetime, bookmark.pos), dt = bookmark.datetime })
    end
    return keys
end

local function isDogear(annotation)
    return type(annotation) == "table" and annotation.drawer == nil and type(annotation.page) == "string"
end

-- Local identity of a dogear: its position is the only stable handle, and the
-- server addresses deletes by the key it was acked with.
local function findByKey(annotations, key, datetime)
    for index, annotation in ipairs(annotations) do
        if isDogear(annotation) and type(annotation.datetime) == "string" then
            if BookOrbitBookmarks.buildKey(annotation.datetime, annotation.page) == key then
                return index, annotation
            end
        end
    end
    if type(datetime) ~= "string" or datetime == "" then return nil end
    for index, annotation in ipairs(annotations) do
        if isDogear(annotation) and annotation.datetime == datetime then
            return index, annotation
        end
    end
end

-- A datetime is required as well as the position: the ack has to report a local
-- identity, and md5(datetime|pos) cannot be built without one.
local function findByPos(annotations, pos)
    for index, annotation in ipairs(annotations) do
        if isDogear(annotation) and annotation.page == pos and type(annotation.datetime) == "string" then
            return index, annotation
        end
    end
end

local function ackApplied(entry, opts)
    opts = opts or {}
    return {
        serverId = entry.serverId,
        status = opts.failed and "failed" or "applied",
        key = opts.key,
        datetime = opts.datetime,
        pos = opts.pos,
    }
end

local function ackExisting(entry, annotation)
    return ackApplied(entry, {
        key = BookOrbitBookmarks.buildKey(annotation.datetime, annotation.page),
        datetime = annotation.datetime,
        pos = annotation.page,
    })
end

-- The server stores one title per bookmark. A dogear shows its chapter and its
-- note, so a title that already matches the chapter needs no note; anything
-- else is the user's own label and belongs in the note. Both shapes upload back
-- as the same title, so devices and the web converge either way.
local function applyTitleFields(item, title, chapter)
    if chapter and chapter ~= "" then
        item.chapter = chapter
        -- Matches what ReaderBookmark writes for a device-created dogear.
        item.text = T(_("in %1"), chapter)
        item.note = (title and title ~= "" and title ~= chapter) and title or nil
    else
        item.note = (title and title ~= "") and title or nil
    end
end

local function chapterForPos(ui, pos)
    if not ui or not ui.toc or not ui.toc.getTocTitleByPage then return nil end
    local ok, chapter = pcall(ui.toc.getTocTitleByPage, ui.toc, pos)
    if not ok or type(chapter) ~= "string" or chapter == "" then return nil end
    return chapter
end

local function refreshDogear(ui)
    if not ui or not ui.bookmark then return end
    local ok, page = pcall(ui.bookmark.getCurrentPageNumber, ui.bookmark)
    if ok and page ~= nil then
        pcall(ui.bookmark.setDogearVisibility, ui.bookmark, page)
    end
end

-- Applies server changes to the OPEN book through ReaderAnnotation.
function BookOrbitBookmarks.applyLive(ui, to_apply)
    local applied, deleted = {}, {}
    local document = ui.document
    local annotations = ui.annotation.annotations
    local touched, deleted_touched = 0, 0

    for _, entry in ipairs(to_apply.add or {}) do
        local existing_index, existing = findByPos(annotations, entry.pos)
        if existing_index then
            table.insert(applied, ackExisting(entry, existing))
        else
            local ok, resolves = pcall(document.isXPointerInDocument, document, entry.pos)
            if not (ok and resolves) then
                logger.dbg("BookOrbit: bookmark apply failed, position does not resolve:", entry.serverId)
                table.insert(applied, ackApplied(entry, { failed = true }))
            else
                local item = { page = entry.pos }
                applyTitleFields(item, entry.title, chapterForPos(ui, entry.pos))
                local index = ui.annotation:addItem(item)
                touched = touched + 1
                ui:handleEvent(Event:new("AnnotationsModified", { item, index_modified = index }))
                table.insert(applied, ackApplied(entry, {
                    key = BookOrbitBookmarks.buildKey(item.datetime, item.page),
                    datetime = item.datetime,
                    pos = item.page,
                }))
            end
        end
    end

    for _, entry in ipairs(to_apply.delete or {}) do
        local index = findByKey(annotations, entry.key, entry.datetime)
        if index then
            ui.bookmark:removeItemByIndex(index)
            touched = touched + 1
            deleted_touched = deleted_touched + 1
        end
        -- Missing entries were already deleted locally; ack either way.
        table.insert(deleted, { serverId = entry.serverId, status = "applied" })
    end

    if touched > 0 then
        refreshDogear(ui)
        UIManager:setDirty("all", "ui")
    end
    return applied, deleted, touched, deleted_touched
end

-- Merges server changes into the sidecar of a CLOSED book and raises
-- annotations_externally_modified so KOReader re-validates and sorts on open.
function BookOrbitBookmarks.applySidecar(file, to_apply)
    local applied, deleted = {}, {}
    local doc_settings = DocSettings:open(file)
    local annotations = doc_settings:readSetting("annotations") or {}
    local touched, deleted_touched = 0, 0

    for _, entry in ipairs(to_apply.add or {}) do
        local existing_index, existing = findByPos(annotations, entry.pos)
        if existing_index then
            table.insert(applied, ackExisting(entry, existing))
        else
            -- No document is loaded, so the position cannot be verified and no
            -- chapter can be looked up; KOReader drops an unresolvable entry on
            -- the next open, and the server re-pushes it after that.
            local item = { page = entry.pos, datetime = os.date("%Y-%m-%d %H:%M:%S") }
            if type(entry.pageno) == "number" then item.pageno = entry.pageno end
            applyTitleFields(item, entry.title, nil)
            table.insert(annotations, item)
            touched = touched + 1
            table.insert(applied, ackApplied(entry, {
                key = BookOrbitBookmarks.buildKey(item.datetime, item.page),
                datetime = item.datetime,
                pos = item.page,
            }))
        end
    end

    for _, entry in ipairs(to_apply.delete or {}) do
        local index = findByKey(annotations, entry.key, entry.datetime)
        if index then
            table.remove(annotations, index)
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
    return applied, deleted, touched, deleted_touched
end

local function hasPending(to_apply)
    return to_apply and (#(to_apply.add or {}) > 0 or #(to_apply.delete or {}) > 0)
end

--[[--
Full bookmark exchange for one matched book. Blocking; callers run it from a
step machine or a scheduled task.

opts:
- client: BookOrbitApi instance
- state: BookOrbitState instance (book must already be matched)
- digest: partial md5 of the book file
- bookmarks: normalized bookmark list (live or sidecar source)
- bm_signature: change signal for that list, recorded on a complete exchange
- apply_mode: "live" | "sidecar" | "skip"
- ui: ReaderUI (required for apply_mode "live")
- file: book file path (required for apply_mode "sidecar")

Returns a result table { uploaded, applied, deleted, failed, had_errors } or
nil, err for auth/network level failures.
]]
function BookOrbitBookmarks.exchangeBook(opts)
    local book = opts.state:getBook(opts.digest)
    if not book then return nil, "unmatched" end

    local bookmarks = opts.bookmarks or {}
    local keys = BookOrbitBookmarks.collectKeys(bookmarks)
    local keys_complete = #keys <= MAX_KEYS_PER_BOOK
    if not keys_complete then keys = {} end

    local result = { uploaded = 0, applied = 0, deleted = 0, failed = 0, had_errors = false }
    local response
    local first_request = true
    local upload_failed = false
    local cursor = 1

    repeat
        local chunk = {}
        while cursor <= #bookmarks and #chunk < UPLOAD_CHUNK do
            table.insert(chunk, bookmarks[cursor])
            cursor = cursor + 1
        end
        local body, err = opts.client:exchangeBookmarks({
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
            logger.dbg("BookOrbit: bookmark exchange failed:", err)
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
    until cursor > #bookmarks

    -- Recorded only when the complete key set went out and nothing was left
    -- undelivered: the skip rule reads this stamp.
    local function rememberComplete()
        if upload_failed or result.had_errors or result.failed > 0 then return end
        if not keys_complete then return end
        BookOrbitBookmarks.rememberExchanged(book, opts.bm_signature)
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
        local applied, deleted, touched, deleted_touched
        if opts.apply_mode == "live" and opts.ui and opts.ui.document then
            applied, deleted, touched, deleted_touched = BookOrbitBookmarks.applyLive(opts.ui, response.toApply)
        elseif opts.apply_mode == "sidecar" and opts.file then
            applied, deleted, touched, deleted_touched = BookOrbitBookmarks.applySidecar(opts.file, response.toApply)
        else
            pull_complete = false
            break
        end

        deleted_touched = deleted_touched or 0
        result.applied = result.applied + math.max(0, touched - deleted_touched)
        result.deleted = result.deleted + deleted_touched
        for _, entry in ipairs(applied) do
            if entry.status == "failed" then result.failed = result.failed + 1 end
        end

        local ack_body, ack_err = opts.client:exchangeBookmarksAck({
            { hash = opts.digest, applied = applied, deleted = deleted },
        })
        if not ack_body then
            logger.dbg("BookOrbit: bookmark exchange ack failed:", ack_err)
            result.had_errors = true
            break
        end

        if not response.more then break end
        local body, err = opts.client:exchangeBookmarks({
            { hash = opts.digest, keys = {}, keysComplete = false, changes = {} },
        })
        if not body then
            logger.dbg("BookOrbit: bookmark exchange follow-up failed:", err)
            result.had_errors = true
            break
        end
        response = body.results and body.results[1] or nil
    end

    if pull_complete then rememberComplete() end
    return result
end

-- Convenience wrapper for the open book: collects live dogears, exchanges and
-- applies in place.
function BookOrbitBookmarks.exchangeOpenBook(opts)
    local ui = opts.ui
    if not ui or not ui.document then return nil, "no_document" end
    -- Paging documents store page numbers, which normalizeBookmarks drops, so a
    -- PDF simply produces an empty set instead of needing its own branch.
    local bookmarks, _max, signature =
        BookOrbitSidecar.normalizeBookmarks(ui.annotation and ui.annotation.annotations)
    return BookOrbitBookmarks.exchangeBook({
        client = opts.client,
        state = opts.state,
        digest = opts.digest,
        bookmarks = bookmarks,
        bm_signature = signature,
        apply_mode = "live",
        ui = ui,
    })
end

return BookOrbitBookmarks
