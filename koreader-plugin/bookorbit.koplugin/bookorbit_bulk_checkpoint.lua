--[[--
Resumable checkpoint for a bulk download run.

One compact record, published with an atomic rename so an interruption can
never leave a half-written checkpoint. It holds the source identity, the
manifest snapshot it was enumerated against, the last fully committed cursor
and bounded per-page completion and failure summaries. It deliberately does not
retain manifest rows: a resumed run re-enumerates from the cursor and validates
already-published files instead.
]]

local DataStorage = require("datastorage")
local dump = require("dump")
local lfs = require("libs/libkoreader-lfs")
local util = require("util")

local CHECKPOINT_DIR = "bookorbit-bulk-download"
local CHECKPOINT_FILE = "checkpoint.lua"
local VERSION = 1
local MAX_COMPLETED = 250
local MAX_FAILURES = 50

local Checkpoint = {}
Checkpoint.__index = Checkpoint

Checkpoint.VERSION = VERSION
Checkpoint.MAX_COMPLETED = MAX_COMPLETED
Checkpoint.MAX_FAILURES = MAX_FAILURES

local function safeLoad(path)
    local chunk = loadfile(path)
    if not chunk then return nil end
    setfenv(chunk, {})
    local ok, value = pcall(chunk)
    if not ok or type(value) ~= "table" then return nil end
    return value
end

function Checkpoint.open(opts)
    opts = opts or {}
    local settings_dir = opts.settings_dir or DataStorage:getSettingsDir()
    local dir = settings_dir .. "/" .. CHECKPOINT_DIR
    return setmetatable({
        dir = dir,
        path = dir .. "/" .. CHECKPOINT_FILE,
        now = opts.now or os.time,
        rename = opts.rename or os.rename,
        remove = opts.remove or os.remove,
        write_file = opts.write_file or function(content, path)
            return util.writeToFile(content, path, true, false, true)
        end,
        make_path = opts.make_path or util.makePath,
        attributes = opts.attributes or lfs.attributes,
        load_record = opts.load_record or safeLoad,
        serialize = opts.serialize or function(record)
            return "return " .. dump(record) .. "\n"
        end,
    }, Checkpoint)
end

function Checkpoint:ensureDirectory()
    if self.attributes(self.dir, "mode") == "directory" then return true end
    self.make_path(self.dir)
    return self.attributes(self.dir, "mode") == "directory"
end

function Checkpoint:load()
    local record = self.load_record(self.path)
    if type(record) ~= "table" or record.version ~= VERSION then return nil end
    if type(record.source_key) ~= "string" or record.source_key == "" then return nil end
    record.completed = type(record.completed) == "table" and record.completed or {}
    record.counts = type(record.counts) == "table" and record.counts or {}
    record.failures = type(record.failures) == "table" and record.failures or {}
    return record
end

local function boundedCompleted(completed)
    local bounded, kept = {}, 0
    for book_id, path in pairs(completed or {}) do
        if kept >= MAX_COMPLETED then break end
        bounded[book_id] = path
        kept = kept + 1
    end
    return bounded
end

local function boundedFailures(failures)
    local bounded = {}
    for index, failure in ipairs(failures or {}) do
        if index > MAX_FAILURES then break end
        table.insert(bounded, { id = failure.id, title = failure.title })
    end
    return bounded
end

function Checkpoint:save(record)
    if not self:ensureDirectory() then return nil, "directory_failed" end
    local stored = {
        version = VERSION,
        source_key = record.source_key,
        label = record.label,
        manifest_version = record.manifest_version,
        cursor = record.cursor,
        chunk_index = record.chunk_index,
        page_number = record.page_number,
        processed = record.processed,
        completed = boundedCompleted(record.completed),
        counts = record.counts,
        failures = boundedFailures(record.failures),
        updated_at = self.now(),
    }

    local temporary = self.path .. ".tmp"
    self.remove(temporary)
    local written, write_err = self.write_file(self.serialize(stored), temporary)
    if not written then
        self.remove(temporary)
        return nil, write_err or "write_failed"
    end
    local renamed, rename_err = self.rename(temporary, self.path)
    if not renamed then
        self.remove(temporary)
        return nil, rename_err or "rename_failed"
    end
    return stored
end

function Checkpoint:clear()
    self.remove(self.path .. ".tmp")
    self.remove(self.path)
end

return Checkpoint
