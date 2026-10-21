-- Proves the parent side of a background transfer: progress is polled from the
-- child's snapshot file, publishing happens in the parent under an authorized
-- root, a cancelled generation publishes nothing, and stale temporaries from a
-- killed run are swept before the next one.

local scheduled = {}
package.loaded["ui/uimanager"] = {
    scheduleIn = function(_, delay, callback)
        table.insert(scheduled, { delay = delay, callback = callback })
    end,
}

local directories = {
    ["/.bookorbit-tmp"] = true,
    ["/downloads/.bookorbit-tmp"] = true,
}
local files = {}
local now = 1000
local links = {}
package.loaded["libs/libkoreader-lfs"] = {
    symlinkattributes = function(path)
        return links[path] and "link" or nil
    end,
    attributes = function(path, attribute)
        if directories[path] then
            if attribute == "mode" then return "directory" end
            return { mode = "directory" }
        end
        local entry = files[path]
        if not entry then return nil end
        if attribute == "mode" then return "file" end
        if attribute == "size" then return entry.size end
        if attribute == "modification" then return entry.modified end
        return { mode = "file", size = entry.size, modification = entry.modified }
    end,
    dir = function(path)
        local names = {}
        for file_path in pairs(files) do
            local name = file_path:match("^" .. path:gsub("([%.%-])", "%%%1") .. "/([^/]+)$")
            if name then table.insert(names, name) end
        end
        table.sort(names)
        local index = 0
        return function()
            index = index + 1
            return names[index]
        end
    end,
}

local removed = {}
package.loaded["util"] = {
    makePath = function(path)
        directories[path] = true
    end,
    removeFile = function(path)
        table.insert(removed, path)
        files[path] = nil
    end,
}

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local Transfer = require("bookorbit_download_transfer")
local TransferProgress = require("bookorbit_transfer_progress")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

-- Destination containment is checked before anything is written and again
-- before the publishing rename.
assertEqual(Transfer.isInsideRoot("/downloads", "/downloads/Books/a.epub"), true, "a path under the root is authorized")
assertEqual(Transfer.isInsideRoot("/downloads", "/downloads/The Shards.epub"), true,
    "a file directly under the download root is authorized")
assertEqual(Transfer.isInsideRoot("/downloads", "/elsewhere/a.epub"), false, "a path outside the root is rejected")
assertEqual(Transfer.isInsideRoot("/downloads", "/downloads/../etc/passwd"), false, "traversal is rejected")
assertEqual(Transfer.isInsideRoot("/downloads", "/downloads"), false, "the root itself is not a destination")
assertEqual(Transfer.tempDir("/downloads"), "/downloads/.bookorbit-tmp", "temporaries live under the destination root")
assertEqual(Transfer.isInsideRoot("/", "/The Shards.epub"), true, "the filesystem root supports a direct book destination")
assertEqual(Transfer.isInsideRoot("/", "/Standalone/The Shards.epub"), true, "the filesystem root supports nested destinations")
assertEqual(Transfer.isInsideRoot("/", "/../etc/passwd"), false, "the filesystem root still rejects traversal")
assertEqual(Transfer.tempDir("/"), "/.bookorbit-tmp", "the filesystem root gets one temporary directory separator")

links["/downloads/Books"] = true
assertEqual(Transfer.isInsideRoot("/downloads", "/downloads/Books/a.epub"), false,
    "a linked destination directory is rejected")
links["/downloads/Books"] = nil
links["/downloads/Books/a.epub"] = true
assertEqual(Transfer.isInsideRoot("/downloads", "/downloads/Books/a.epub"), false,
    "a linked destination file is rejected")
links["/downloads/Books/a.epub"] = nil
links["/downloads/.bookorbit-tmp"] = true
assertEqual(Transfer.ensureTempDir("/downloads"), nil, "linked staging is rejected")
assertEqual(Transfer.sweepStale("/downloads"), 0, "cleanup never follows linked staging")
links["/downloads/.bookorbit-tmp"] = nil

-- Leftovers from a killed run are removed, and the sweep stays bounded.
files["/downloads/.bookorbit-tmp/bo_1_1.part"] = { size = 10, modified = 1 }
files["/downloads/.bookorbit-tmp/bo_2_2.part"] = { size = 10, modified = now }
assertEqual(Transfer.sweepStale("/downloads", { now = now, max_age = 100 }), 1, "only stale temporaries are removed")
assertEqual(files["/downloads/.bookorbit-tmp/bo_2_2.part"] ~= nil, true, "a fresh temporary survives")
files["/downloads/.bookorbit-tmp/bo_2_2.part"] = nil

local renames = {}
local real_rename = os.rename
os.rename = function(from, to)
    table.insert(renames, { from = from, to = to })
    files[to] = files[from]
    files[from] = nil
    return true
end

local function runScheduled()
    local pending = scheduled
    scheduled = {}
    for _, task in ipairs(pending) do
        task.callback()
    end
end

-- The parent polls the child's snapshot file while the transfer runs and
-- publishes the complete file itself.
local observed = {}
local snapshots = {}
local decodeSnapshot = TransferProgress.read
TransferProgress.read = function(path, opts)
    return decodeSnapshot(path, {
        generation = opts and opts.generation,
        read = function(target) return snapshots[target] end,
    })
end

