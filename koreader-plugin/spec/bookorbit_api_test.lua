local mock_http_body = "{}"
local mock_http_code = 200
local request_ran_in_subprocess = false
local in_subprocess = false
local encoded_subprocess_result

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

local last_request_url
package.loaded["socket.http"] = {
    request = function(request)
        request_ran_in_subprocess = in_subprocess
        last_request_url = request.url
        if mock_http_body then
            request.sink(mock_http_body)
        end
        return 1, mock_http_code, {}, "HTTP " .. tostring(mock_http_code)
    end,
}

local rapidjson_null = {}
package.loaded["rapidjson"] = {
    null = rapidjson_null,
    encode = function(value)
        if type(value) == "table"
                and (value.body ~= nil or value.err ~= nil or value.errbody ~= nil) then
            encoded_subprocess_result = value
            return "__subprocess_result__"
        end
        return "{}"
    end,
    decode = function(raw)
        if raw == "{}" then return {} end
        if raw == "__subprocess_result__" then return encoded_subprocess_result end
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

local loopback_client = BookOrbitApi.new{
    server_url = "http://localhost:3000/api/v1",
}
assertEqual(loopback_client.server_url, "http://127.0.0.1:3000/api/v1",
    "HTTP localhost is made safe before a macOS subprocess fork")

local secure_loopback_client = BookOrbitApi.new{
    server_url = "https://localhost:3443/api/v1",
}
assertEqual(secure_loopback_client.server_url, "https://localhost:3443/api/v1",
    "HTTPS localhost retains its certificate hostname")

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

mock_http_body = "{\"ok\":true}"
mock_http_code = 200
client:catalogDashboardSection("up-next-in-series")
assertEqual(last_request_url,
    "https://bookorbit.example.com/api/v1/koreader/plugin/catalog/dashboard/sections/up-next-in-series",
    "the dashboard-section endpoint is addressed by source type")

local wrapped = true
local subprocess_calls = 0
local subprocess_result_mode = "normal"
package.loaded["ui/trapper"] = {
    isWrapped = function()
        return wrapped
    end,
    dismissableRunInSubprocess = function(_, task, trap_widget, task_returns_simple_string)
        assertEqual(type(trap_widget), "table", "background request uses a detached trap widget")
        assertEqual(task_returns_simple_string, true, "background request uses a string result envelope")
        subprocess_calls = subprocess_calls + 1
        in_subprocess = true
        local result = task()
        in_subprocess = false
        if subprocess_result_mode == "missing" then
            return true
        elseif subprocess_result_mode == "malformed" then
            return true, "not-json"
        end
        return true, result
    end,
}

local background_client = BookOrbitApi.new{
    server_url = "https://bookorbit.example.com/api/v1",
    username = "reader",
    userkey = "secret",
    background_requests = true,
}

mock_http_body = "{\"ok\":true}"
mock_http_code = 200
body, err = background_client:auth()
assertEqual(body.ok, true, "background request returns decoded body")
assertEqual(err, nil, "background request preserves success result")
assertEqual(subprocess_calls, 1, "wrapped background request uses subprocess")
assertEqual(request_ran_in_subprocess, true, "HTTP request runs inside subprocess task")

subprocess_result_mode = "missing"
body, err = background_client:auth()
assertEqual(body, nil, "missing subprocess payload has no response body")
assertEqual(err, "subprocess_no_result", "missing subprocess payload has a specific error")

subprocess_result_mode = "malformed"
body, err = background_client:auth()
assertEqual(body, nil, "malformed subprocess payload has no response body")
assertEqual(err, "subprocess_invalid_result", "malformed subprocess payload has a specific error")

subprocess_result_mode = "normal"
wrapped = false
request_ran_in_subprocess = false
body, err = background_client:auth()
assertEqual(body.ok, true, "unwrapped request falls back safely")
assertEqual(subprocess_calls, 3, "unwrapped request does not start subprocess")
assertEqual(request_ran_in_subprocess, false, "unwrapped fallback runs in current process")

print("bookorbit_api_test.lua: ok")
