--[[--
Durable outbox for lifecycle (close/suspend) book syncs.

Close and suspend handlers must not run network I/O, so they capture a snapshot
and persist it here instead. A later drain replays it. Each entry is stored as
an immutable payload file (the snapshot) plus a small metadata file per
generation, so phase acknowledgements never rewrite the snapshot.

Entries that keep failing are retried with backoff and eventually parked as
"blocked" rather than removed: automatic drains skip them so they cannot block
newer entries, while a manual sync retries everything.
]]

local DataStorage = require("datastorage")
local dump = require("dump")
local lfs = require("libs/libkoreader-lfs")
local util = require("util")

local OUTBOX_DIR = "bookorbit-lifecycle-outbox"
local ENTRY_VERSION = 1
local SOFT_ENTRY_LIMIT = 100
local SOFT_BYTE_LIMIT = 50 * 1024 * 1024
local HARD_ENTRY_LIMIT = 1000
local HARD_BYTE_LIMIT = 200 * 1024 * 1024
local MAX_ATTEMPTS = 5
local RETRY_BASE_DELAY = 60
local RETRY_MAX_DELAY = 3600
local KEEP_GENERATIONS = 2

local PHASES = { "match", "stats", "annotations", "state", "progress" }

local Outbox = {}
Outbox.__index = Outbox

local next_id = 0

local function copyArray(values)
    local result = {}
    for _, value in ipairs(values or {}) do
        table.insert(result, value)
    end
    return result
end

local function validDigest(digest)
    return type(digest) == "string" and digest ~= "" and digest:match("^%x+$") ~= nil
end

local function validId(id)
    return type(id) == "string" and id:match("^entry_%x+_%d+_%d+$") ~= nil
end

local function generationFilename(id, generation)
    return string.format("%s_g%d.lua", id, generation)
end

local function payloadFilename(id, generation)
    return string.format("%s_payload_g%d.lua", id, generation)
end

local function safeLoad(path)
    local chunk = loadfile(path)
    if not chunk then return nil end
    setfenv(chunk, {})
    local ok, value = pcall(chunk)
    if not ok or type(value) ~= "table" then return nil end
    return value
end

local function descending(a, b) return a > b end

function Outbox.open(opts)
    opts = opts or {}
    local settings_dir = opts.settings_dir or DataStorage:getSettingsDir()
    local dir = settings_dir .. "/" .. OUTBOX_DIR
    local self = setmetatable({
        dir = dir,
        now = opts.now or os.time,
        rename = opts.rename or os.rename,
        remove = opts.remove or os.remove,
        write_file = opts.write_file or function(content, path)
            return util.writeToFile(content, path, true, false, true)
        end,
        make_path = opts.make_path or util.makePath,
        list_dir = opts.list_dir or lfs.dir,
        attributes = opts.attributes or lfs.attributes,
        load_entry = opts.load_entry or safeLoad,
        serialize = opts.serialize or function(entry)
            return "return " .. dump(entry) .. "\n"
        end,
        serialize_payload = opts.serialize_payload or opts.serialize or function(payload)
            return "return " .. dump(payload) .. "\n"
        end,
        soft_entry_limit = opts.soft_entry_limit or SOFT_ENTRY_LIMIT,
        soft_byte_limit = opts.soft_byte_limit or SOFT_BYTE_LIMIT,
        hard_entry_limit = opts.hard_entry_limit or HARD_ENTRY_LIMIT,
        hard_byte_limit = opts.hard_byte_limit or HARD_BYTE_LIMIT,
        max_attempts = opts.max_attempts or MAX_ATTEMPTS,
        retry_base_delay = opts.retry_base_delay or RETRY_BASE_DELAY,
        retry_max_delay = opts.retry_max_delay or RETRY_MAX_DELAY,
    }, Outbox)
    return self
end

function Outbox:ensureDirectory()
    if self.attributes(self.dir, "mode") == "directory" then return true end
    self.scan_cache = nil
    return self.make_path(self.dir) == true
end

function Outbox:path(id, generation)
    assert(validId(id), "invalid outbox entry id")
    assert(type(generation) == "number" and generation >= 1, "invalid outbox generation")
    return self.dir .. "/" .. generationFilename(id, generation)
end

function Outbox:payloadPath(id, generation)
    assert(validId(id), "invalid outbox entry id")
    assert(type(generation) == "number" and generation >= 1, "invalid outbox payload generation")
    return self.dir .. "/" .. payloadFilename(id, generation)
