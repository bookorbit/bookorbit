-- Proves the bulk download checkpoint publishes atomically, stays bounded, and
-- never hands a resumed run a record it cannot trust.

package.loaded["datastorage"] = {
    getSettingsDir = function() return "/settings" end,
}
package.loaded["dump"] = function(value) return tostring(value) end
package.loaded["libs/libkoreader-lfs"] = { attributes = function() return nil end }
package.loaded["util"] = {
    makePath = function() end,
    writeToFile = function() return true end,
}

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local BulkCheckpoint = require("bookorbit_bulk_checkpoint")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local function countKeys(value)
    local count = 0
    for _ in pairs(value or {}) do count = count + 1 end
    return count
end

local function makeCheckpoint(overrides)
    local store = { files = {}, records = {} }
    local opts = {
        settings_dir = "/settings",
        now = function() return 42 end,
        attributes = function(path)
            return store.files[path] and "directory" or nil
        end,
        make_path = function(path)
            store.files[path] = true
        end,
        write_file = function(content, path)
            if store.fail_write then return nil, "injected_write_failure" end
            store.files[path] = content
            return true
        end,
        rename = function(from, to)
            if store.fail_rename then return nil, "injected_rename_failure" end
            store.files[to] = store.files[from]
            store.records[to] = store.records[from]
            store.files[from] = nil
            store.records[from] = nil
            return true
        end,
        remove = function(path)
            store.files[path] = nil
            store.records[path] = nil
        end,
        load_record = function(path)
            return store.records[path]
        end,
        serialize = function(record)
            store.pending = record
            return "serialized"
        end,
    }
    for key, value in pairs(overrides or {}) do opts[key] = value end
    local checkpoint = BulkCheckpoint.open(opts)
    -- Mirror the published record so load() observes what save() wrote, without
    -- teaching the fake store to parse a serialized Lua chunk.
    local original_save = checkpoint.save
    checkpoint.save = function(self, record)
        local published, err = original_save(self, record)
        if published then store.records[self.path] = published end
        return published, err
    end
    return checkpoint, store
end

local checkpoint, store = makeCheckpoint()

assertEqual(checkpoint:load(), nil, "an absent checkpoint loads as nothing")

local saved = checkpoint:save({
    source_key = "filter|sort=title",
    label = "All books",
    manifest_version = "lib-v1",
    cursor = "cursor-2",
    processed = 120,
    completed = { ["1"] = "/downloads/a.epub" },
    counts = { downloaded = 3 },
    failures = { { id = 9, title = "Broken" } },
})
assertEqual(saved ~= nil, true, "a checkpoint saves")
assertEqual(saved.version, BulkCheckpoint.VERSION, "the record is versioned")
assertEqual(saved.updated_at, 42, "the record is stamped")
assertEqual(store.files["/settings/bookorbit-bulk-download/checkpoint.lua.tmp"], nil,
    "publishing leaves no temporary file behind")

local loaded = checkpoint:load()
assertEqual(loaded.cursor, "cursor-2", "the committed cursor round-trips")
assertEqual(loaded.completed["1"], "/downloads/a.epub", "the completed destination round-trips")
assertEqual(loaded.processed, 120, "the processed count round-trips")

-- A record from an incompatible version is not trusted.
store.records[checkpoint.path] = { version = 999, source_key = "filter|sort=title" }
assertEqual(checkpoint:load(), nil, "an unknown checkpoint version is discarded")
store.records[checkpoint.path] = { version = BulkCheckpoint.VERSION }
assertEqual(checkpoint:load(), nil, "a checkpoint without a source identity is discarded")

-- Completion and failure summaries stay bounded so the record cannot grow with
-- the library.
local wide_completed = {}
for index = 1, BulkCheckpoint.MAX_COMPLETED + 50 do
    wide_completed[tostring(index)] = "/downloads/" .. index .. ".epub"
end
local wide_failures = {}
for index = 1, BulkCheckpoint.MAX_FAILURES + 20 do
    table.insert(wide_failures, { id = index, title = "Book " .. index })
end
local bounded = checkpoint:save({
    source_key = "filter|sort=title",
    completed = wide_completed,
    failures = wide_failures,
    counts = {},
})
assertEqual(countKeys(bounded.completed), BulkCheckpoint.MAX_COMPLETED, "completed destinations stay bounded")
assertEqual(#bounded.failures, BulkCheckpoint.MAX_FAILURES, "failure summaries stay bounded")

-- A failed publish reports the failure and leaves nothing half-written.
store.fail_rename = true
local failed, rename_err = checkpoint:save({ source_key = "filter|sort=title", counts = {} })
assertEqual(failed, nil, "a failed rename reports failure")
assertEqual(rename_err, "injected_rename_failure", "the publish failure reaches the caller")
assertEqual(store.files["/settings/bookorbit-bulk-download/checkpoint.lua.tmp"], nil,
    "a failed publish removes its temporary file")
store.fail_rename = false

checkpoint:clear()
assertEqual(checkpoint:load(), nil, "clearing removes the checkpoint")

print("bookorbit_bulk_checkpoint_test.lua: ok")
