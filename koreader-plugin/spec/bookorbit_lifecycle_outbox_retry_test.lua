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
    max_attempts = 3,
    retry_base_delay = 60,
}

local function snapshotFor(digest)
    return { digest = digest, ts = now, annotations = {}, stats_ids = {}, percentage = 0.5 }
end

-- A book whose file was deleted can never apply its remote changes. It must not
-- keep the entries behind it from draining.
local stuck = assert(outbox:enqueue(snapshotFor("aaaa1111"), { reason = "close" }))
now = 1001
local follower = assert(outbox:enqueue(snapshotFor("bbbb2222"), { reason = "close" }))

assertEqual(outbox:nextEntry().id, stuck.id, "oldest entry drains first")

local generation = stuck.generation
for attempt = 1, 3 do
    now = now + 100000
    local started = assert(outbox:markStarted(stuck.id, generation), "attempt " .. attempt)
    assertEqual(started.attempts, attempt, "attempt counter advances")
    local pending = assert(outbox:recordRemotePending(stuck.id, started.generation,
        "state", { status = "complete" }))
    generation = pending.generation
    outbox:markFinished(stuck.id)
    assertEqual(outbox:isComplete(outbox:readLatest(stuck.id)), false,
        "unapplied remote changes keep the entry")
end

assertEqual(outbox:isBlocked(outbox:readLatestMetadata(stuck.id)), true,
    "the retry budget parks a permanently failing entry")
assertEqual(outbox:nextEntry().id, follower.id,
    "a parked entry does not block newer entries")
assertEqual(outbox:nextEntry{ include_blocked = true }.id, stuck.id,
    "a manual sync still retries parked entries")

local diagnostics = outbox:diagnostics()
assertEqual(diagnostics.count, 2, "both entries are still durable")
assertEqual(diagnostics.blocked, 1, "diagnostics report the parked entry")
assertEqual(diagnostics.drainable, 1, "diagnostics report the drainable entry")

-- Backoff keeps a transiently failing entry from being retried immediately.
local retried = assert(outbox:markStarted(follower.id, follower.generation))
outbox:markFinished(follower.id)
assertEqual(outbox:isDrainable(outbox:readLatestMetadata(follower.id), now), false,
    "a just-attempted entry backs off")
assertEqual(outbox:isDrainable(outbox:readLatestMetadata(follower.id), now + 61), true,
    "backoff expires")
assertEqual(retried.next_attempt_at, now + 60, "first retry uses the base delay")

-- A fresh snapshot supersedes the failures, so the entry becomes drainable
-- again while remote changes that still need applying are carried over.
now = now + 1
local requeued = assert(outbox:enqueue(snapshotFor("aaaa1111"), { reason = "close" }))
assertEqual(requeued.id, stuck.id, "a parked entry is reused, not duplicated")
assertEqual(requeued.attempts, 0, "a fresh snapshot resets the retry budget")
assertEqual(requeued.remote_pending.state.status, "complete",
    "unapplied remote changes survive re-enqueue")
assertEqual(outbox:isBlocked(requeued), false, "the re-enqueued entry is no longer parked")
assertEqual(outbox:nextEntry().id, stuck.id, "the re-enqueued entry drains again")
assertEqual(outbox:diagnostics().count, 2, "re-enqueue does not create a second entry")

-- The entry being drained right now is never replaced underneath the drain.
local active = assert(outbox:markStarted(stuck.id, requeued.generation))
now = now + 1
local while_active = assert(outbox:enqueue(snapshotFor("aaaa1111"), { reason = "close" }))
assert(while_active.id ~= active.id, "an in-flight entry is not overwritten")
outbox:markFinished(stuck.id)

assertEqual(outbox:removeEntry(stuck.id), true, "completed entries are removed")
assertEqual(outbox:readLatest(stuck.id), nil, "removal clears every generation")

fixture:cleanup()
print("bookorbit_lifecycle_outbox_retry_test.lua: ok")
