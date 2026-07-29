-- Proves the central state manager shares one parse, caches the combined
-- on-device maps against a generation, patches them forward after a link and
-- refuses a mutation prepared against an older generation.

local function deepCopy(value)
    if type(value) ~= "table" then return value end
    local copy = {}
    for key, item in pairs(value) do
        copy[key] = deepCopy(item)
    end
    return copy
end

local disk = { books = {}, unmatched = {}, files = {}, global = {} }
local parses = 0
local flushes = 0
local fail_flush = false

package.loaded["datastorage"] = {
    getSettingsDir = function()
        return "/tmp/bookorbit-state-manager-test"
    end,
}
package.loaded["luasettings"] = {
    open = function(_, _)
        parses = parses + 1
        local data = deepCopy(disk)
        return {
            readSetting = function(_, key, default)
                if data[key] == nil then data[key] = default end
                return data[key]
            end,
            atomicFlush = function()
                if fail_flush then error("disk full") end
                flushes = flushes + 1
                disk = deepCopy(data)
                return true
            end,
        }
    end,
}
package.loaded["dump"] = function()
    return "{}"
end
package.loaded["ffi/util"] = {
    fsyncOpenedFile = function() end,
    fsyncDirectory = function() end,
}

local existing_files = {}
local attribute_calls = 0
package.loaded["libs/libkoreader-lfs"] = {
    attributes = function(path, attribute)
        attribute_calls = attribute_calls + 1
        if not existing_files[path] then return nil end
        return attribute == "mode" and "file" or { mode = "file" }
    end,
}

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local StateManager = require("bookorbit_state_manager")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

disk.books = {
    aaa = { bookId = 1, fileId = 11, file = "/books/a.epub" },
    bbb = { bookId = 2, fileId = 22, file = "/books/b.epub" },
    ccc = { bookId = 3, fileId = 33, file = "/books/gone.epub" },
}
existing_files["/books/a.epub"] = true
existing_files["/books/b.epub"] = true

-- Sessions are isolated while the manager still parses the settings file once.
parses = 0
local first = StateManager.state()
local second = StateManager.state()
assertEqual(first == second, false, "state() returns isolated sessions")
assertEqual(parses, 1, "sessions share one parsed persistent owner")

-- Both maps come from a single pass with one existence check per stored file.
attribute_calls = 0
local maps = StateManager.onDeviceMaps()
assertEqual(attribute_calls, 3, "one existence check per matched book")
assertEqual(maps.byBookId[1], "/books/a.epub", "book id map")
assertEqual(maps.byFileId[22], "/books/b.epub", "book file id map")
assertEqual(maps.byBookId[3], nil, "missing file is not on device")

-- A repaint reuses the cached maps: no rescan, no filesystem probe.
attribute_calls = 0
local repeated = StateManager.onDeviceMaps()
assertEqual(attribute_calls, 0, "cached maps do not rescan")
assertEqual(repeated, maps, "cached maps are reused")
assertEqual(StateManager.generation(), maps.generation, "generation is stable between reads")

-- Explicit invalidation advances the cache generation, so a catalog holding
-- the old maps can detect that they are no longer current.
local old_generation = maps.generation
StateManager.invalidate()
assertEqual(StateManager.generation() > old_generation, true, "invalidation advances generation")
local adopted, adopt_err = StateManager.adoptOnDeviceMaps(maps)
assertEqual(adopted, nil, "stale derived maps are refused")
assertEqual(adopt_err, "stale_generation", "stale maps report their generation")
maps = StateManager.onDeviceMaps()

-- Linking a downloaded file patches the maps forward instead of rescanning.
existing_files["/books/c.epub"] = true
attribute_calls = 0
flushes = 0
local linked_generation = StateManager.linkFile("ddd", 44, 4, "/books/c.epub")
assertEqual(flushes, 1, "linking flushes once")
assertEqual(attribute_calls, 0, "linking does not rescan the matched library")
local after_link = StateManager.onDeviceMaps()
assertEqual(attribute_calls, 0, "maps after linking are still cached")
assertEqual(after_link.byBookId[4], "/books/c.epub", "linked book id is on device")
assertEqual(after_link.byFileId[44], "/books/c.epub", "linked book file id is on device")
assertEqual(after_link.generation, linked_generation, "patched maps carry the new generation")
assertEqual(disk.books.ddd.bookId, 4, "link is persisted")

-- Bulk linking applies a whole batch in one flush, because every flush rewrites
-- the entire sync-state file.
existing_files["/books/d.epub"] = true
existing_files["/books/e.epub"] = true
attribute_calls = 0
flushes = 0
local batch_generation = StateManager.linkFiles({
    { digest = "eee", bookFileId = 55, bookId = 5, file = "/books/d.epub" },
    { digest = "fff", bookFileId = 66, bookId = 6, file = "/books/e.epub" },
})
assertEqual(flushes, 1, "a link batch flushes once for every file in it")
assertEqual(attribute_calls, 0, "batched linking does not rescan the matched library")
local after_batch = StateManager.onDeviceMaps()
assertEqual(after_batch.byBookId[5], "/books/d.epub", "the first batched link is on device")
assertEqual(after_batch.byFileId[66], "/books/e.epub", "the second batched link is on device")
assertEqual(after_batch.generation, batch_generation, "patched maps carry the batch generation")
assertEqual(disk.books.fff.bookId, 6, "every batched link is persisted")

