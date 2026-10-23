-- Proves the saved list pages: a page is found again only by the same account
-- and the same query (in any parameter order), a hash shared by two keys never
-- serves the wrong page, and only the newest pages are kept.

local files = {}
local mtime = {}
local clock = 0

package.loaded["datastorage"] = { getDataDir = function() return "/data" end }
package.loaded["util"] = { makePath = function() return true end }
package.loaded["ffi/sha2"] = { md5 = function(value) return value:gsub("[^%w]", "_") end }
package.loaded["libs/libkoreader-lfs"] = {
    attributes = function(path, what)
        if not files[path] then return nil end
        if what == "mode" then return "file" end
        if what == "modification" then return mtime[path] end
        return { mode = "file" }
    end,
    dir = function()
        local names = {}
        for path in pairs(files) do table.insert(names, (path:match("[^/]+$"))) end
        local i = 0
        return function()
            i = i + 1
            return names[i]
        end, nil
    end,
}
local real_remove = os.remove
os.remove = function(path)
    files[path] = nil
    mtime[path] = nil
    return true
end
package.loaded["luasettings"] = {
    open = function(_, path)
        local data = files[path] or {}
        return {
            saveSetting = function(_, k, v) data[k] = v end,
            readSetting = function(_, k) return data[k] end,
            flush = function()
                clock = clock + 1
                files[path] = data
                mtime[path] = clock
            end,
        }
    end,
}

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local ListCache = require("bookorbit_list_cache")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local account = "https://books.example|reader"
local a = ListCache.key(account, { sort = "title", page = 1, size = 11 })
local b = ListCache.key(account, { size = 11, page = 1, sort = "title" })
assertEqual(a, b, "parameter order does not change the key")
assertEqual(ListCache.key("https://books.example|other", { sort = "title", page = 1, size = 11 }) == a, false, "another account has its own pages")
assertEqual(ListCache.key(account, { sort = "title", page = 2, size = 11 }) == a, false, "another page has its own key")

ListCache.put(a, { items = { { id = 7, title = "Dune" } }, total = 1 }, 1000)
local saved = ListCache.get(b)
assertEqual(saved and saved.body.items[1].title, "Dune", "a saved page comes back")
assertEqual(saved and saved.saved_at, 1000, "with when it was saved")
assertEqual(ListCache.get(ListCache.key(account, { sort = "title", page = 2, size = 11 })), nil, "an unsaved page is not found")

-- Two keys whose hashes collide: the stored key decides.
local stub_md5 = package.loaded["ffi/sha2"].md5
package.loaded["ffi/sha2"].md5 = function() return "same" end
package.loaded["bookorbit_list_cache"] = nil
local Colliding = require("bookorbit_list_cache")
Colliding.put("first", { items = {} }, 1)
assertEqual(Colliding.get("second"), nil, "a colliding key never serves another page")
package.loaded["ffi/sha2"].md5 = stub_md5
package.loaded["bookorbit_list_cache"] = nil
ListCache = require("bookorbit_list_cache")

ListCache.MAX = 3
for page = 1, 5 do ListCache.put(ListCache.key(account, { page = page }), { items = {} }, page) end
local kept = 0
for _path in pairs(files) do kept = kept + 1 end
assertEqual(kept, 3, "only the newest pages are kept")
assertEqual(ListCache.get(ListCache.key(account, { page = 5 })) ~= nil, true, "the newest page survives")
assertEqual(ListCache.get(ListCache.key(account, { page = 3 })) ~= nil, true, "as do the next newest")
assertEqual(ListCache.get(ListCache.key(account, { page = 1 })), nil, "the oldest page is dropped")
assertEqual(ListCache.get(a), nil, "older lists go first")

local newest = ListCache.key(account, { page = 5 })
ListCache.put(newest, "not a page", 6)
assertEqual(type(ListCache.get(newest).body), "table", "a malformed body is not saved over a page")

os.remove = real_remove
print("bookorbit_list_cache_test.lua: ok")
