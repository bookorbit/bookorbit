local mock_http_body = "{}"
local mock_http_code = 200

package.loaded["logger"] = {
    dbg = function() end,
}

package.loaded["util"] = {
    trim = function(value)
        return tostring(value or ""):match("^%s*(.-)%s*$")
    end,
    urlEncode = function(value)
        return tostring(value)
    end,
    removeFile = function() end,
}

package.loaded["socketutil"] = {
    LARGE_BLOCK_TIMEOUT = 1,
    LARGE_TOTAL_TIMEOUT = 1,
    FILE_BLOCK_TIMEOUT = 1,
    FILE_TOTAL_TIMEOUT = 1,
    set_timeout = function() end,
    reset_timeout = function() end,
}

package.loaded["socket"] = {
    skip = function(n, ...)
        local values = { ... }
        local shifted = {}
        for index = n + 1, #values do
            table.insert(shifted, values[index])
        end
        return unpack(shifted)
    end,
}

package.loaded["ltn12"] = {
    sink = {
        table = function(target)
            return function(chunk)
                if chunk then table.insert(target, chunk) end
                return 1
            end
        end,
        file = function(file)
            return function(chunk)
                if chunk then file:write(chunk) else file:close() end
                return 1
            end
        end,
    },
    source = {
        string = function(value)
            local pending = value
            return function()
                local chunk = pending
                pending = nil
                return chunk
            end
        end,
    },
}

package.loaded["socket.http"] = {
    request = function(request)
        if mock_http_body then
            request.sink(mock_http_body)
        end
        return 1, mock_http_code, {}, "HTTP " .. tostring(mock_http_code)
    end,
}

local rapidjson_null = {}
package.loaded["rapidjson"] = {
    null = rapidjson_null,
    encode = function()
        return "{}"
    end,
    decode = function(raw)
        if raw == "{}" then return {} end
        if raw == "{\"ok\":true}" then return { ok = true } end
        if raw == "{\"value\":null}" then return { value = rapidjson_null } end
        if raw == "null" then return rapidjson_null end
        return nil, "parse error"
    end,
}

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local BookOrbitApi = require("bookorbit_api")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local decoded, err = BookOrbitApi.decodeResponse({ "" })
assertEqual(type(decoded), "table", "empty body decodes to table")
assertEqual(err, nil, "empty body has no error")

decoded, err = BookOrbitApi.decodeResponse({ "{\"value\":null}" })
assertEqual(decoded.value, nil, "JSON null is scrubbed")
assertEqual(err, nil, "valid JSON has no error")

decoded, err = BookOrbitApi.decodeResponse({ "not-json" })
assertEqual(decoded, nil, "invalid JSON has no decoded body")
assertEqual(err, "invalid_json", "invalid JSON error code")

local client = BookOrbitApi.new{
    server_url = "https://bookorbit.example.com/api/v1",
    username = "reader",
    userkey = "secret",
}

mock_http_body = "{\"ok\":true}"
mock_http_code = 200
local body
body, err = client:auth()
assertEqual(body.ok, true, "request returns decoded body")
assertEqual(err, nil, "valid request has no error")

mock_http_body = "not-json"
mock_http_code = 200
body, err = client:auth()
assertEqual(body, nil, "invalid success body has no decoded body")
assertEqual(err, "invalid_json", "invalid success body returns invalid_json")

mock_http_body = "not-json"
mock_http_code = 503
local errbody
body, err, errbody = client:auth()
assertEqual(body, nil, "HTTP error has no decoded body")
assertEqual(err, 503, "HTTP error preserves status code")
assertEqual(errbody, nil, "invalid HTTP error body is ignored")

print("bookorbit_api_test.lua: ok")
