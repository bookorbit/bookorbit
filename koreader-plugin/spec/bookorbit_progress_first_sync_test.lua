-- A device that has just downloaded a book turns every page after the other device's push, so a
-- page-turn clock files that push as older, drops it, and the sync uploads over it. These cases
-- pin the decision to the book's sync point instead.

package.loaded["gettext"] = function(text)
    return text
end

package.loaded["ffi/util"] = {
    template = function(text, ...)
        local values = { ... }
        return (text:gsub("%%(%d+)", function(index)
            return tostring(values[tonumber(index)])
        end))
    end,
}

local confirm_boxes = {}
package.loaded["ui/widget/confirmbox"] = {
    new = function(_, opts)
        table.insert(confirm_boxes, opts)
        return opts
    end,
}
local Device = { model = "Kobo Libra 2" }
package.loaded["device"] = Device

package.loaded["ui/event"] = {
    new = function(_, name, value) return { name = name, value = value } end,
}
package.loaded["ui/widget/infomessage"] = { new = function(_, opts) return opts end }
package.loaded["optmath"] = {
    roundPercent = function(value) return value end,
    round = function(value) return math.floor(value + 0.5) end,
}
package.loaded["ui/network/manager"] = {
    willRerunWhenConnected = function() return false end,
}
package.loaded["ui/uimanager"] = {
    show = function() end,
    scheduleIn = function(_, _, fn) fn() end,
    unschedule = function() end,
    getElapsedTimeSinceBoot = function() return 10000 end,
}
package.loaded["logger"] = { dbg = function() end, warn = function() end }
package.loaded["ui/time"] = { s = function(value) return value end }
package.loaded["util"] = { partialMD5 = function() return "digest" end }

-- Each simulated device owns its sync state; the stub serves whichever one is acting.
local active_books = {}
local function copy(value)
    if type(value) ~= "table" then return value end
    local result = {}
    for key, item in pairs(value) do result[key] = item end
    return result
end
package.loaded["bookorbit_state_manager"] = {
    repairFileIdentity = function() end,
    getBook = function(digest) return copy(active_books[digest]) end,
    mutateScoped = function(_, fn)
        fn({ getBook = function(_, digest) return active_books[digest] end })
    end,
}

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local ProgressSync = require("bookorbit_progress_sync")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

-- Mirrors KoreaderService.getProgress: the device row updated last is the one served.
local server = { rows = {}, seq = 0 }
function server.reset()
    server.rows, server.seq = {}, 0
end
function server.put(device, device_id, percentage, progress, timestamp)
    server.seq = server.seq + 1
    server.rows[device_id] = {
        percentage = percentage,
        progress = progress,
        device = device,
        device_id = device_id,
        timestamp = timestamp,
        seq = server.seq,
    }
end
function server.get()
    local latest
    for _, row in pairs(server.rows) do
        if not latest or row.seq > latest.seq then latest = row end
    end
    if not latest then return {} end
    return {
        percentage = latest.percentage,
        progress = latest.progress,
        device = latest.device,
        device_id = latest.device_id,
        timestamp = latest.timestamp,
    }
end

local function makeDevice(model, device_id, book)
    local plugin = { SYNC_STRATEGY = { PROMPT = 1, SILENT = 2, DISABLE = 3 } }
    ProgressSync.install(plugin)
    plugin.model = model
    plugin.books = { digest = book }
    plugin.pull_timestamp = 0
    plugin.push_timestamp = 0
    plugin.device_id = device_id
    -- Defaults as shipped: forward prompts, backward is disabled.
    plugin.settings = { sync_forward = 1, sync_backward = 3, auto_sync = true }
    plugin.last_page_turn_timestamp = 0
    plugin.percent = 0
    plugin.xpointer = "/body/DocFragment[1]/body"
    plugin.ui = {
        document = { file = "/books/book.epub", info = { has_pages = false } },
        -- The jump lands before the upload that follows an accepted prompt.
        handleEvent = function(_, event)
            if event.name == "GotoXPointer" then
                plugin.xpointer = event.value
                plugin.percent = server.get().percentage
            end
        end,
    }
    plugin.isLoggedIn = function() return true end
    plugin.getLastPercent = function(self) return self.percent end
    plugin.getLastProgress = function(self) return self.xpointer end
    plugin.requestUpdateCheck = function() end
    plugin.recordSyncSuccess = function() end
    plugin.recordSyncError = function() end
    plugin.newClient = function()
        return { getProgress = function() return server.get() end }
    end
    return plugin
end

local function act(device)
    confirm_boxes = {}
    Device.model = device.model
    active_books = device.books
end

local function readTo(device, percent, at)
    device.percent = percent
    device.xpointer = "/body/DocFragment[2]/body/p[" .. math.floor(percent * 1000) .. "]"
    device.last_page_turn_timestamp = at
end

-- "Sync current book now": reconcile, then upload unless told to leave progress alone. The
-- upload stamps the sync point the way the book sync's progress step does.
local function manualSync(device, at)
    act(device)
    local outcome = {}
    device:reconcileProgressBeforeBookSync("digest", function(skip_progress)
        outcome.skip_progress = skip_progress
        if skip_progress then return end
        server.put(device.model, device.device_id, device.percent, device.xpointer, at)
        local book = device.books.digest
        if book then
            book.progressPushedPct = device.percent
            book.progressSyncedAt = at
        end
    end)
    return outcome
end

local function acceptPrompt()
    assert(confirm_boxes[1], "expected a prompt to accept").ok_callback()
