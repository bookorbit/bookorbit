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

package.loaded["device"] = { model = "test-device" }
package.loaded["ui/widget/infomessage"] = { new = function(_, opts) return opts end }
package.loaded["ui/widget/inputdialog"] = {}
package.loaded["ui/widget/multiinputdialog"] = {}
package.loaded["ui/network/manager"] = {}
package.loaded["ui/widget/notification"] = {}
package.loaded["ui/uimanager"] = {}
package.loaded["ffi/sha2"] = { md5 = function(value) return value end }
package.loaded["util"] = {
    trim = function(value)
        return tostring(value or ""):match("^%s*(.-)%s*$")
    end,
}
package.loaded["bookorbit_api"] = {}
package.loaded["bookorbit_sweep"] = {
    syncStatus = function()
        return { lastSweepAt = 0, matched = 0, unmatched = 0 }
    end,
}

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local MainMenu = require("bookorbit_main_menu")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local function hasRow(rows, key)
    for _, row in ipairs(rows) do
        if type(row) == "table" and row[1] == key then return true end
    end
    return false
end

local function newPlugin(logged_in)
    local plugin = {
        SYNC_STRATEGY = { PROMPT = 1, SILENT = 2, DISABLE = 3 },
        settings = {
            auto_sync = true,
            annotation_sync = true,
        },
        PLUGIN_VERSION = "test",
        device_id = "123456789",
        isLoggedIn = function()
            return logged_in
        end,
        getSyncCoordinatorStatus = function()
            return { pending_count = 0 }
        end,
    }
    MainMenu.install(plugin)
    return plugin
end

local plugin = newPlugin(false)
local rows = plugin:diagnosticsRows()
assertEqual(hasRow(rows, "Server"), true, "logged-out diagnostics shows setup rows")
assertEqual(hasRow(rows, "Open highlights"), false, "logged-out diagnostics hides sync state")
assertEqual(hasRow(rows, "Last highlight sync"), false, "logged-out diagnostics hides highlight summary")
assertEqual(hasRow(rows, "Retry highlight sync"), false, "logged-out diagnostics hides highlight retry")
assertEqual(hasRow(rows, "Retry open-book match"), false, "logged-out diagnostics hides match retry")
assertEqual(hasRow(rows, "Test connection"), false, "logged-out diagnostics hides connection action without credentials")

plugin.settings.server_url = "https://bookorbit.example.com"
plugin.settings.username = "reader"
plugin.settings.userkey = "secret"
rows = plugin:diagnosticsRows()
assertEqual(hasRow(rows, "Test connection"), true, "logged-out diagnostics shows connection action with credentials")

plugin = newPlugin(true)
rows = plugin:diagnosticsRows()
assertEqual(hasRow(rows, "Retry highlight sync"), false, "file manager diagnostics hides highlight retry")
assertEqual(hasRow(rows, "Retry open-book match"), false, "file manager diagnostics hides match retry")
assertEqual(hasRow(rows, "Test connection"), true, "file manager diagnostics keeps connection action")
assertEqual(hasRow(rows, "Open highlights"), true, "logged-in diagnostics shows sync state")
assertEqual(hasRow(rows, "Last highlight sync"), true, "logged-in diagnostics shows highlight summary")

plugin.ui = { document = {} }
plugin.getDocumentDigest = function()
    return "digest"
end
plugin.isOpenBookMatched = function()
    return true
end

rows = plugin:diagnosticsRows()
assertEqual(hasRow(rows, "Retry highlight sync"), true, "reader diagnostics shows highlight retry")
assertEqual(hasRow(rows, "Retry open-book match"), true, "reader diagnostics shows match retry")

plugin.settings.annotation_sync = false
rows = plugin:diagnosticsRows()
assertEqual(hasRow(rows, "Retry highlight sync"), false, "two-way-off diagnostics hides highlight retry")
assertEqual(hasRow(rows, "Retry open-book match"), true, "two-way-off diagnostics keeps match retry")

print("bookorbit_diagnostics_rows_test.lua: ok")
