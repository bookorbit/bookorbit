-- "Sync now" in a book used to ask the progress question first and run nothing
-- until it was answered, so highlights waited on the prompt and the sheet sat
-- on Syncing (S-25). The book data now syncs first with the position held back;
-- the question comes after, and only the position waits for its answer.

package.loaded["gettext"] = function(text) return text end
package.loaded["ffi/util"] = {
    template = function(text, ...)
        local values = { ... }
        return (text:gsub("%%(%d+)", function(index) return tostring(values[tonumber(index)]) end))
    end,
}
local confirm_boxes = {}
local shown_texts
-- The prompt is the This book sheet; its Jump and Stay stand in for a
-- confirm box's OK and Cancel.
package.loaded["bookorbit_book_sheet"] = {
    openPrompt = function(_plugin, prompt)
        table.insert(confirm_boxes, {
            prompt = prompt,
            ok_callback = prompt.on_jump,
            cancel_callback = prompt.on_stay or function() end,
        })
    end,
}
package.loaded["bookorbit_toast"] = {
    show = function(text) if shown_texts then table.insert(shown_texts, text) end end,
    error = function(text) if shown_texts then table.insert(shown_texts, text) end end,
}
package.loaded["device"] = { model = "Kobo Libra" }
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

local function makePlugin(remote)
    confirm_boxes = {}
    local plugin = { SYNC_STRATEGY = { PROMPT = 1, SILENT = 2, DISABLE = 3 } }
    ProgressSync.install(plugin)
    plugin.pull_timestamp, plugin.push_timestamp = 0, 0
    plugin.device_id = "this-device"
    plugin.settings = { sync_forward = 1, sync_backward = 3, auto_sync = true }
    plugin.last_page_turn_timestamp = 0
    plugin.pushes = {}
    plugin.ui = { document = { file = "/tmp/book.epub", info = { has_pages = false } }, handleEvent = function() end }
    plugin.getLastProgress = function() return "/body/DocFragment[6]/body" end
    plugin.getLastPercent = function() return 0.42 end
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

local function runSync(plugin, book_sync_error)
    local calls = {}
    plugin:syncBookThenProgress(DIGEST, function(skip_progress, after_sync)
        table.insert(calls, { skip_progress = skip_progress, prompts_open = #confirm_boxes })
        if not book_sync_error then after_sync() end
    end)
    return calls
end

local NEWER_REMOTE = { percentage = 0.8, progress = "/body/DocFragment[9]/body", device = "Phone", device_id = "phone", timestamp = 20000 }

-- The book data goes first, with no prompt open and the position held back.
local plugin = makePlugin(NEWER_REMOTE)
local calls = runSync(plugin)
assertEqual(#calls, 1, "the book sync runs once")
assertEqual(calls[1].skip_progress, true, "it holds back only the position")
assertEqual(calls[1].prompts_open, 0, "and nothing waits on the progress question")
assertEqual(#confirm_boxes, 1, "the question is asked once the book data is synced")
assertEqual(#plugin.pushes, 0, "the position stays put until the reader answers")

-- Keeping this device's place when the other device is ahead pushes nothing.
confirm_boxes[1].cancel_callback()
assertEqual(#plugin.pushes, 0, "declining a newer place leaves the server's position alone")

-- Taking the newer place moves the reader there, then that position goes up.
plugin = makePlugin(NEWER_REMOTE)
runSync(plugin)
confirm_boxes[1].ok_callback()
assertEqual(#plugin.pushes, 1, "after taking the newer place the position is pushed")
assertEqual(plugin.pushes[1].digest, DIGEST, "for this book")

-- No conflict: the position goes up right after the book data, no question.
plugin = makePlugin({ percentage = 0.42, progress = "/body/DocFragment[6]/body", device = "Phone", device_id = "phone" })
runSync(plugin)
assertEqual(#confirm_boxes, 0, "matching positions ask nothing")
assertEqual(#plugin.pushes, 1, "and the position is pushed")

-- A book sync that failed asks nothing and pushes nothing.
plugin = makePlugin(NEWER_REMOTE)
runSync(plugin, "network")
assertEqual(#confirm_boxes, 0, "a failed book sync is not followed by the question")
assertEqual(#plugin.pushes, 0, "nor by a position push")

print("bookorbit_sync_now_progress_order_test: ok")
