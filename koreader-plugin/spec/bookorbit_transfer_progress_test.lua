-- Proves the child-to-parent progress channel stays bounded, publishes
-- atomically, throttles its writes and never hands the parent a snapshot from
-- another generation or a malformed file.

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local TransferProgress = require("bookorbit_transfer_progress")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local encoded = TransferProgress.encode({ generation = 3, received = 2048, total = 4096, done = false })
assertEqual(#encoded <= TransferProgress.MAX_SNAPSHOT_BYTES, true, "a snapshot stays bounded")

local decoded = TransferProgress.decode(encoded)
assertEqual(decoded.generation, 3, "generation round-trips")
assertEqual(decoded.received, 2048, "received round-trips")
assertEqual(decoded.total, 4096, "total round-trips")
assertEqual(decoded.done, false, "completion flag round-trips")

assertEqual(TransferProgress.decode(nil), nil, "a missing snapshot decodes to nothing")
assertEqual(TransferProgress.decode(""), nil, "an empty snapshot decodes to nothing")
assertEqual(TransferProgress.decode("garbage"), nil, "a malformed snapshot decodes to nothing")
assertEqual(TransferProgress.decode("bookorbit-progress 99 1 2 3 0"), nil, "an unknown version decodes to nothing")
assertEqual(TransferProgress.decode(string.rep("x", TransferProgress.MAX_SNAPSHOT_BYTES + 1)), nil,
    "an oversized snapshot decodes to nothing")

-- Writes land on a temporary file and only become visible through a rename, so
-- the parent can never read a half-written value.
local store = {}
local writes, renames = 0, 0
local clock = 0
local function makeWriter(opts)
    opts = opts or {}
    return TransferProgress.writer("/tmp/spec.progress", {
        generation = opts.generation or 5,
        total = opts.total or 1000,
        now = function() return clock end,
        write = function(content, path)
            writes = writes + 1
            store[path] = content
            return true
        end,
        rename = function(from, to)
            renames = renames + 1
            store[to] = store[from]
            store[from] = nil
            return true
        end,
        remove = function(path)
            store[path] = nil
        end,
        min_interval = 10,
        min_bytes = 500,
    })
end

local write_progress = makeWriter()
assertEqual(write_progress(100, false), true, "the first snapshot always publishes")
assertEqual(store["/tmp/spec.progress"] ~= nil, true, "the snapshot is visible under its final name")
assertEqual(store["/tmp/spec.progress.tmp"], nil, "no temporary file is left behind")
assertEqual(renames, 1, "publishing uses a rename")

assertEqual(write_progress(200, false), false, "a small, fast update is throttled")
assertEqual(writes, 1, "throttled updates do not write")
assertEqual(write_progress(700, false), true, "a byte-threshold update publishes")
clock = clock + 20
assertEqual(write_progress(750, false), true, "a time-threshold update publishes")
assertEqual(write_progress(760, true), true, "completion always publishes")

local published = TransferProgress.decode(store["/tmp/spec.progress"])
assertEqual(published.done, true, "the final snapshot reports completion")
assertEqual(published.generation, 5, "the child stamps its generation")

-- A failed rename must not leave the temporary file behind.
local failing = TransferProgress.writer("/tmp/spec2.progress", {
    generation = 1,
    now = function() return 0 end,
    write = function(content, path)
        store[path] = content
        return true
    end,
    rename = function() return nil, "injected" end,
    remove = function(path) store[path] = nil end,
})
assertEqual(failing(10, true), false, "a failed publish reports failure")
assertEqual(store["/tmp/spec2.progress.tmp"], nil, "a failed publish removes its temporary file")
assertEqual(store["/tmp/spec2.progress"], nil, "a failed publish leaves nothing visible")

-- Reading filters by generation so a late child cannot drive the parent's UI.
local function readFrom(path)
    return store[path]
end
assertEqual(TransferProgress.read("/tmp/spec.progress", { generation = 5, read = readFrom }).received, 760,
    "the current generation reads its snapshot")
assertEqual(TransferProgress.read("/tmp/spec.progress", { generation = 6, read = readFrom }), nil,
    "a stale generation is ignored")
assertEqual(TransferProgress.read("/tmp/missing.progress", { read = readFrom }), nil,
    "a missing snapshot reads as nothing")

print("bookorbit_transfer_progress_test.lua: ok")
