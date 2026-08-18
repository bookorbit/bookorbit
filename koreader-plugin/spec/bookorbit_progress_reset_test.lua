-- The server can only ask for a reset; the client decides whether to act on it. These cases
-- drive that decision, because a server-side test passes on a body the reader would discard.

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
package.loaded["device"] = { model = "Kobo Libra" }

local events = {}
package.loaded["ui/event"] = {
    new = function(_, name, value)
        local event = { name = name, value = value }
        table.insert(events, event)
        return event
    end,
}
package.loaded["ui/widget/infomessage"] = { new = function(_, opts) return opts end }
package.loaded["optmath"] = {
    roundPercent = function(value) return value end,
    round = function(value) return value end,
}
package.loaded["ui/network/manager"] = {
    willRerunWhenConnected = function() return false end,
}

local shown_texts = {}
package.loaded["ui/uimanager"] = {
    show = function(_, message)
        table.insert(shown_texts, message.text)
    end,
    scheduleIn = function() end,
    unschedule = function() end,
    getElapsedTimeSinceBoot = function() return 10000 end,
}
package.loaded["logger"] = { dbg = function() end }
package.loaded["ui/time"] = { s = function(value) return value end }
package.loaded["util"] = { partialMD5 = function(file) return "digest:" .. tostring(file) end }

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local ProgressSync = require("bookorbit_progress_sync")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local function assertTrue(value, label)
    if not value then error(label .. ": expected truthy, got " .. tostring(value)) end
end

--- Builds a plugin sitting at `local_percent` in a book, ready to pull `body` from the server.
local function makePlugin(body, opts)
    opts = opts or {}
    confirm_boxes = {}
    events = {}
    shown_texts = {}

    local plugin = {
        SYNC_STRATEGY = { PROMPT = 1, SILENT = 2, DISABLE = 3 },
    }
    ProgressSync.install(plugin)

    plugin.pull_timestamp = 0
    plugin.push_timestamp = 0
    plugin.device_id = "this-device"
    -- Defaults as shipped: forward prompts, backward is disabled.
    plugin.settings = { sync_forward = 1, sync_backward = 3, auto_sync = true }
    plugin.last_page_turn_timestamp = opts.last_page_turn_timestamp or 0
    plugin.ui = {
        document = {
            file = "/tmp/book" .. (opts.paged and ".cbz" or ".epub"),
            info = { has_pages = opts.paged == true },
        },
        handleEvent = function() end,
    }
    plugin.isLoggedIn = function() return true end
    plugin.getLastProgress = function() return opts.local_progress or "/body/DocFragment[6]/body" end
    plugin.getLastPercent = function() return opts.local_percent or 0.42 end
    plugin.requestUpdateCheck = function() end
    plugin.recordSyncSuccess = function() end
    plugin.recordSyncError = function() end
    plugin.newClient = function()
        return { getProgress = function() return body end }
    end
    return plugin
end

local RESET_BODY_REFLOWABLE = {
    percentage = 0,
    progress = "/body/DocFragment[1]/body",
    device = "web",
    device_id = "bookorbit-web",
    timestamp = 5000,
}

-- 1. The reset must not be mistaken for this device's own progress, or it is skipped outright.
local plugin = makePlugin(RESET_BODY_REFLOWABLE)
plugin:getProgress(false, false)
assertEqual(#confirm_boxes, 1, "a reset from BookOrbit reaches the conflict prompt")

-- 2. Accepting it has to actually move the reader to the start.
confirm_boxes[1].ok_callback()
assertEqual(events[1].name, "GotoXPointer", "reflowable reset navigates by xpointer")
assertEqual(events[1].value, "/body/DocFragment[1]/body", "reflowable reset targets the first fragment")

-- 3. Paged books take a page number, and an empty position would arrive as nil.
local paged = makePlugin({
    percentage = 0,
    progress = "1",
    device = "web",
    device_id = "bookorbit-web",
    timestamp = 5000,
}, { paged = true, local_progress = "117" })
paged:getProgress(false, false)
assertEqual(#confirm_boxes, 1, "a paged reset reaches the conflict prompt")
confirm_boxes[1].ok_callback()
assertEqual(events[1].name, "GotoPage", "paged reset navigates by page")
assertEqual(events[1].value, 1, "paged reset targets page one")

-- 4. The classification is what decides whether the reader is ever asked. A reset stamped
--    behind the last page turn is read as a backward sync, and backward defaults to disabled,
--    so it is dropped in silence. This is why the server stamps each delivery as current.
local stale = makePlugin(RESET_BODY_REFLOWABLE, { last_page_turn_timestamp = 9000 })
stale:getProgress(false, false)
assertEqual(#confirm_boxes, 0, "a reset older than the last page turn is silently discarded")

local fresh = makePlugin({
    percentage = 0,
    progress = "/body/DocFragment[1]/body",
    device = "web",
    device_id = "bookorbit-web",
    timestamp = 9500,
}, { last_page_turn_timestamp = 9000 })
fresh:getProgress(false, false)
assertEqual(#confirm_boxes, 1, "a reset stamped after the last page turn still prompts")

-- 5. A device already at the start has nothing to do, and must not be nagged.
local converged = makePlugin(RESET_BODY_REFLOWABLE, { local_percent = 0 })
converged:getProgress(false, false)
assertEqual(#confirm_boxes, 0, "a device already at the start is not prompted")

-- 6. The reset must never be attributed to the pulling device itself, or the guard skips it.
local own = makePlugin({
    percentage = 0,
    progress = "/body/DocFragment[1]/body",
    device = "Kobo Libra",
    device_id = "this-device",
    timestamp = 5000,
})
own:getProgress(false, false)
assertEqual(#confirm_boxes, 0, "progress from this device is skipped, which is why the reset is not attributed to it")

print("bookorbit_progress_reset_test.lua: ok")