end

-- One directory listing feeds every lookup below. The close handler calls into
-- this repeatedly, so the result is cached until something is written.
function Outbox:scan()
    if self.scan_cache then return self.scan_cache end
    local grouped = { entries = {}, bytes = 0 }
    if self.attributes(self.dir, "mode") ~= "directory" then
        self.scan_cache = grouped
        return grouped
    end
    local ok, iterator, dir_obj = pcall(self.list_dir, self.dir)
    if not ok or not iterator then
        self.scan_cache = grouped
        return grouped
    end
    local function entryFor(id)
        local record = grouped.entries[id]
        if not record then
            record = { generations = {}, payloads = {} }
            grouped.entries[id] = record
        end
        return record
    end
    for filename in iterator, dir_obj do
        local id, generation = filename:match("^(entry_%x+_%d+_%d+)_g(%d+)%.lua$")
        if id then
            table.insert(entryFor(id).generations, tonumber(generation))
        else
            local payload_id, payload_generation = filename:match(
                "^(entry_%x+_%d+_%d+)_payload_g(%d+)%.lua$")
            if payload_id then
                table.insert(entryFor(payload_id).payloads, tonumber(payload_generation))
            end
        end
        if filename:match("^entry_.*%.lua$") then
            grouped.bytes = grouped.bytes
                + (tonumber(self.attributes(self.dir .. "/" .. filename, "size")) or 0)
        end
    end
    self.scan_cache = grouped
    return grouped
end

function Outbox:invalidateScan()
    self.scan_cache = nil
end

function Outbox:generationsFor(id)
    local record = self:scan().entries[id]
    return record and record.generations or {}
end

local function validMetadata(metadata, id, generation)
    return metadata and metadata.version == ENTRY_VERSION and metadata.id == id
        and metadata.generation == generation and validDigest(metadata.digest)
        and type(metadata.payload_generation) == "number"
        and type(metadata.acknowledged) == "table"
end

function Outbox:readLatestMetadata(id, generations)
    generations = generations or copyArray(self:generationsFor(id))
    table.sort(generations, descending)
    for _, generation in ipairs(generations) do
        local metadata = self.load_entry(self:path(id, generation))
        if validMetadata(metadata, id, generation) then return metadata end
    end
end

function Outbox:attachPayload(metadata)
    if not metadata then return nil end
    local payload = self.load_entry(self:payloadPath(metadata.id, metadata.payload_generation))
    if payload and payload.version == ENTRY_VERSION and payload.id == metadata.id
            and payload.digest == metadata.digest and type(payload.snapshot) == "table" then
        metadata.snapshot = payload.snapshot
        return metadata
    end
end

function Outbox:readLatest(id, generations)
    generations = generations or copyArray(self:generationsFor(id))
    table.sort(generations, descending)
    for _, generation in ipairs(generations) do
        local metadata = self.load_entry(self:path(id, generation))
        if validMetadata(metadata, id, generation) then
            local entry = self:attachPayload(metadata)
            if entry then return entry end
        end
    end
end

function Outbox:listMetadata()
    local entries = {}
    for id, record in pairs(self:scan().entries) do
        local entry = self:readLatestMetadata(id, copyArray(record.generations))
        if entry then table.insert(entries, entry) end
    end
    table.sort(entries, function(a, b)
        if a.enqueued_at == b.enqueued_at then return a.id < b.id end
        return a.enqueued_at < b.enqueued_at
    end)
    return entries
end

function Outbox:list()
    local entries = {}
    for _, metadata in ipairs(self:listMetadata()) do
        local entry = self:attachPayload(metadata)
        if entry then table.insert(entries, entry) end
    end
    return entries
end

function Outbox:isBlocked(entry)
    return entry ~= nil and (entry.attempts or 0) >= self.max_attempts
end

-- Automatic drains only take entries that are not parked and not backing off,
-- so a permanently undeliverable entry cannot stall the ones behind it.
function Outbox:isDrainable(entry, now)
    if not entry then return false end
    if self.active_id and entry.id == self.active_id then return false end
    if self:isBlocked(entry) then return false end
    if entry.next_attempt_at and entry.next_attempt_at > (now or self.now()) then return false end
    return true
end

function Outbox:nextEntry(opts)
    opts = opts or {}
    local now = self.now()
    for _, metadata in ipairs(self:listMetadata()) do
        if opts.include_blocked or self:isDrainable(metadata, now) then
            local entry = self:attachPayload(metadata)
            if entry then return entry end
        end
    end
