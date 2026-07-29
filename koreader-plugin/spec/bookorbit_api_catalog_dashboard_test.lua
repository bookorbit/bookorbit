-- Executes the real BookOrbitApi catalog dashboard helper and verifies the
-- request serialized at the HTTP boundary.

package.loaded["socket.http"] = { request = function() end }
package.loaded["ltn12"] = { sink = {}, source = {} }
package.loaded["rapidjson"] = {
    null = {},
    encode = function() return "{}" end,
    decode = function() return {} end,
}
package.loaded["socket"] = {
    skip = function(count, ...)
        return select(count + 1, ...)
    end,
}
package.loaded["socketutil"] = {
    set_timeout = function() end,
    reset_timeout = function() end,
}
package.loaded["logger"] = {
    dbg = function() end,
    warn = function() end,
}
package.loaded["util"] = {
    trim = function(value)
        return tostring(value or ""):match("^%s*(.-)%s*$")
    end,
    urlEncode = function(value)
        return tostring(value):gsub(" ", "%%20")
    end,
}
package.loaded["ui/trapper"] = {
    isWrapped = function() return true end,
}

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local BookOrbitApi = require("bookorbit_api")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local api = BookOrbitApi.new{
    server_url = "https://books.example.test/api/v1",
    username = "reader",
    userkey = "key",
}
local captured
function api:request(method, path, body)
    captured = { method = method, path = path, body = body }
    return {
        generatedAt = "2026-07-29T00:00:00.000Z",
        continueReading = {},
        section = { type = "smart-scope", smartScopeId = 42, books = { { id = 9 } } },
    }
end

local response = api:catalogDashboard({ type = "smart-scope", smartScopeId = 42 })
assertEqual(captured.method, "GET", "dashboard uses GET")
assertEqual(captured.path,
    "/koreader/plugin/catalog/dashboard?section=smart-scope&smartScopeId=42",
    "dashboard serializes section.type and smartScopeId")
assertEqual(captured.body, nil, "dashboard GET has no body")
assertEqual(response.generatedAt, "2026-07-29T00:00:00.000Z", "dashboard returns response metadata")
assertEqual(response.section.type, "smart-scope", "dashboard returns the requested section type")
assertEqual(response.section.smartScopeId, 42, "dashboard returns the requested smart scope")
assertEqual(response.section.books[1].id, 9, "dashboard returns section books")

api:catalogDashboard({ type = "recently-added" })
assertEqual(captured.path,
    "/koreader/plugin/catalog/dashboard?section=recently-added",
    "dashboard omits an unset smartScopeId")

api:catalogDashboard()
assertEqual(captured.path, "/koreader/plugin/catalog/dashboard", "legacy dashboard requests remain unparameterized")

print("bookorbit_api_catalog_dashboard_test.lua: ok")