-- A session write publishes a new generation, so the next read rebuilds rather
-- than serving a stale map.
local state = StateManager.session({ digests = { "bbb" }, global = false })
state:setUnmatched("bbb")
state:flush()
attribute_calls = 0
local rebuilt = StateManager.onDeviceMaps()
assertEqual(attribute_calls, 5, "an external write forces one rebuild")
assertEqual(rebuilt.byBookId[2], nil, "unmatched book leaves the map")
assertEqual(rebuilt.byBookId[1], "/books/a.epub", "unaffected entries survive")

-- Nested mutations join the outermost change and flush once.
flushes = 0
StateManager.mutate(function(outer)
    outer.global.marker = "outer"
    StateManager.mutate(function(inner)
        inner.global.nested = "inner"
    end)
end)
assertEqual(flushes, 1, "nested mutation flushes once")
assertEqual(disk.global.marker, "outer", "outer mutation persisted")
assertEqual(disk.global.nested, "inner", "nested mutation persisted")

-- A failed mutation is discarded instead of leaking into a later flush.
local failed = pcall(function()
    StateManager.mutate(function(current)
        current.global.leaked = "partial"
        error("stop")
    end)
end)
assertEqual(failed, false, "failed mutation is reported")
StateManager.mutate(function(current)
    current.global.after_failure = true
end)
assertEqual(disk.global.leaked, nil, "failed mutation is never persisted")
assertEqual(disk.global.after_failure, true, "later mutation still succeeds")

-- A persistence failure reloads the last durable generation instead of
-- leaving the failed mutation live for a later unrelated flush.
fail_flush = true
local persisted = pcall(function()
    StateManager.mutate(function(current)
        current.global.not_durable = true
    end)
end)
fail_flush = false
assertEqual(persisted, false, "flush failure is reported")
StateManager.mutate(function(current)
    current.global.after_disk_recovery = true
end)
assertEqual(disk.global.not_durable, nil, "failed flush is rolled back in memory")
assertEqual(disk.global.after_disk_recovery, true, "writes recover after flush failure")

-- A long-running scoped session merges its unrelated field changes with a
-- newer published update to the same book.
local book_session = StateManager.session({ digests = { "aaa" }, global = false })
book_session.books.aaa.annCount = 7
StateManager.mutateScoped({ digests = { "aaa" }, global = false }, function(current)
    current.books.aaa.fileId = 99
end)
book_session:flush()
assertEqual(disk.books.aaa.annCount, 7, "session field is committed")
assertEqual(disk.books.aaa.fileId, 99, "newer concurrent field is preserved")

-- A caller that prepared its change before another path published is refused.
local stale_generation = StateManager.generation()
StateManager.mutate(function(current)
    current.global.winner = "newer"
end)
flushes = 0
local committed, err = StateManager.commit(stale_generation, function(current)
    current.global.winner = "older"
end)
assertEqual(committed, nil, "stale generation is refused")
assertEqual(err, "stale_generation", "stale generation reports why")
assertEqual(flushes, 0, "refused mutation does not write")
assertEqual(disk.global.winner, "newer", "newer state survives the stale writer")

local fresh = StateManager.commit(StateManager.generation(), function(current)
    current.global.winner = "current"
end)
assertEqual(type(fresh), "number", "current generation commits")
assertEqual(disk.global.winner, "current", "current generation writes")

-- Reload replaces only the persistent owner. Existing sessions remain isolated
-- and cannot overwrite the new value when they later flush.
local holder = StateManager.session()
disk.global.winner = "external"
parses = 0
StateManager.reload()
assertEqual(parses, 1, "reload reparses once")
assertEqual(holder.global.winner, "current", "existing session remains isolated")
holder.global.local_only = true
holder:flush()
assertEqual(disk.global.winner, "external", "reload value survives stale session flush")
assertEqual(disk.global.local_only, true, "non-conflicting session field is merged")

-- A catalog-only scan can be computed before the persistent owner is opened.
-- Adopting and reading those maps does not parse state again in the parent.
StateManager.reset()
parses = 0
local computed = StateManager.computeOnDeviceMaps()
assertEqual(parses, 1, "standalone map computation opens state once")
assertEqual(computed.byBookId, nil, "transport does not expose a sparse book id map")
assertEqual(computed.byFileId, nil, "transport does not expose a sparse file id map")
assertEqual(type(computed.bookEntries[1].id), "number", "book ids travel as record values")
assertEqual(type(computed.bookEntries[1].file), "string", "book paths travel as record values")
assertEqual(type(computed.fileEntries[1].id), "number", "file ids travel as record values")
assertEqual(StateManager.adoptOnDeviceMaps(computed) ~= nil, true, "fresh maps are adopted")
local transported_maps = StateManager.onDeviceMaps()
assertEqual(parses, 1, "adopted maps do not open the persistent owner")
assertEqual(transported_maps.byBookId[1], "/books/a.epub", "adoption rebuilds the numeric book id map")
assertEqual(transported_maps.byFileId[99], "/books/a.epub", "adoption rebuilds the sparse numeric file id map")

local invalid_maps, invalid_maps_err = StateManager.adoptOnDeviceMaps({
    bookEntries = { { id = "1", file = "/books/a.epub" } },
    fileEntries = {},
    generation = StateManager.generation(),
})
assertEqual(invalid_maps, nil, "malformed transport records are refused")
assertEqual(invalid_maps_err, "invalid_maps", "malformed maps report their error")

print("bookorbit_state_manager_test.lua: ok")
