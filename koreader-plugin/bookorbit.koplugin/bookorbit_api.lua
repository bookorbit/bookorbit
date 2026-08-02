--[[--
HTTP client for the BookOrbit server.

Speaks the kosync-compatible progress endpoints plus the BookOrbit plugin
endpoints. Sync clients run blocking requests in a subprocess when called from
a Trapper coroutine, keeping KOReader's UI loop responsive.
]]

local http = require("socket.http")
local ltn12 = require("ltn12")
local rapidjson = require("rapidjson")
local socket = require("socket")
local socketutil = require("socketutil")
local logger = require("logger")
local util = require("util")

local TransferPolicy = require("bookorbit_transfer_policy")
local TransferProgress = require("bookorbit_transfer_progress")

local MAX_BODY_BYTES = 900 * 1024 -- stays under the server's 1 MiB body limit

local MAX_DOWNLOAD_REDIRECTS = 5

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

local function decodeResponse(parts)
    local raw = table.concat(parts or {})
    if raw == "" then
        return {}
    end
    local ok, decoded, decode_err = pcall(rapidjson.decode, raw)
    if not ok or decoded == nil then
        logger.dbg("BookOrbit: invalid JSON response:", ok and decode_err or decoded)
        return nil, "invalid_json"
    end
    return scrubNulls(decoded) or {}
end

local function encodeSubprocessResult(body, err, errbody)
    local ok, encoded = pcall(rapidjson.encode, {
        body = body,
        err = err,
        errbody = errbody,
    })
    if ok and type(encoded) == "string" and encoded ~= "" then
        return encoded
    end
    return '{"err":"subprocess_result_encode_failed"}'
end

local function decodeSubprocessResult(encoded)
    if type(encoded) ~= "string" or encoded == "" then
        return nil, "subprocess_no_result"
    end
    local decoded = decodeResponse({ encoded })
    if type(decoded) ~= "table" then
        return nil, "subprocess_invalid_result"
    end
    return decoded
end

local function parseHttpUrl(value)
    local scheme, authority = tostring(value or ""):match("^(https?)://([^/%?#]+)")
    if not scheme or not authority or authority:find("@", 1, true) then return nil end

    local host, port
    if authority:sub(1, 1) == "[" then
        host, port = authority:match("^(%b[]):?(%d*)$")
    else
        host, port = authority:match("^([^:]+):?(%d*)$")
    end
    if not host or host == "" then return nil end
    port = port ~= "" and tonumber(port) or (scheme == "https" and 443 or 80)
    if not port then return nil end
    return {
        scheme = scheme,
        authority = authority,
        host = host:lower(),
        port = port,
    }
end

local function absoluteUrl(base, location)
    if location:match("^https?://") then return location end
    local parsed = parseHttpUrl(base)
    if not parsed then return nil end
    if location:sub(1, 2) == "//" then
        return parsed.scheme .. ":" .. location
    end
    local origin = parsed.scheme .. "://" .. parsed.authority
    if location:sub(1, 1) == "/" then return origin .. location end
    local directory = base:match("^(.*)/") or origin
    return directory .. "/" .. location
end

local function forkSafeServerUrl(value)
    local scheme, authority, suffix = tostring(value or ""):match("^(https?)://([^/%?#]+)(.*)$")
    if scheme ~= "http" or not authority then return value end
    local port = authority:lower():match("^localhost:(%d+)$")
    if authority:lower() == "localhost" then
        return "http://127.0.0.1" .. suffix
    elseif port then
        return "http://127.0.0.1:" .. port .. suffix
    end
    return value
end

local BookOrbitApi = {}
BookOrbitApi.__index = BookOrbitApi
BookOrbitApi.decodeResponse = decodeResponse

-- Normalizes a user-entered server address to the API base, e.g.
-- "https://books.example.com/" -> "https://books.example.com/api/v1".
function BookOrbitApi.normalizeServerUrl(input)
    if not input then return nil end
    local url = util.trim(input)
    if url == "" then return nil end
    url = url:gsub("/+$", "")
    url = url:gsub("/api/v1/koreader$", "/api/v1")
    if not url:match("/api/v1$") then
        url = url .. "/api/v1"
    end
    return url
end

function BookOrbitApi.new(opts)
    return setmetatable({
        server_url = forkSafeServerUrl(opts.server_url),
        username = opts.username,
        userkey = opts.userkey,
        device_id = opts.device_id,
        device_model = opts.device_model,
        plugin_version = opts.plugin_version,
        background_requests = opts.background_requests == true,
    }, BookOrbitApi)
