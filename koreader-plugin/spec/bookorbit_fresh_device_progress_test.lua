-- A device that opens a book it has not synced since opening (a fresh download
-- at its cover, or a copy left days behind) used to date its place by its last
-- page turn. One turn made another device's further place look older, so Sync
-- now pushed the cover over it without asking (#1806). Until the open book's
-- place has been weighed against BookOrbit's, a further BookOrbit place counts
-- as newer; once weighed, page-turn times decide as before.

package.loaded["gettext"] = function(text) return text end
package.loaded["ffi/util"] = {
    template = function(text, ...)
        local values = { ... }
        return (text:gsub("%%(%d+)", function(index) return tostring(values[tonumber(index)]) end))
    end,
}
local prompts = {}
package.loaded["bookorbit_book_sheet"] = {
    openPrompt = function(_plugin, prompt) table.insert(prompts, prompt) end,
}
package.loaded["bookorbit_toast"] = { show = function() end, error = function() end }
package.loaded["device"] = { model = "Kindle" }
package.loaded["ui/event"] = { new = function(_, name, value) return { name = name, value = value } end }
package.loaded["ui/widget/infomessage"] = { new = function(_, opts) return opts end }
package.loaded["optmath"] = { roundPercent = function(value) return value end, round = function(value) return value end }
package.loaded["ui/network/manager"] = { willRerunWhenConnected = function() return false end }
package.loaded["ui/uimanager"] = {
    show = function() end,
    nextTick = function(_, fn) fn() end,
    scheduleIn = function(_, _, fn) fn() end,
    unschedule = function() end,
    getElapsedTimeSinceBoot = function() return 10000 end,
}
package.loaded["logger"] = { dbg = function() end, warn = function() end }
package.loaded["ui/time"] = { s = function(value) return value end }
package.loaded["util"] = { partialMD5 = function(file) return "digest:" .. tostring(file) end }
package.loaded["bookorbit_state_manager"] = { repairFileIdentity = function() end }

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local ProgressSync = require("bookorbit_progress_sync")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local DIGEST = "digest:/tmp/book.epub"
-- The phone read to 46% before this device turned its first page.
local PHONE = { percentage = 0.46, progress = "/body/DocFragment[20]/body/p[56]", device = "iPhone", device_id = "phone", timestamp = 20000 }
local PAGE_TURN = 30000

-- A fresh download, opened at its cover and turned one page.
local function makePlugin(remote, local_percent)
    prompts = {}
    local plugin = { SYNC_STRATEGY = { PROMPT = 1, SILENT = 2, DISABLE = 3 } }
    ProgressSync.install(plugin)
    plugin.pull_timestamp, plugin.push_timestamp = 0, 0
    plugin.device_id = "kindle"
    -- Defaults as shipped: forward prompts, backward is disabled, auto sync off.
    plugin.settings = { sync_forward = 1, sync_backward = 3, auto_sync = false }
    plugin.last_page_turn_timestamp = PAGE_TURN
    plugin.pushes, plugin.moves = {}, {}
    plugin.ui = { document = { file = "/tmp/book.epub", info = { has_pages = false } } }
    plugin.ui.handleEvent = function(_, event) table.insert(plugin.moves, event) end
    plugin.local_percent = local_percent or 0.008
    plugin.getLastProgress = function() return "/body/DocFragment[2]/body/h1/img" end
    plugin.getLastPercent = function() return plugin.local_percent end
    plugin.isLoggedIn = function() return true end
    plugin.requestUpdateCheck = function() end
    plugin.recordSyncSuccess = function() end
    plugin.recordSyncError = function() end
    plugin.newClient = function()
        return {
            getProgress = function() return remote end,
            updateProgress = function(_, digest, percent)
                table.insert(plugin.pushes, { digest = digest, percent = percent })
                return {}
            end,
        }
    end
    return plugin
end

local function syncNow(plugin)
    plugin:syncBookThenProgress(DIGEST, function(_skip_progress, after_sync) after_sync() end)
end

-- Sync now from the cover asks before anything moves, and pushes nothing.
local plugin = makePlugin(PHONE)
syncNow(plugin)
assertEqual(#prompts, 1, "a further place on BookOrbit is offered, not overwritten")
assertEqual(prompts[1].newer, true, "and it is offered as the newer place")
assertEqual(#plugin.pushes, 0, "nothing is pushed while the question is open")

-- Taking it moves the reader there before the position goes up.
prompts[1].on_jump()
assertEqual(plugin.moves[1].name, "GotoXPointer", "Jump moves the reader to BookOrbit's place")
assertEqual(#plugin.pushes, 1, "then the position is pushed")

-- Staying pushes nothing; it settles the question, so reading on from here
-- makes this place the newer one, as it did before.
plugin = makePlugin(PHONE)
syncNow(plugin)
prompts[1].on_stay()
assertEqual(#plugin.pushes, 0, "declining the further place leaves the server alone")
plugin.last_page_turn_timestamp = PAGE_TURN + 60
plugin.local_percent = 0.012
syncNow(plugin)
assertEqual(#prompts, 1, "after Stay and another page, Sync now does not ask again")
assertEqual(#plugin.pushes, 1, "and this device's place goes up")

-- Once weighed in this opening, page-turn times decide as before: a later
-- turn beats an older BookOrbit place without a question.
plugin = makePlugin(PHONE)
plugin:noteProgressCompared(DIGEST)
syncNow(plugin)
assertEqual(#prompts, 0, "a weighed place is not asked about again")
assertEqual(#plugin.pushes, 1, "the newer page turn is pushed")

-- Weighing is per book: another book's sync does not count for this one.
plugin = makePlugin(PHONE)
plugin:noteProgressCompared("digest:/tmp/other.epub")
syncNow(plugin)
assertEqual(#prompts, 1, "another book's comparison does not date this place")

-- A place behind this device is still kept and pushed without a question.
plugin = makePlugin({ percentage = 0.1, progress = "/body/DocFragment[5]/body", device = "iPhone", device_id = "phone", timestamp = 20000 }, 0.3)
syncNow(plugin)
assertEqual(#prompts, 0, "BookOrbit behind this device asks nothing")
assertEqual(#plugin.pushes, 1, "and this device's further place is pushed")

-- A pull after a page turn offers the further place instead of dropping it.
plugin = makePlugin(PHONE)
plugin:getProgress(false, false)
assertEqual(#prompts, 1, "a pull from the cover offers the further place")
assertEqual(prompts[1].newer, true, "as the newer place")
prompts[1].on_stay()
assertEqual(plugin:progressComparedSinceOpen(), true, "staying settles the question for this opening")

-- The This book sheet's chip agrees.
plugin = makePlugin(PHONE)
assertEqual(plugin:remoteProgressIsNewer(PHONE, 0.008), true, "the sheet shows BookOrbit ahead before weighing")
plugin:noteProgressCompared(DIGEST)
assertEqual(plugin:remoteProgressIsNewer(PHONE, 0.008), false, "and page-turn times once weighed")

print("bookorbit_fresh_device_progress_test: ok")
