package.loaded["gettext"] = function(text)
    return text
end

package.loaded["ffi/util"] = {
    template = function(text, value)
        return text:gsub("%%1", tostring(value))
    end,
}

local ignored_input = {}
package.loaded["device"] = {
    model = "test-device",
    setIgnoreInput = function(_, value)
        table.insert(ignored_input, value)
    end,
}

local shown = {}
local scheduled = {}
package.loaded["ui/uimanager"] = {
    show = function(_, widget)
        table.insert(shown, widget)
    end,
    scheduleIn = function(_, _, callback)
        table.insert(scheduled, callback)
    end,
}
package.loaded["ui/widget/infomessage"] = { new = function(_, opts) return opts end }
package.loaded["ui/widget/inputdialog"] = {}
package.loaded["ui/widget/multiinputdialog"] = {}
package.loaded["ui/network/manager"] = {}
package.loaded["ui/widget/notification"] = {}
package.loaded["ffi/sha2"] = { md5 = function(value) return "md5:" .. value end }
package.loaded["util"] = {
    trim = function(value)
        return tostring(value or ""):match("^%s*(.-)%s*$")
    end,
}

local auth_result = { authorized = "OK" }
local created_clients = {}
package.loaded["bookorbit_api"] = {
    new = function(opts)
        table.insert(created_clients, opts)
        return {
            auth = function()
                if auth_result then return auth_result end
                return nil, 401
            end,
        }
    end,
}
package.loaded["bookorbit_highlight_diagnostics"] = {}
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

local function newPlugin()
    local applied_api = {}
    local refreshes = 0
    local plugin = {
        SYNC_STRATEGY = { PROMPT = 1, SILENT = 2, DISABLE = 3 },
        settings = {
            server_url = "https://old.example/api/v1",
            username = "old-user",
            userkey = "old-key",
        },
        apiOpts = function(self, background_requests)
            return {
                server_url = self.settings.server_url,
                username = self.settings.username,
                userkey = self.settings.userkey,
                background_requests = background_requests == true,
            }
        end,
        catalog_browser = {
            setApi = function(_, api)
                table.insert(applied_api, api)
            end,
            refreshCurrent = function()
                refreshes = refreshes + 1
            end,
        },
    }
    MainMenu.install(plugin)
    return plugin, applied_api, function() return refreshes end
end

local plugin, applied_api, refreshCount = newPlugin()
local menu_updates = 0
local menu = { updateItems = function() menu_updates = menu_updates + 1 end }

plugin:doLogin("new-user", "new-password", menu)
assertEqual(plugin.settings.username, "new-user", "successful login stores the username")
assertEqual(plugin.settings.userkey, "md5:new-password", "successful login stores the derived key")
assertEqual(#applied_api, 1, "successful login rebinds the active catalog")
assertEqual(applied_api[1].username, "new-user", "catalog receives the new username")
assertEqual(applied_api[1].userkey, "md5:new-password", "catalog receives the new key")
assertEqual(applied_api[1].background_requests, true, "catalog keeps background requests enabled")
assertEqual(refreshCount(), 1, "successful login refreshes the visible catalog")
assertEqual(menu_updates, 1, "successful login refreshes the account menu")
assertEqual(ignored_input[1], true, "login suppresses input while authenticating")
assertEqual(ignored_input[2], false, "login restores input after authenticating")

plugin:logout(menu)
assertEqual(plugin.settings.userkey, nil, "logout clears the stored key")
assertEqual(#applied_api, 2, "logout rebinds the active catalog")
assertEqual(applied_api[2].userkey, nil, "logout invalidates the catalog client key")
assertEqual(refreshCount(), 1, "logout does not issue an authenticated refresh")
assertEqual(menu_updates, 2, "logout refreshes the account menu")

plugin:applyServerAddress("https://new.example/api/v1")
assertEqual(plugin.settings.server_url, "https://new.example/api/v1", "server change updates settings")
assertEqual(#applied_api, 3, "server change rebinds the active catalog")
assertEqual(applied_api[3].server_url, "https://new.example/api/v1", "catalog receives the new server")
assertEqual(refreshCount(), 1, "server change does not make an implicit request")

plugin.catalog_browser = nil
plugin:applyServerAddress("https://closed.example/api/v1")
assertEqual(plugin.settings.server_url, "https://closed.example/api/v1", "server change works without an open catalog")
assertEqual(#applied_api, 3, "closed catalog needs no client rebind")

plugin, applied_api, refreshCount = newPlugin()
auth_result = nil
plugin:doLogin("rejected-user", "wrong-password")
assertEqual(plugin.settings.username, "old-user", "failed login preserves the previous username")
assertEqual(plugin.settings.userkey, "old-key", "failed login preserves the previous key")
assertEqual(#applied_api, 0, "failed login does not replace the catalog client")
assertEqual(refreshCount(), 0, "failed login does not refresh the catalog")
assertEqual(shown[#shown].text, "Login failed. Create or check your KOReader credentials in BookOrbit web settings.",
    "failed login shows the credential error")

print("bookorbit_catalog_auth_lifecycle_test: ok")
