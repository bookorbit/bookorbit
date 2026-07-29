--[[--
Progress channel between a transfer subprocess and its parent.

A forked child cannot call back into KOReader's UI, so a background transfer
publishes bounded progress snapshots to a generation-scoped file instead. The
parent polls that file from short scheduled callbacks.

Each snapshot is one short line published with an atomic rename, so the parent
never reads a half-written value, malformed content decodes to nothing, and a
snapshot stamped with another generation is ignored rather than displayed.
]]

local MAGIC = "bookorbit-progress"
local VERSION = 1
local MAX_SNAPSHOT_BYTES = 128
local MIN_INTERVAL = 1
local MIN_BYTES = 128 * 1024

local TransferProgress = {}

TransferProgress.MAX_SNAPSHOT_BYTES = MAX_SNAPSHOT_BYTES

function TransferProgress.encode(snapshot)
    snapshot = snapshot or {}
    return string.format("%s %d %d %d %d %d\n",
        MAGIC,
        VERSION,
        math.max(0, math.floor(tonumber(snapshot.generation) or 0)),
        math.max(0, math.floor(tonumber(snapshot.received) or 0)),
        math.max(0, math.floor(tonumber(snapshot.total) or 0)),
        snapshot.done and 1 or 0)
end

function TransferProgress.decode(text)
    if type(text) ~= "string" or text == "" or #text > MAX_SNAPSHOT_BYTES then return nil end
    local magic, version, generation, received, total, done =
        text:match("^(%S+) (%d+) (%d+) (%d+) (%d+) (%d+)%s*$")
    if magic ~= MAGIC or tonumber(version) ~= VERSION then return nil end
    return {
        generation = tonumber(generation),
        received = tonumber(received),
        total = tonumber(total),
        done = done == "1",
    }
end

local function defaultWrite(content, path)
    local handle, err = io.open(path, "w")
    if not handle then return nil, tostring(err or "open_failed") end
    handle:write(content)
    handle:close()
    return true
end

local function defaultRead(path)
    local handle = io.open(path, "r")
    if not handle then return nil end
    local content = handle:read(MAX_SNAPSHOT_BYTES + 1)
    handle:close()
    return content
end

-- Returns writer(received, done). Snapshots are throttled so a fast transfer
-- cannot turn into a write-per-chunk storm on slow device storage; completion
-- always publishes.
function TransferProgress.writer(path, opts)
    opts = opts or {}
    local generation = opts.generation or 0
    local total = opts.total or 0
    local now = opts.now or os.time
    local write = opts.write or defaultWrite
    local rename = opts.rename or os.rename
    local remove = opts.remove or os.remove
    local min_interval = opts.min_interval or MIN_INTERVAL
    local min_bytes = opts.min_bytes or MIN_BYTES
    local temporary = path .. ".tmp"
    local last_at, last_bytes

    return function(received, done)
        received = received or 0
        local at = now()
        if not done and last_at ~= nil
                and received - last_bytes < min_bytes
                and at - last_at < min_interval then
            return false
        end
        last_at, last_bytes = at, received
        local content = TransferProgress.encode({
            generation = generation,
            received = received,
            total = total,
            done = done,
        })
        remove(temporary)
        if not write(content, temporary) then return false end
        if not rename(temporary, path) then
            remove(temporary)
            return false
        end
        return true
    end
end

-- Returns the current snapshot, or nil when the file is absent, malformed or
-- stamped with a generation the caller no longer cares about.
function TransferProgress.read(path, opts)
    opts = opts or {}
    local snapshot = TransferProgress.decode((opts.read or defaultRead)(path))
    if not snapshot then return nil end
    if opts.generation ~= nil and snapshot.generation ~= opts.generation then return nil end
    return snapshot
end

function TransferProgress.cleanup(path, opts)
    opts = opts or {}
    local remove = opts.remove or os.remove
    remove(path .. ".tmp")
    remove(path)
end

return TransferProgress