end

function Outbox:status()
    local scan = self:scan()
    local count = 0
    for _, record in pairs(scan.entries) do
        if #record.generations > 0 and #record.payloads > 0 then count = count + 1 end
    end
    local bytes = scan.bytes
    return {
        count = count,
        bytes = bytes,
        soft_limit = count >= self.soft_entry_limit or bytes >= self.soft_byte_limit,
        hard_limit = count >= self.hard_entry_limit or bytes >= self.hard_byte_limit,
    }
end

-- Diagnostics needs the per-entry attempt counts, which means reading metadata.
-- Only the menu calls this, never the close path.
function Outbox:diagnostics()
    local status = self:status()
    local blocked, drainable = 0, 0
    local now = self.now()
    for _, metadata in ipairs(self:listMetadata()) do
        if self:isBlocked(metadata) then
            blocked = blocked + 1
        elseif self:isDrainable(metadata, now) then
            drainable = drainable + 1
        end
    end
    status.blocked = blocked
    status.drainable = drainable
    return status
end

function Outbox:pruneOldGenerations(id, keep_generation)
    local generations = copyArray(self:generationsFor(id))
    table.sort(generations, descending)
    local kept = 0
    local surviving = {}
    for _, generation in ipairs(generations) do
        if generation > keep_generation then
            table.insert(surviving, generation)
        else
            kept = kept + 1
            if kept > KEEP_GENERATIONS then
                self.remove(self:path(id, generation))
                self:invalidateScan()
            else
                table.insert(surviving, generation)
            end
        end
    end

    local payloads_to_keep = {}
    for _, generation in ipairs(surviving) do
        local metadata = self.load_entry(self:path(id, generation))
        if metadata and type(metadata.payload_generation) == "number" then
            payloads_to_keep[metadata.payload_generation] = true
        end
    end
    for _, payload_generation in ipairs(copyArray((self:scan().entries[id] or {}).payloads)) do
        if not payloads_to_keep[payload_generation] then
            self.remove(self:payloadPath(id, payload_generation))
            self:invalidateScan()
        end
    end
end

function Outbox:publish(content, path)
    if not self:ensureDirectory() then return nil, "directory_failed" end
    local temporary = path .. ".tmp"
    self.remove(temporary)
    local ok, err = self.write_file(content, temporary)
    if not ok then
        self.remove(temporary)
        return nil, err or "write_failed"
    end
    local renamed, rename_err = self.rename(temporary, path)
    self:invalidateScan()
    if not renamed then
        self.remove(temporary)
        return nil, rename_err or "rename_failed"
    end
    return true
end

function Outbox:savePayload(entry, content)
    local payload = {
        version = ENTRY_VERSION,
        id = entry.id,
        digest = entry.digest,
        snapshot = entry.snapshot,
    }
    return self:publish(
        content or self.serialize_payload(payload),
        self:payloadPath(entry.id, entry.payload_generation))
end

function Outbox:save(entry)
    local metadata = {}
    for key, value in pairs(entry) do
        if key ~= "snapshot" then metadata[key] = value end
    end
    local saved, err = self:publish(
        self.serialize(metadata),
        self:path(entry.id, entry.generation))
    if not saved then return nil, err end
    self:pruneOldGenerations(entry.id, entry.generation)
    return entry
end

local function allAcknowledged(entry)
    for _, phase in ipairs(PHASES) do
        if entry.acknowledged[phase] ~= true then return false end
    end
    return entry.remote_pending == nil
end

function Outbox:isComplete(entry)
    return entry ~= nil and allAcknowledged(entry)
end

function Outbox:allocateId(digest, now)
    local entries = self:scan().entries
    for _ = 1, 1000 do
        next_id = next_id + 1
        local candidate = string.format("entry_%s_%d_%d", digest, now, next_id)
        if not entries[candidate] then return candidate end
    end
end

