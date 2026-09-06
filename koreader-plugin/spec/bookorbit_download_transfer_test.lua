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
package.loaded["libs/libkoreader-lfs"] = {
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

-- The origin record is dropped through os.remove rather than util.removeFile,
-- because it belongs to the module that writes it. Counting those separately is
-- what proves a record never outlives the partial it vouches for.
local unlinked = {}
local real_os_remove = os.remove
os.remove = function(path)
    table.insert(unlinked, path)
    files[path] = nil
    return true
end

local function originsDropped()
    local count = 0
    for _, path in ipairs(unlinked) do
        if path:find("%.origin$") then count = count + 1 end
    end
    return count
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
        assertEqual(download_opts.resume, false, "without a resume key nothing is continued")
        assertEqual(download_opts.keep_partial, false, "without a resume key a dropped link keeps nothing")
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

-- A resume key names the temporary file after the remote file instead of the
-- attempt, which is the whole reason a second attempt can find the bytes the
-- first one left behind.
renames = {}
removed = {}
local resume_opts
local resumable = Transfer.run{
    root = "/downloads",
    destination = "/downloads/Books/d.epub",
    generation = 8,
    resume_key = "../../f42",
    is_current = function() return true end,
    perform = function(download_opts)
        resume_opts = download_opts
        files[download_opts.temp_path] = { size = 5, modified = now }
        return { temp_path = download_opts.temp_path, bytes = 5, resumed = 2 }
    end,
}
assertEqual(resumable, true, "a resumable transfer completes")
assertEqual(resume_opts.temp_path, "/downloads/.bookorbit-tmp/bo_rf42.part",
    "the temporary file is named after the remote file, with traversal stripped from the key")
assertEqual(resume_opts.resume, true, "the child continues the bytes already on disk")
assertEqual(resume_opts.keep_partial, true, "the child leaves them behind when the link drops")

-- A dropped link is retried once with the bytes already on disk, and what
-- reached the disk survives for the caller's own retry after that.
renames = {}
removed = {}
unlinked = {}
local attempts = 0
local dropped, dropped_err = Transfer.run{
    root = "/downloads",
    destination = "/downloads/Books/e.epub",
    generation = 9,
    resume_key = "f43",
    perform = function()
        attempts = attempts + 1
        return nil, "closed"
    end,
}
assertEqual(attempts, Transfer.MAX_ATTEMPTS, "a dropped link is retried inside the transfer")
assertEqual(dropped, nil, "an exhausted retry still reports failure")
assertEqual(dropped_err, "closed", "the last transport error reaches the caller")
assertEqual(#removed, 0, "the partial file stays for the next attempt at this file")
assertEqual(originsDropped(), 0, "the record that proves those bytes stays with them")

-- A server verdict will not change on a second try, and neither will a response
-- the client itself refused, so both stop after one attempt and take the
-- worthless bytes with them.
attempts = 0
removed = {}
unlinked = {}
local refused, refused_err = Transfer.run{
    root = "/downloads",
    destination = "/downloads/Books/f.epub",
    generation = 10,
    resume_key = "f44",
    perform = function()
        attempts = attempts + 1
        return nil, 404
    end,
}
assertEqual(attempts, 1, "an http status is not retried")
assertEqual(refused, nil, "an http status reports failure")
assertEqual(refused_err, 404, "the status code reaches the caller")
assertEqual(#removed, 1, "a refused transfer removes its temporary file")
assertEqual(originsDropped() > 0, true, "a record never outlives the partial it describes")

attempts = 0
removed = {}
Transfer.run{
    root = "/downloads",
    destination = "/downloads/Books/g.epub",
    generation = 11,
    resume_key = "f45",
    perform = function()
        attempts = attempts + 1
        return nil, "empty_response"
    end,
}
assertEqual(attempts, 1, "a response the client refused is not retried")
assertEqual(#removed, 1, "a refused response removes its temporary file")

-- Cancelling during the first attempt stops the retry instead of spending the
-- link on a file the user no longer wants.
attempts = 0
Transfer.run{
    root = "/downloads",
    destination = "/downloads/Books/h.epub",
    generation = 12,
    resume_key = "f46",
    is_current = function() return attempts == 0 end,
    perform = function()
        attempts = attempts + 1
        return nil, "closed"
    end,
}
assertEqual(attempts, 1, "a cancelled transfer is not retried")

-- Two transfers sharing one resume key would interleave their writes, so the
-- second one gives up resuming rather than the first one's bytes.
local nested_path
Transfer.run{
    root = "/downloads",
    destination = "/downloads/Books/i.epub",
    generation = 13,
    resume_key = "f47",
    is_current = function() return true end,
    perform = function(outer_opts)
        Transfer.run{
            root = "/downloads",
            destination = "/downloads/Books/j.epub",
            generation = 14,
            resume_key = "f47",
            is_current = function() return true end,
            perform = function(inner_opts)
                nested_path = inner_opts.temp_path
                files[inner_opts.temp_path] = { size = 1, modified = now }
                return { temp_path = inner_opts.temp_path, bytes = 1 }
            end,
        }
        files[outer_opts.temp_path] = { size = 1, modified = now }
        return { temp_path = outer_opts.temp_path, bytes = 1 }
    end,
}
assertEqual(nested_path ~= nil and nested_path ~= "/downloads/.bookorbit-tmp/bo_rf47.part", true,
    "a transfer never writes into a temporary file another one already owns")

-- The key is released when the run ends, so the next attempt at the same file
-- gets the resumable name back.
resume_opts = nil
Transfer.run{
    root = "/downloads",
    destination = "/downloads/Books/i.epub",
    generation = 15,
    resume_key = "f47",
    is_current = function() return true end,
    perform = function(download_opts)
        resume_opts = download_opts
        files[download_opts.temp_path] = { size = 1, modified = now }
        return { temp_path = download_opts.temp_path, bytes = 1 }
    end,
}
assertEqual(resume_opts.temp_path, "/downloads/.bookorbit-tmp/bo_rf47.part", "a finished run releases its resume key")

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

os.rename = real_rename
os.remove = real_os_remove

print("bookorbit_download_transfer_test.lua: ok")