end

function BookOrbitApi:isConfigured()
    return self.server_url ~= nil and self.username ~= nil and self.userkey ~= nil
end

-- Returns decoded_body on success, or nil, err_code, decoded_error_body.
-- err_code is a number for HTTP errors and a string for transport errors.
function BookOrbitApi:requestBlocking(method, path, body)
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

    local decoded, decode_err = decodeResponse(sink)

    if code < 200 or code >= 300 then
        return nil, code, decoded
    end

    if decode_err then
        return nil, decode_err
    end

    return decoded or {}
end

-- True when this call may fork its own background worker: the client is in
-- background mode, a Trapper coroutine is driving us, and no enclosing
-- runInSubprocess already owns a child for this work.
function BookOrbitApi:canForkSubprocess()
    if not self.background_requests then return false end
    if (self.subprocess_depth or 0) > 0 then return false end
    local loaded, Trapper = pcall(require, "ui/trapper")
    if not loaded or not Trapper:isWrapped() then return false end
    return true
end

-- Owns exactly one background subprocess for the duration of fn. Calls that
-- fn makes back into this client see a non-zero depth in the forked child and
-- run inline, so a request is never wrapped by two nested workers.
--
-- fn must return (body, err, errbody); they are marshalled back through the
-- subprocess. Returns completed, { body, err, errbody }; completed is false
-- when the user dismissed the request.
function BookOrbitApi:runInSubprocess(fn, trap_widget)
    if not self:canForkSubprocess() then
        local ok, body, err, errbody = pcall(fn)
        if not ok then return true, { err = tostring(body) } end
        return true, { body = body, err = err, errbody = errbody }
    end

    local Trapper = require("ui/trapper")
    -- An unmounted widget lets Trapper poll without intercepting reader input.
    local widget = trap_widget or {}
    local completed, encoded = Trapper:dismissableRunInSubprocess(function()
        self.subprocess_depth = (self.subprocess_depth or 0) + 1
        local ok, body, err, errbody = pcall(fn)
        self.subprocess_depth = self.subprocess_depth - 1
        if not ok then
            return encodeSubprocessResult(nil, tostring(body))
        end
        return encodeSubprocessResult(body, err, errbody)
    end, widget, true)
    if type(widget) == "table" then widget.dismiss_callback = nil end
    if not completed then return false end
    local result, decode_err = decodeSubprocessResult(encoded)
    if not result then
        return true, { err = decode_err }
    end
    return true, result
end

function BookOrbitApi:request(method, path, body)
    if not self:canForkSubprocess() then
        return self:requestBlocking(method, path, body)
    end

    local completed, result = self:runInSubprocess(function()
        return self:requestBlocking(method, path, body)
    end)
    if not completed then
        return nil, "background_request_interrupted"
    end
    return result.body, result.err, result.errbody
end

function BookOrbitApi:query(path, params)
    if not params then return path end

    local keys = {}
    for key, value in pairs(params) do
        if value ~= nil and value ~= "" then
            table.insert(keys, key)
        end
    end
    table.sort(keys)
    if #keys == 0 then return path end

    local parts = {}
    for _, key in ipairs(keys) do
        table.insert(parts, util.urlEncode(key) .. "=" .. util.urlEncode(tostring(params[key])))
    end
    return path .. "?" .. table.concat(parts, "&")
end