function Outbox:enqueue(snapshot, opts)
    opts = opts or {}
    if type(snapshot) ~= "table" or not validDigest(snapshot.digest) then
        return nil, "invalid_snapshot"
    end
    local status = self:status()

    local existing
    for _, entry in ipairs(self:listMetadata()) do
        if entry.digest == snapshot.digest and entry.id ~= self.active_id then
            existing = entry
        end
    end
    if status.hard_limit and not existing then return nil, "hard_limit" end

    local now = self.now()
    local id = existing and existing.id or self:allocateId(snapshot.digest, now)
    if not id then return nil, "id_exhausted" end

    local stored_snapshot = {}
    for key, value in pairs(snapshot) do stored_snapshot[key] = value end
    stored_snapshot.stats_ids = copyArray(snapshot.stats_ids)

    local annotation_sync = opts.annotation_sync ~= false
    local entry = {
        version = ENTRY_VERSION,
        id = id,
        generation = existing and existing.generation + 1 or 1,
        payload_generation = existing and existing.payload_generation + 1 or 1,
        digest = stored_snapshot.digest,
        enqueued_at = existing and existing.enqueued_at or now,
        captured_at = stored_snapshot.ts or now,
        reason = opts.reason or "lifecycle",
        snapshot = stored_snapshot,
        acknowledged = {
            match = false,
            stats = stored_snapshot.stats_metadata_ambiguous == true,
            annotations = false,
            state = false,
            progress = type(stored_snapshot.percentage) ~= "number",
        },
        annotation_sync = annotation_sync,
        -- A fresh snapshot supersedes earlier failures, so the retry budget
        -- resets. Remote changes that still need applying are carried over.
        attempts = 0,
        remote_pending = existing and existing.remote_pending or nil,
    }
    local payload_content = self.serialize_payload({
        version = ENTRY_VERSION,
        id = entry.id,
        digest = entry.digest,
        snapshot = entry.snapshot,
    })
    local projected_count = status.count + (existing and 0 or 1)
    local projected_bytes = status.bytes + #payload_content
    if projected_count > self.hard_entry_limit or projected_bytes > self.hard_byte_limit then
        return nil, "hard_limit"
    end
    local payload_saved, payload_err = self:savePayload(entry, payload_content)
    if not payload_saved then return nil, payload_err end
    local saved, err = self:save(entry)
    if not saved then return nil, err end
    return saved, {
        count = projected_count,
        bytes = projected_bytes,
        soft_limit = projected_count >= self.soft_entry_limit
            or projected_bytes >= self.soft_byte_limit,
        hard_limit = false,
    }
end

function Outbox:update(id, expected_generation, mutate)
    local entry = self:readLatestMetadata(id)
    if not entry then return nil, "not_found" end
    if expected_generation and entry.generation ~= expected_generation then
        return nil, "stale_generation"
    end
    mutate(entry)
    entry.generation = entry.generation + 1
    return self:save(entry)
end

function Outbox:retryDelay(attempts)
    local delay = self.retry_base_delay * 2 ^ math.max(0, attempts - 1)
    return math.min(delay, self.retry_max_delay)
end

function Outbox:markStarted(id, generation)
    local now = self.now()
    local updated, err = self:update(id, generation, function(entry)
        entry.started_at = entry.started_at or now
        entry.last_attempt_at = now
        entry.attempts = (entry.attempts or 0) + 1
        entry.next_attempt_at = now + self:retryDelay(entry.attempts)
    end)
    if not updated then return nil, err end
    self.active_id = id
    return self:readLatest(id)
end

function Outbox:markFinished(id)
    if self.active_id == id then self.active_id = nil end
end

function Outbox:acknowledge(id, generation, phase)
    return self:update(id, generation, function(entry)
        assert(entry.acknowledged[phase] ~= nil, "invalid outbox phase")
        entry.acknowledged[phase] = true
        entry.last_ack_at = self.now()
    end)
end

function Outbox:recordRemotePending(id, generation, kind, payload)
    return self:update(id, generation, function(entry)
        entry.remote_pending = entry.remote_pending or {}
        entry.remote_pending[kind] = payload or true
    end)
end

function Outbox:clearRemotePending(id, generation, kind)
    return self:update(id, generation, function(entry)
        if entry.remote_pending then
            entry.remote_pending[kind] = nil
            if next(entry.remote_pending) == nil then entry.remote_pending = nil end
        end
    end)
end

function Outbox:removeEntry(id)
    local record = self:scan().entries[id]
    if not record then
        self:markFinished(id)
        return false
    end
    local removed = false
    for _, generation in ipairs(copyArray(record.generations)) do
        removed = self.remove(self:path(id, generation)) or removed
    end
    for _, generation in ipairs(copyArray(record.payloads)) do
        removed = self.remove(self:payloadPath(id, generation)) or removed
    end
    self:invalidateScan()
    self:markFinished(id)
    return removed
end

return Outbox
