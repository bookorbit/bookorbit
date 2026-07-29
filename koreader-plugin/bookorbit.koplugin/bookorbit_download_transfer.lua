--[[--
Parent side of a background file transfer.

The child process owns the socket and writes into a temporary file inside a
dedicated directory under the authorized destination root, so the publishing
rename never crosses a filesystem boundary. Byte progress reaches the UI
through generation-scoped snapshot files that the parent polls from short
scheduled callbacks.

Publishing stays with the parent. Dismissing a Trapper subprocess cannot stop a
child that has already started renaming, which is harmless for a cover but
wrong for a book the user just cancelled, so the parent re-checks the
generation and the resolved destination before it publishes anything.
]]

local UIManager = require("ui/uimanager")
local lfs = require("libs/libkoreader-lfs")
local util = require("util")

local TransferPolicy = require("bookorbit_transfer_policy")
local TransferProgress = require("bookorbit_transfer_progress")

local TEMP_DIR_NAME = ".bookorbit-tmp"
local POLL_INTERVAL = 0.5
local STALE_TEMP_AGE = 24 * 60 * 60
local MAX_STALE_SWEEP = 64

local Transfer = {}

Transfer.TEMP_DIR_NAME = TEMP_DIR_NAME
Transfer.POLL_INTERVAL = POLL_INTERVAL

local function normalize(path)
    return tostring(path or ""):gsub("\\", "/"):gsub("/+", "/"):gsub("/$", "")
end

function Transfer.tempDir(root)
    return normalize(root) .. "/" .. TEMP_DIR_NAME
end

function Transfer.ensureTempDir(root)
    local dir = Transfer.tempDir(root)
    if lfs.attributes(dir, "mode") == "directory" then return dir end
    util.makePath(dir)
    if lfs.attributes(dir, "mode") ~= "directory" then return nil end
    return dir
end

-- Confirms a resolved destination still lives under the authorized root and
-- contains no traversal segment.
function Transfer.isInsideRoot(root, path)
    local normalized_root = normalize(root)
    local normalized_path = normalize(path)
    if normalized_root == "" or normalized_path == "" then return false end
    if normalized_path:sub(1, #normalized_root + 1) ~= normalized_root .. "/" then return false end
    for segment in normalized_path:gmatch("[^/]+") do
        if segment == ".." then return false end
    end
    return true
end

-- Drops leftovers from a killed run. Bounded per pass so a large cache cannot
-- turn maintenance into its own stall.
function Transfer.sweepStale(root, opts)
    opts = opts or {}
    local dir = Transfer.tempDir(root)
    if lfs.attributes(dir, "mode") ~= "directory" then return 0 end
    local now = opts.now or os.time()
    local max_age = opts.max_age or STALE_TEMP_AGE
    local budget = opts.limit or MAX_STALE_SWEEP
    local removed = 0
    local ok, iterator, dir_obj = pcall(lfs.dir, dir)
    if not ok or not iterator then return 0 end
    for name in iterator, dir_obj do
        if budget <= 0 then break end
        if name ~= "." and name ~= ".." then
            local path = dir .. "/" .. name
            local modified = lfs.attributes(path, "modification")
            if type(modified) ~= "number" or now - modified >= max_age then
                util.removeFile(path)
                removed = removed + 1
            end
            budget = budget - 1
        end
    end
    return removed
end

local function pollProgress(state)
    if state.stopped then return end
    local snapshot = TransferProgress.read(state.progress_path, { generation = state.generation })
    if snapshot and state.on_progress then
        state.on_progress(snapshot.received, snapshot.total)
    end
    if state.stopped then return end
    UIManager:scheduleIn(POLL_INTERVAL, function() pollProgress(state) end)
end

-- Runs one transfer to completion. Must be called from inside a Trapper
-- coroutine so the request can own a background subprocess.
--
-- opts: perform(download_opts) -> (result, err), destination, root,
-- generation, expected_bytes, on_progress(received, total), is_current(),
-- trap_widget.
function Transfer.run(opts)
    local root = opts.root
    if not Transfer.isInsideRoot(root, opts.destination) then
        return nil, "unsafe_destination"
    end
    local dir = Transfer.ensureTempDir(root)
    if not dir then return nil, "temp_dir_failed" end

    local base = string.format("bo_%d_%d", opts.generation or 0, os.time())
    local temp_path = dir .. "/" .. base .. ".part"
    local progress_path = dir .. "/" .. base .. ".progress"

    local state = {
        progress_path = progress_path,
        generation = opts.generation,
        on_progress = opts.on_progress,
        stopped = false,
    }
    UIManager:scheduleIn(POLL_INTERVAL, function() pollProgress(state) end)

    local block_timeout, total_timeout = TransferPolicy.timeouts(opts.expected_bytes)
    local ok, result, err = pcall(opts.perform, {
        temp_path = temp_path,
        progress_path = progress_path,
        progress_generation = opts.generation,
        expected_bytes = opts.expected_bytes,
        block_timeout = block_timeout,
        total_timeout = total_timeout,
        publish = "parent",
        hash = opts.hash,
        trap_widget = opts.trap_widget,
        -- Only reached when no subprocess could be forked; then the parent is
        -- blocked anyway and the callback is the sole progress channel.
        progress_cb = opts.on_progress and function(received)
            opts.on_progress(received, opts.expected_bytes)
        end or nil,
    })
    state.stopped = true
    TransferProgress.cleanup(progress_path)

    if not ok then
        util.removeFile(temp_path)
        error(result, 0)
    end
    if not result then
        util.removeFile(temp_path)
        return nil, err
    end

    local completed_path = type(result) == "table" and result.temp_path or temp_path
    if opts.is_current and not opts.is_current() then
        util.removeFile(completed_path)
        return nil, "cancelled"
    end
    if not Transfer.isInsideRoot(root, opts.destination) then
        util.removeFile(completed_path)
        return nil, "unsafe_destination"
    end

    local renamed, rename_err = os.rename(completed_path, opts.destination)
    if not renamed then
        util.removeFile(completed_path)
        return nil, tostring(rename_err or "publish_failed")
    end
    return true, nil, type(result) == "table" and result or {}
end

return Transfer