-- Downloads to a temporary file and publishes it with an atomic rename, so a
-- timeout, an oversized body or a cancelled generation can never leave a
-- half-written file where a complete one is expected.
--
-- opts: accept, progress_cb, progress_path, progress_generation, temp_path,
-- max_bytes, expect_content_type, block_timeout, total_timeout, expected_bytes,
-- publish. With publish = "parent" the complete temporary file is handed back
-- instead of renamed, so a cancelled generation cannot be published by a child
-- that was already finishing.
function BookOrbitApi:downloadBlocking(path, local_path, opts)
    opts = opts or {}
    local temp_path = opts.temp_path or (local_path .. ".part")
    local max_bytes = opts.max_bytes or TransferPolicy.maxBytes(opts.expected_bytes)
    local progress_cb = opts.progress_cb
    local progress_writer = opts.progress_path and TransferProgress.writer(opts.progress_path, {
        generation = opts.progress_generation,
        total = tonumber(opts.expected_bytes) or 0,
    })
    local current_url = self.server_url .. path
    local origin = parseHttpUrl(current_url)
    local total_received = 0

    local function fail(out, err)
        if out then pcall(function() out:close() end) end
        util.removeFile(temp_path)
        return nil, err
    end

    local function sameOriginRedirect(location)
        if type(location) ~= "string" or location == "" then return nil end
        local resolved = absoluteUrl(current_url, location:gsub("%s", ""))
        local parsed = parseHttpUrl(resolved)
        if not origin or not parsed
                or parsed.scheme ~= origin.scheme
                or parsed.host ~= origin.host
                or parsed.port ~= origin.port then
            return nil
        end
        return resolved
    end

    for redirect_count = 0, MAX_DOWNLOAD_REDIRECTS do
        local out, open_err = io.open(temp_path, "w")
        if not out then
            return nil, tostring(open_err or "open_error")
        end

        local received = 0
        local too_large = false
        local file_sink = ltn12.sink.file(out)
        local sink = function(chunk, err)
            if chunk and chunk ~= "" then
                received = received + #chunk
                total_received = total_received + #chunk
                if received > max_bytes or total_received > max_bytes then
                    too_large = true
                    return nil, "response_too_large"
                end
                if progress_cb then progress_cb(received) end
                if progress_writer then progress_writer(received, false) end
            end
            return file_sink(chunk, err)
        end

        local request = {
            url = current_url,
            method = "GET",
            sink = sink,
            redirect = false,
            headers = {
                ["accept"] = opts.accept or "application/octet-stream",
                ["Accept-Encoding"] = "identity",
                ["x-auth-user"] = self.username,
                ["x-auth-key"] = self.userkey,
            },
        }

        socketutil:set_timeout(
            opts.block_timeout or socketutil.FILE_BLOCK_TIMEOUT,
            opts.total_timeout or socketutil.FILE_TOTAL_TIMEOUT)
        local code, headers, status = socket.skip(1, http.request(request))
        socketutil:reset_timeout()

        if too_large then return fail(out, "response_too_large") end
        if type(code) ~= "number" then
            return fail(out, tostring(status or code or "network_error"))
        end

        if code == 301 or code == 302 or code == 303 or code == 307 or code == 308 then
            pcall(function() out:close() end)
            util.removeFile(temp_path)
            if redirect_count >= MAX_DOWNLOAD_REDIRECTS then
                return nil, "too_many_redirects"
            end
            local location = headers and (headers.location or headers.Location)
            local redirected = sameOriginRedirect(location)
            if not redirected then return nil, "unsafe_redirect" end
            current_url = redirected
        else
            if code ~= 200 then return fail(out, code) end
            if received == 0 then return fail(out, "empty_response") end

            local expected_type = opts.expect_content_type
            if expected_type then
                local content_type = headers and (headers["content-type"] or headers["Content-Type"])
                local media_type = content_type and tostring(content_type):lower():match("^%s*([^;]+)")
                if not media_type or media_type:sub(1, #expected_type) ~= expected_type then
                    return fail(out, "unexpected_content_type")
                end
            end

            if progress_writer then progress_writer(received, true) end

            -- The parent owns publishing for user-cancellable transfers: a
            -- dismissed subprocess cannot be stopped once it starts renaming,
            -- which is harmless for a cover but wrong for a cancelled book.
            if opts.publish == "parent" then
                local result = { temp_path = temp_path, bytes = received }
                -- Hashing here keeps the digest off the UI thread and lets the
                -- caller compare it to the manifest without a match request.
                if opts.hash == "partial_md5" then
                    local hashed, digest = pcall(util.partialMD5, temp_path)
                    result.hash = hashed and digest or nil
                end
                return result
            end
            if temp_path == local_path then return true end
            local renamed, rename_err = os.rename(temp_path, local_path)
            if not renamed then
                return fail(out, tostring(rename_err or "publish_failed"))
            end
            return true
        end
    end

    return nil, "too_many_redirects"
end

-- Runs the transfer in a background subprocess when this client owns no worker
-- yet. A forked child cannot reach the parent's UI, so live byte progress
-- travels through the snapshot file named by opts.progress_path; only a caller
-- that has nothing but an in-process progress_cb stays blocking.
function BookOrbitApi:download(path, local_path, opts)
    opts = opts or {}
    local blocking = opts.background == false
        or (opts.progress_cb ~= nil and opts.progress_path == nil)
        or not self:canForkSubprocess()
    if blocking then
        return self:downloadBlocking(path, local_path, opts)
    end

    -- A child's progress_cb would touch parent-only UI state from the forked
    -- process; the snapshot file is the only channel back.
    local child_opts = {}
    for key, value in pairs(opts) do child_opts[key] = value end
    child_opts.progress_cb = nil

    local completed, result = self:runInSubprocess(function()
        return self:downloadBlocking(path, local_path, child_opts)
    end, opts.trap_widget)
    if not completed then
        return nil, "cancelled"
    end
    return result.body, result.err
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

function BookOrbitApi:matchCheck(hashes, candidates)
    local payload = { hashes = hashes }
    if candidates then
        payload.books = {}
        for _, hash in ipairs(hashes) do
            local cand = candidates[hash] or {}
            table.insert(payload.books, {
                hash = hash,
                title = cand.title,
                authors = cand.authors,
                lastOpen = cand.last_open,
                source = cand.source,
                metadataAmbiguous = cand.metadata_ambiguous,
            })
        end
    end
    return self:request("POST", "/koreader/plugin/match-check", self:withDevice(payload))
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

function BookOrbitApi:exchangeBookmarks(books)
    return self:request("POST", "/koreader/plugin/bookmarks/exchange", self:withDevice({ books = books }))
end

function BookOrbitApi:exchangeBookmarksAck(books)
    return self:request("POST", "/koreader/plugin/bookmarks/exchange-ack", self:withDevice({ books = books }))
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

-- BookOrbit catalog endpoints

function BookOrbitApi:catalogRoot()
    return self:request("GET", "/koreader/plugin/catalog/root")
end

-- The dashboard body carries the stats, Continue reading and Discover the
-- shelves are built from. Each configured shelf is then fetched through the
-- ordinary catalog endpoints, so nothing here is section-aware.
function BookOrbitApi:catalogDashboard()
    return self:request("GET", "/koreader/plugin/catalog/dashboard")
end

function BookOrbitApi:catalogDiscover()
    return self:request("GET", "/koreader/plugin/catalog/dashboard/discover")
end

-- One server-composed dashboard section (want-to-read, up-next-in-series).
-- Only valid against servers advertising the catalogDashboardSections
-- capability; older ones answer 404.
function BookOrbitApi:catalogDashboardSection(section_type)
    return self:request("GET", "/koreader/plugin/catalog/dashboard/sections/" .. util.urlEncode(tostring(section_type)))
end

function BookOrbitApi:catalogSection(section, params)
    return self:request("GET", self:query("/koreader/plugin/catalog/sections/" .. util.urlEncode(section), params))
end

function BookOrbitApi:catalogSetReadStatus(book_id, status)
    return self:request("PUT", "/koreader/plugin/catalog/books/" .. tostring(book_id) .. "/read-status", { status = status })
end

function BookOrbitApi:catalogSetRating(book_id, rating)
    if rating == nil then rating = rapidjson.null end
    return self:request("PUT", "/koreader/plugin/catalog/books/" .. tostring(book_id) .. "/rating", { rating = rating })
end

function BookOrbitApi:catalogBooks(params)
    return self:request("GET", self:query("/koreader/plugin/catalog/books", params))
end

-- Cursor-paginated bulk download manifest. One page carries everything
-- selection and transfer need, so a bulk run issues no per-book detail request.
function BookOrbitApi:catalogManifest(params)
    params = params or {}
    params.deviceId = params.deviceId or self.device_id
    return self:request("GET", self:query("/koreader/plugin/catalog/manifest", params))
end

function BookOrbitApi:catalogBook(book_id)
    return self:request("GET", self:query("/koreader/plugin/catalog/books/" .. tostring(book_id), { deviceId = self.device_id }))
end

function BookOrbitApi:downloadCatalogFile(file_id, local_path, opts)
    return self:download("/koreader/plugin/catalog/files/" .. tostring(file_id) .. "/download", local_path, opts)
end

function BookOrbitApi:downloadCatalogThumbnail(book_id, local_path, opts)
    opts = opts or {}
    opts.accept = "image/jpeg,image/*"
    opts.expect_content_type = "image/"
    return self:download("/koreader/plugin/catalog/books/" .. tostring(book_id) .. "/thumbnail", local_path, opts)
end

-- Plugin self-update endpoints

function BookOrbitApi:getPluginVersion()
    return self:request("GET", "/koreader/plugin/version")
end

function BookOrbitApi:downloadPluginUpdate(local_path, opts)
    opts = opts or {}
    opts.accept = "application/zip"
    return self:download("/koreader/plugin/package", local_path, opts)
end

return BookOrbitApi