end

local function freshlyDownloaded()
    -- What linkDownloadedFile leaves behind: matched, never synced.
    return { fileId = 2, bookId = 12, file = "/books/book.epub" }
end

-- 1. The reported sequence. DeviceB downloads a book DeviceA is 4% into, turns one page and
--    syncs. It has to be offered DeviceA's position rather than uploading its own over it.
server.reset()
local a = makeDevice("Kobo Libra 2", "device-a", freshlyDownloaded())
local b = makeDevice("Boox Note Air", "device-b", freshlyDownloaded())
readTo(a, 0.04, 100)
manualSync(a, 110)
assertEqual(server.get().device_id, "device-a", "DeviceA's 4% is the server position")

readTo(b, 0.004, 200)
local outcome = manualSync(b, 210)
assertEqual(#confirm_boxes, 1, "DeviceB is asked about DeviceA's position after turning a page")
assertEqual(confirm_boxes[1].text,
    "Sync to latest location 4% from device 'Kobo Libra 2' before uploading this book?",
    "the position is offered as the latest one")
assertEqual(outcome.skip_progress, nil, "nothing is uploaded while the prompt is open")
assertEqual(server.get().device_id, "device-a", "DeviceA's position is still the server position")

acceptPrompt()
assertEqual(b.percent, 0.04, "accepting moves DeviceB to DeviceA's position")
assertEqual(server.get().percentage, 0.04, "the upload after accepting carries DeviceA's position")

-- 2. Once DeviceB reads on, its own upload is the newer one and nobody is asked anything.
readTo(b, 0.06, 300)
manualSync(b, 310)
assertEqual(#confirm_boxes, 0, "DeviceB reading on uploads without a prompt")
assertEqual(server.get().percentage, 0.06, "DeviceB's 6% reaches the server")

act(a)
manualSync(a, 400)
assertEqual(#confirm_boxes, 1, "DeviceA is offered DeviceB's 6%")
assertEqual(confirm_boxes[1].text,
    "Sync to latest location 6% from device 'Boox Note Air' before uploading this book?",
    "DeviceA sees DeviceB's position as the latest one")

-- 3. The automatic pull on book open makes the same call.
server.reset()
server.put("Kobo Libra 2", "device-a", 0.04, "/body/DocFragment[2]/body/p[40]", 110)
b = makeDevice("Boox Note Air", "device-b", freshlyDownloaded())
readTo(b, 0.004, 200)
act(b)
b:getProgress(false, false)
assertEqual(#confirm_boxes, 1, "the open-time pull prompts on a freshly downloaded book")

-- 4. Declining is remembered, so the next sync uploads this device's position instead of asking
--    again on every run.
server.reset()
server.put("Kobo Libra 2", "device-a", 0.04, "/body/DocFragment[2]/body/p[40]", 110)
b = makeDevice("Boox Note Air", "device-b", freshlyDownloaded())
readTo(b, 0.004, 200)
outcome = manualSync(b, 210)
confirm_boxes[1].cancel_callback()
assertEqual(b.books.digest.progressSyncedAt, 110, "the declined position becomes the sync point")
outcome = manualSync(b, 220)
assertEqual(#confirm_boxes, 0, "a declined position is not offered again")
assertEqual(outcome.skip_progress, false, "the next sync uploads this device's position")
assertEqual(server.get().device_id, "device-b", "DeviceB's position is now the server position")

-- 5. A page turned before syncing no longer hides a push that landed after this device's
--    own last upload.
server.reset()
server.put("Kobo Libra 2", "device-a", 0.08, "/body/DocFragment[3]/body", 300)
b = makeDevice("Boox Note Air", "device-b", {
    fileId = 2, bookId = 12, progressPushedPct = 0.06, progressSyncedAt = 200,
})
readTo(b, 0.061, 400)
manualSync(b, 410)
assertEqual(#confirm_boxes, 1, "a push newer than the sync point is offered despite a later page turn")

-- 6. A position stamped before this device's own last upload, such as another device replaying
--    an old snapshot, is still treated as older.
server.reset()
server.put("Kobo Libra 2", "device-a", 0.03, "/body/DocFragment[2]/body", 300)
b = makeDevice("Boox Note Air", "device-b", {
    fileId = 2, bookId = 12, progressPushedPct = 0.06, progressSyncedAt = 500,
})
readTo(b, 0.06, 450)
outcome = manualSync(b, 510)
assertEqual(#confirm_boxes, 0, "an older replayed position is not offered")
assertEqual(outcome.skip_progress, false, "the newer local position is uploaded")

-- 7. A book this device uploaded before sync points existed keeps the page-turn heuristic until
--    its next upload records one.
server.reset()
server.put("Kobo Libra 2", "device-a", 0.08, "/body/DocFragment[3]/body", 300)
b = makeDevice("Boox Note Air", "device-b", { fileId = 2, bookId = 12, progressPushedPct = 0.06 })
readTo(b, 0.061, 400)
manualSync(b, 410)
assertEqual(#confirm_boxes, 0, "a book without a sync point is judged as before")

-- 8. A book missing from local state has never synced from here either.
server.reset()
server.put("Kobo Libra 2", "device-a", 0.04, "/body/DocFragment[2]/body/p[40]", 110)
b = makeDevice("Boox Note Air", "device-b", nil)
readTo(b, 0.004, 200)
manualSync(b, 210)
assertEqual(#confirm_boxes, 1, "a book unknown to local state is offered the server position")

print("bookorbit_progress_first_sync_test.lua: ok")
