package.path = "koreader-plugin/bookorbit.koplugin/?.lua;koreader-plugin/spec/?.lua;" .. package.path

package.loaded["datastorage"] = { getSettingsDir = function() return "/unused" end }
package.loaded["dump"] = function() return "{}" end
package.loaded["libs/libkoreader-lfs"] = {
    attributes = function() return nil end,
    dir = function() return function() end end,
}
package.loaded["util"] = {
    makePath = function() return false end,
    writeToFile = function() return false end,
}

local Outbox = require("bookorbit_lifecycle_outbox")
local TempFilesystem = require("helpers/temp_filesystem")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local fixture = TempFilesystem.new()
local now = 1000
local outbox = Outbox.open{
    settings_dir = fixture.path,
    now = function() return now end,
    rename = function(from, to) return fixture:rename(from, to) end,
    remove = os.remove,
    write_file = function(content, path) return fixture:write(content, path) end,
    make_path = function(path) return fixture:makePath(path) end,
    list_dir = function(path) return fixture:list(path) end,
    attributes = function(path, attribute) return fixture:attributes(path, attribute) end,
    serialize = function(value) return fixture:serialize(value) end,
}

local snapshot = {
    digest = "abcdef1234",
    ts = 990,
    file = "/books/moved.epub",
    percentage = 0.5,
    progress = "/4/2",
    annotations = { { datetime = "2026-01-01", pos0 = "/1" } },
    stats_ids = { 17, 23 },
}

local first = assert(outbox:enqueue(snapshot, { reason = "close", annotation_sync = true }))
assertEqual(outbox:status().count, 1, "first entry is durable")
assertEqual(first.snapshot.annotations[1].pos0, "/1", "captured annotations are stored")
assertEqual(first.snapshot.stats_ids[2], 23, "stable statistics ids are stored")

now = 1001
local replacement = assert(outbox:enqueue(snapshot, { reason = "suspend", annotation_sync = true }))
assertEqual(replacement.id, first.id, "unstarted snapshot is deduplicated by digest")
assertEqual(replacement.generation, first.generation + 1, "dedupe publishes a new generation")
assertEqual(outbox:status().count, 1, "dedupe keeps one logical entry")

fixture.fail_write = true
local failed, failure = outbox:enqueue(snapshot, { reason = "close" })
fixture.fail_write = false
assertEqual(failed, nil, "injected persistence failure is reported")
assertEqual(failure, "injected_write_failure", "write failure is preserved")
assertEqual(outbox:readLatest(first.id).generation, replacement.generation,
    "failed publish preserves the previous durable generation")

fixture.fail_rename = true
local rename_failed, rename_failure = outbox:enqueue(snapshot, { reason = "close" })
fixture.fail_rename = false
assertEqual(rename_failed, nil, "injected rename failure is reported")
assertEqual(rename_failure, "injected_rename_failure", "rename failure is preserved")
assertEqual(outbox:readLatest(first.id).generation, replacement.generation,
    "failed atomic rename preserves the previous durable generation")

local started = assert(outbox:markStarted(replacement.id, replacement.generation))
now = 1002
local second = assert(outbox:enqueue(snapshot, { reason = "close", annotation_sync = true }))
assert(second.id ~= started.id, "started entry is not overwritten by a newer snapshot")
assertEqual(outbox:status().count, 2, "started and newer snapshots coexist")

local payload_path = outbox:payloadPath(started.id, started.payload_generation)
local payload_file = assert(io.open(payload_path, "rb"))
local payload_before_ack = payload_file:read("*a")
payload_file:close()
local generation = started.generation
for _, phase in ipairs({ "match", "stats", "annotations", "state", "progress" }) do
    local updated = assert(outbox:acknowledge(started.id, generation, phase))
    generation = updated.generation
end
payload_file = assert(io.open(payload_path, "rb"))
local payload_after_ack = payload_file:read("*a")
payload_file:close()
assertEqual(payload_after_ack, payload_before_ack,
    "phase acknowledgements do not rewrite the immutable snapshot payload")
local acknowledged = outbox:readLatest(started.id)
assertEqual(outbox:isComplete(acknowledged), true, "all phase acknowledgements complete an entry")

local pending = assert(outbox:recordRemotePending(started.id, acknowledged.generation,
    "annotations", { to_apply = { add = { { serverId = "remote-1" } } } }))
assertEqual(outbox:isComplete(pending), false, "unapplied remote changes retain the entry")
local cleared = assert(outbox:clearRemotePending(started.id, pending.generation, "annotations"))
assertEqual(outbox:isComplete(cleared), true, "recorded remote outcome can complete the entry")

local stale, stale_err = outbox:acknowledge(started.id, started.generation, "progress")
assertEqual(stale, nil, "stale generation cannot overwrite newer state")
assertEqual(stale_err, "stale_generation", "stale generation is identified")

local fallback_snapshot = {
    digest = "1234abcd",
    ts = 1003,
    annotations = {},
    stats_ids = {},
}
local fallback_first = assert(outbox:enqueue(fallback_snapshot, { annotation_sync = false }))
local fallback_latest = assert(outbox:enqueue(fallback_snapshot, { annotation_sync = false }))
assert(fixture:write("not valid lua", outbox:path(fallback_latest.id, fallback_latest.generation)))
assertEqual(outbox:readLatest(fallback_latest.id).generation, fallback_first.generation,
    "recovery falls back to the last readable generation")

outbox.hard_entry_limit = outbox:status().count
local blocked, blocked_err = outbox:enqueue({
    digest = "9999aaaa",
    annotations = {},
    stats_ids = {},
}, { annotation_sync = false })
assertEqual(blocked, nil, "hard threshold applies user-visible backpressure")
assertEqual(blocked_err, "hard_limit", "hard threshold never evicts pending entries")

fixture:cleanup()
print("bookorbit_lifecycle_outbox_test.lua: ok")
