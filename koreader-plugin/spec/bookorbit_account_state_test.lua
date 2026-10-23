local function copy(value)
    if type(value) ~= "table" then return value end
    local result = {}
    for key, item in pairs(value) do result[key] = copy(item) end
    return result
end
local root = "/path/to/settings"
local legacy_path = root .. "/bookorbit_sync_state.lua"
local disk = { [legacy_path] = { books = { old = { bookId = 10, fileId = 20, file = "/path/to/book.epub" } } } }
package.loaded["datastorage"] = { getSettingsDir = function() return root end }
package.loaded["luasettings"] = {
    open = function(_, path)
        local data = copy(disk[path] or {})
        return {
            readSetting = function(_, key, fallback)
                if data[key] == nil then data[key] = fallback end
                return data[key]
            end,
            saveSetting = function(_, key, value) data[key] = value end,
            atomicFlush = function() disk[path] = copy(data); return true end,
        }
    end,
}
package.loaded["ffi/sha2"] = { md5 = function(value) return value:gsub("[^%w]", "_") end }
package.loaded["dump"] = function() return "{}" end
package.loaded["ffi/util"] = {}
package.loaded["libs/libkoreader-lfs"] = {
    attributes = function(_, attribute) return attribute == "mode" and "file" or { mode = "file" } end,
}
package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path
local Manager = require("bookorbit_state_manager")
local function equal(actual, expected, label)
    assert(actual == expected, label .. ": " .. tostring(actual))
end
local a = { server_url = "https://one.example/api/v1", username = "reader", userkey = "key" }
local b = { server_url = a.server_url, username = "restricted", userkey = "other" }
Manager.setAccount(a)
equal(Manager.getBook("old").bookId, 10, "first account retains legacy matches")
local pending = Manager.session()
pending.books.late = { bookId = 99 }
Manager.setAccount(b)
equal(Manager.getBook("old"), nil, "second account has no legacy matches")
equal(next(Manager.onDeviceMaps().byBookId), nil, "second account has no inherited device map")
local result, err = pending:flush()
equal(result, nil, "late old-account session is rejected")
equal(err, "stale_account", "late session has stable error")
Manager.linkFile("new", 30, 40, "/path/to/other.epub")
Manager.setAccount(a)
equal(Manager.getBook("old").bookId, 10, "returning restores first account")
equal(Manager.getBook("new"), nil, "second account does not contaminate first")
equal(Manager.getBook("late"), nil, "rejected work did not publish")
a.userkey = "rotated"
equal(Manager.setAccount(a), false, "credential rotation retains account state")
Manager.setAccount({ server_url = "https://two.example/api/v1", username = a.username, userkey = a.userkey })
equal(Manager.getBook("old"), nil, "same username on another server is isolated")
Manager.setAccount({ server_url = a.server_url, username = a.username })
equal(Manager.getBook("old"), nil, "logout hides authenticated matches")
Manager.reset()
Manager.setAccount(b)
equal(Manager.getBook("new").bookId, 40, "second account persists across restart")
Manager.setAccount(a)
equal(Manager.getBook("old").bookId, 10, "legacy ownership persists across restart")
print("bookorbit_account_state_test.lua: ok")
