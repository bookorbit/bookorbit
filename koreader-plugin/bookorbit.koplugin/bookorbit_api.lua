--[[--
HTTP client for the BookOrbit server.

Speaks the kosync-compatible progress endpoints plus the BookOrbit plugin
endpoints. All requests are blocking; callers keep them short and chunked.
]]

local http = require("socket.http")
local ltn12 = require("ltn12")
local rapidjson = require("rapidjson")
local socket = require("socket")
local socketutil = require("socketutil")
local logger = require("logger")
local util = require("util")

local MAX_BODY_BYTES = 900 * 1024 -- stays under the server's 1 MiB body limit

-- Plain empty Lua tables would encode as {} and fail the server's array
-- validation; every empty table in our payloads is semantically an array.
local ENCODE_OPTIONS = { empty_table_as_array = true }

-- JSON null decodes to the rapidjson.null lightuserdata, which is truthy in
-- Lua and would leak into sidecars and truthiness checks; treat it as absent.
local function scrubNulls(value)
    if value == rapidjson.null then return nil end
    if type(value) == "table" then
        for key, item in pairs(value) do
            value[key] = scrubNulls(item)
        end
    end
    return value
end

local BookOrbitApi = {}
BookOrbitApi.__index = BookOrbitApi

-- Normalizes a user-entered server address to the API base, e.g.
-- "https://books.example.com/" -> "https://books.example.com/api/v1".
function BookOrbitApi.normalizeServerUrl(input)
    if not input then return nil end
    local url = util.trim(input)
    if url == "" then return nil end
    url = url:gsub("/+$", "")
    if not url:match("/api/v1$") then
        url = url .. "/api/v1"
    end
    return url
end

function BookOrbitApi.new(opts)
    return setmetatable({
        server_url = opts.server_url,
        username = opts.username,
        userkey = opts.userkey,
        device_id = opts.device_id,
        device_model = opts.device_model,
        plugin_version = opts.plugin_version,
    }, BookOrbitApi)
end

function BookOrbitApi:isConfigured()
    return self.server_url ~= nil and self.username ~= nil and self.userkey ~= nil
end

-- Returns decoded_body on success, or nil, err_code, decoded_error_body.
-- err_code is a number for HTTP errors and a string for transport errors.
function BookOrbitApi:request(method, path, body)
    local sink = {}
    local request = {
        url = self.server_url .. path,
        method = method,
        sink = ltn12.sink.table(sink),
        headers = {
            ["accept"] = "application/json",
            ["x-auth-user"] = self.username,
            ["x-auth-key"] = self.userkey,
        },
    }

    if body then
        local body_json, encode_err = rapidjson.encode(body, ENCODE_OPTIONS)
        if not body_json then
            return nil, "encode_error: " .. tostring(encode_err)
        end
        if #body_json > MAX_BODY_BYTES then
            return nil, "body_too_large"
        end
        request.source = ltn12.source.string(body_json)
        request.headers["Content-Type"] = "application/json"
        request.headers["Content-Length"] = #body_json
    end

    socketutil:set_timeout(socketutil.LARGE_BLOCK_TIMEOUT, socketutil.LARGE_TOTAL_TIMEOUT)
    local code, _, status = socket.skip(1, http.request(request))
    socketutil:reset_timeout()

    if type(code) ~= "number" then
        logger.dbg("BookOrbit: network error:", status or code)
        return nil, tostring(status or code or "network_error")
    end

    local decoded = nil
    if sink[1] then
        decoded = scrubNulls(rapidjson.decode(table.concat(sink)))
    end

    if code < 200 or code >= 300 then
        return nil, code, decoded
    end

    return decoded or {}
end

function BookOrbitApi:withDevice(body)
    body.deviceId = self.device_id
    body.deviceModel = self.device_model
    body.pluginVersion = self.plugin_version
    -- KOReader datetimes are local wall clock with no timezone; the server
    -- needs our clock to mint device datetimes that are not in our future.
    body.deviceTime = os.date("%Y-%m-%d %H:%M:%S")
    return body
end

-- kosync-compatible endpoints (existing BookOrbit API, snake_case wire format)

function BookOrbitApi:auth()
    return self:request("GET", "/koreader/users/auth")
end

function BookOrbitApi:getProgress(digest)
    return self:request("GET", "/koreader/syncs/progress/" .. digest)
end

function BookOrbitApi:updateProgress(digest, percentage, progress, timestamp)
    return self:request("PUT", "/koreader/syncs/progress", {
        document = digest,
        percentage = percentage,
        progress = progress,
        device = self.device_model,
        device_id = self.device_id,
        timestamp = timestamp,
    })
end

-- BookOrbit plugin endpoints (camelCase wire format)

function BookOrbitApi:matchCheck(hashes)
    return self:request("POST", "/koreader/plugin/match-check", self:withDevice({ hashes = hashes }))
end

function BookOrbitApi:uploadPageStats(books)
    return self:request("POST", "/koreader/plugin/page-stats", self:withDevice({ books = books }))
end

-- Deprecated one-way upload, kept as fallback for pre-0.4 servers.
function BookOrbitApi:uploadAnnotations(books)
    return self:request("POST", "/koreader/plugin/annotations", self:withDevice({ books = books }))
end

function BookOrbitApi:exchangeAnnotations(books)
    return self:request("POST", "/koreader/plugin/annotations/exchange", self:withDevice({ books = books }))
end

function BookOrbitApi:exchangeAck(books)
    return self:request("POST", "/koreader/plugin/annotations/exchange-ack", self:withDevice({ books = books }))
end

function BookOrbitApi:uploadBookStates(books)
    return self:request("POST", "/koreader/plugin/book-states", self:withDevice({ books = books }))
end

function BookOrbitApi:bulkProgress(items)
    return self:request("POST", "/koreader/plugin/progress", self:withDevice({ items = items }))
end

function BookOrbitApi:sweepComplete(counts)
    return self:request("POST", "/koreader/plugin/sweeps", self:withDevice({
        booksMatched = counts.books_matched or 0,
        pageStatsUploaded = counts.page_stats or 0,
        annotationsUpserted = counts.annotations or 0,
    }))
end

return BookOrbitApi