local completed = Transfer.run{
    root = "/downloads",
    destination = "/downloads/Books/a.epub",
    generation = 4,
    expected_bytes = 900,
    hash = "partial_md5",
    on_progress = function(received, total)
        table.insert(observed, { received = received, total = total })
    end,
    is_current = function() return true end,
    perform = function(download_opts)
        assertEqual(download_opts.publish, "parent", "the child never publishes a book file")
        assertEqual(download_opts.hash, "partial_md5", "the child hashes what it wrote")
        assertEqual(download_opts.block_timeout, 30, "the block timeout is the stall detector")
        assertEqual(download_opts.total_timeout > 60, true, "the total budget scales past the inherited file timeout")
        assertEqual(download_opts.temp_path:find("/downloads/.bookorbit%-tmp/") == 1, true,
            "the child writes inside the authorized temporary directory")
        snapshots[download_opts.progress_path] =
            TransferProgress.encode({ generation = 4, received = 450, total = 900 })
        files[download_opts.temp_path] = { size = 900, modified = now }
        -- The poller runs while the child is still transferring.
        runScheduled()
        return { temp_path = download_opts.temp_path, bytes = 900, hash = "digest" }
    end,
}
assertEqual(completed, true, "the transfer completes")
assertEqual(#observed, 1, "the parent observed the child's progress")
assertEqual(observed[1].received, 450, "polled progress carries the child's byte count")
assertEqual(#renames, 1, "the parent performs exactly one publishing rename")
assertEqual(renames[1].to, "/downloads/Books/a.epub", "the file is published at its destination")
runScheduled()
assertEqual(#scheduled, 0, "a poll that fires after completion does not reschedule itself")
assertEqual(#observed, 1, "no progress is reported once the transfer returned")

-- A user-selected filesystem root used to normalize to an empty string and
-- reject the destination before perform could start the HTTP request.
local root_request_started = false
local root_completed = Transfer.run{
    root = "/",
    destination = "/The Shards.epub",
    generation = 5,
    expected_bytes = 2089926,
    is_current = function() return true end,
    perform = function(download_opts)
        root_request_started = true
        files[download_opts.temp_path] = { size = 2089926, modified = now }
        return { temp_path = download_opts.temp_path, bytes = 2089926 }
    end,
}
assertEqual(root_request_started, true, "the reported book reaches the HTTP transfer callback")
assertEqual(root_completed, true, "the reported book publishes under a filesystem-root download folder")
assertEqual(files["/The Shards.epub"] ~= nil, true, "the reported book is published at the requested destination")

-- A cancelled generation discards a late child result instead of publishing it.
renames = {}
removed = {}
local cancelled, cancel_err = Transfer.run{
    root = "/downloads",
    destination = "/downloads/Books/b.epub",
    generation = 5,
    is_current = function() return false end,
    perform = function(download_opts)
        files[download_opts.temp_path] = { size = 10, modified = now }
        return { temp_path = download_opts.temp_path, bytes = 10 }
    end,
}
assertEqual(cancelled, nil, "a cancelled transfer reports failure")
assertEqual(cancel_err, "cancelled", "a cancelled transfer says why")
assertEqual(#renames, 0, "a cancelled transfer publishes nothing")
assertEqual(#removed, 1, "a cancelled transfer removes the completed temporary file")
assertEqual(files["/downloads/Books/b.epub"], nil, "the destination stays untouched")

-- A failing transfer cleans up and never publishes.
renames = {}
removed = {}
local failed, failure = Transfer.run{
    root = "/downloads",
    destination = "/downloads/Books/c.epub",
    generation = 6,
    perform = function()
        return nil, "network_error"
    end,
}
assertEqual(failed, nil, "a failed transfer reports failure")
assertEqual(failure, "network_error", "the transport error reaches the caller")
assertEqual(#renames, 0, "a failed transfer publishes nothing")

-- A destination outside the authorized root is refused before any request.
local requested = false
local unsafe, unsafe_err = Transfer.run{
    root = "/downloads",
    destination = "/etc/passwd",
    generation = 7,
    perform = function()
        requested = true
        return true
    end,
}
assertEqual(unsafe, nil, "an unauthorized destination fails")
assertEqual(unsafe_err, "unsafe_destination", "an unauthorized destination says why")
assertEqual(requested, false, "an unauthorized destination never starts a transfer")

local redirected, redirected_err = Transfer.run{
    root = "/downloads",
    destination = "/downloads/Books/a.epub",
    generation = 8,
    perform = function(opts)
        files[opts.temp_path] = { size = 10, modified = now }
        links["/downloads/Books"] = true
        return { temp_path = opts.temp_path }
    end,
}
assertEqual(redirected, nil, "a destination redirected during transfer is rejected")
assertEqual(redirected_err, "unsafe_destination", "publication rechecks links")
assertEqual(#renames, 0, "a redirected destination publishes nothing")
links["/downloads/Books"] = nil

local real_time = os.time
os.time = function() return 1000 end
local part_link = "/downloads/.bookorbit-tmp/bo_9_1000.part"
links[part_link] = true
requested = false
local linked_part, linked_part_err = Transfer.run{
    root = "/downloads",
    destination = "/downloads/Books/a.epub",
    generation = 9,
    perform = function() requested = true end,
}
assertEqual(linked_part, nil, "a linked staged file is rejected")
assertEqual(linked_part_err, "unsafe_destination", "linked staged files report a path failure")
assertEqual(requested, false, "linked staged files never start a transfer")
links[part_link] = nil
os.time = real_time

os.rename = real_rename

print("bookorbit_download_transfer_test.lua: ok")
