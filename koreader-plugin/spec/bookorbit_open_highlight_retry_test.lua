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

package.loaded["ui/uimanager"] = {
    scheduleIn = function(_, _, callback)
        callback()
    end,
}

package.loaded["ui/network/manager"] = {
    willRerunWhenConnected = function(_, callback)
        callback()
        return true
    end,
}

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local SyncCoordinator = require("bookorbit_sync_coordinator")

local OPEN_HIGHLIGHT_MAX_RETRIES = 2

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local plugin = {
    runs = 0,
    sync_coordinator = SyncCoordinator.new(),
}

function plugin:shouldSkipAutoSyncOffline()
    return false
end

function plugin:submitSyncJob(job)
    return self.sync_coordinator:submit(job)
end

function plugin:exchangeAnnotationsForOpenBook(_, retry_count)
    self.runs = self.runs + 1
    if retry_count < OPEN_HIGHLIGHT_MAX_RETRIES then
        self:scheduleOpenHighlightRetry("annotation_open", retry_count)
    end
end

function plugin:scheduleOpenHighlightRetry(reason, retry_count)
    retry_count = retry_count or 0
    if retry_count >= OPEN_HIGHLIGHT_MAX_RETRIES then return end
    local UIManager = require("ui/uimanager")
    local NetworkMgr = require("ui/network/manager")
    UIManager:scheduleIn(8, function()
        if self:shouldSkipAutoSyncOffline("annotation_retry") then return end
        self:submitSyncJob{
            family = "annotation_exchange",
            label = "Highlight sync",
            source = reason or "annotation_retry",
            priority = SyncCoordinator.PRIORITY.auto,
            interactive = false,
            async = true,
            run = function(done)
                local execute = function()
                    self:exchangeAnnotationsForOpenBook(reason or "annotation_retry", retry_count + 1)
                    done()
                end
                if NetworkMgr:willRerunWhenConnected(execute) then
                    return
                end
                execute()
            end,
        }
    end)
end

plugin:scheduleOpenHighlightRetry("annotation_open", 0)
assertEqual(plugin.runs, 2, "retry stops at max retry count")

print("bookorbit_open_highlight_retry_test.lua: ok")
