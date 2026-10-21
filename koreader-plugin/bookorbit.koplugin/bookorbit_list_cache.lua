--[[--
The last book-list pages this device loaded, kept for when the server cannot
be reached. One small file per page under the BookOrbit cache, newest kept:
saving a page writes only that page, so a page turn never rewrites the rest.
A page is keyed by the account and its exact query, so a list is only ever
shown with what that same request returned.
]]

local DataStorage = require("datastorage")
local LuaSettings = require("luasettings")
local lfs = require("libs/libkoreader-lfs")
local md5 = require("ffi/sha2").md5
local util = require("util")

local ListCache = { MAX = 24 }

local function dir()
    return DataStorage:getDataDir() .. "/cache/bookorbit/lists"
end

-- account: a string naming the server and the user. query: the request's
-- parameters.
function ListCache.key(account, query)
    local parts = {}
    for k, v in pairs(query or {}) do table.insert(parts, tostring(k) .. "=" .. tostring(v)) end
    table.sort(parts)
    return tostring(account) .. "|" .. table.concat(parts, "&")
end

local function pathOf(key)
    return dir() .. "/" .. md5(key) .. ".lua"
end

-- Drops the oldest pages past MAX.
local function prune()
    local files = {}
    local ok, iter, state = pcall(lfs.dir, dir())
    if not ok then return end
    for name in iter, state do
        if name:match("%.lua$") then
            local path = dir() .. "/" .. name
            table.insert(files, { path = path, t = lfs.attributes(path, "modification") or 0 })
        end
    end
    if #files <= ListCache.MAX then return end
    table.sort(files, function(a, b) return a.t > b.t end)
    for i = ListCache.MAX + 1, #files do os.remove(files[i].path) end
end

function ListCache.put(key, body, now)
    if type(body) ~= "table" then return end
    if not util.makePath(dir()) then return end
    local store = LuaSettings:open(pathOf(key))
    store:saveSetting("key", key)
    store:saveSetting("saved_at", now or os.time())
    store:saveSetting("body", body)
    store:flush()
    prune()
end

-- { body, saved_at } or nil.
function ListCache.get(key)
    local path = pathOf(key)
    if not lfs.attributes(path, "mode") then return nil end
    local store = LuaSettings:open(path)
    -- Two keys sharing a hash must not serve each other's page.
    if store:readSetting("key") ~= key then return nil end
    local body = store:readSetting("body")
    if type(body) ~= "table" then return nil end
    return { body = body, saved_at = store:readSetting("saved_at") }
end

return ListCache
