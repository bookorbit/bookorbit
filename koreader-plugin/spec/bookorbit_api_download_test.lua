-- Proves BookOrbitApi transfers files through a subprocess-capable path that
-- publishes atomically, enforces response bounds and never lets two nested
-- workers own the same request.

local response = {
    code = 200,
    headers = { ["content-type"] = "image/jpeg" },
    chunks = { "JFIF-part-one", "JFIF-part-two" },
    on_chunk = nil,
}
local requests = {}

package.loaded["socket.http"] = {
    request = function(request)
        table.insert(requests, request)
        local active = response
        if response.queue and #response.queue > 0 then
            active = table.remove(response.queue, 1)
        end
        for _, chunk in ipairs(active.chunks or {}) do
            if response.on_chunk then response.on_chunk(chunk) end
            local ok, err = request.sink(chunk)
            if not ok then return nil, err end
        end
        request.sink(nil)
        return 1, active.code, active.headers, active.status or "OK"
    end,
}
package.loaded["ltn12"] = {
    sink = {
        file = function(handle)
            return function(chunk, err)
                if err then return nil, err end
                if not chunk then
                    handle:close()
                    return 1
                end
                if chunk ~= "" then handle:write(chunk) end
                return 1
            end
        end,
        table = function(parts)
            return function(chunk)
                if chunk and chunk ~= "" then table.insert(parts, chunk) end
                return 1
            end
        end,
    },
    source = {
        string = function(value)
            return value
        end,
    },
}
local encoded_subprocess_result
package.loaded["rapidjson"] = {
    null = setmetatable({}, { __tostring = function() return "null" end }),
    encode = function(value)
        if type(value) == "table"
                and (value.body ~= nil or value.err ~= nil or value.errbody ~= nil) then
            encoded_subprocess_result = value
            return "__subprocess_result__"
        end
        return "{}"
    end,
    decode = function(raw)
        if raw == "__subprocess_result__" then return encoded_subprocess_result end
        return { raw = raw }
    end,
}
package.loaded["socket"] = {
    skip = function(count, ...)
        return select(count + 1, ...)
    end,
}
package.loaded["socketutil"] = {
    LARGE_BLOCK_TIMEOUT = 10,
    LARGE_TOTAL_TIMEOUT = 30,
    FILE_BLOCK_TIMEOUT = 15,
    FILE_TOTAL_TIMEOUT = 60,
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
        return tostring(value)
    end,
    removeFile = function(path)
        os.remove(path)
    end,
    partialMD5 = function(path)
        local handle = io.open(path, "rb")
        if not handle then return nil end
        local content = handle:read("*a")
        handle:close()
        return "md5-" .. tostring(#content)
    end,
}

local forks = 0
local wrapped = false
package.loaded["ui/trapper"] = {
    isWrapped = function()
        return wrapped
    end,
    dismissableRunInSubprocess = function(_, task, _, task_returns_simple_string)
        if task_returns_simple_string ~= true then
            error("subprocess result must use the string envelope")
        end
        forks = forks + 1
        return true, task()
    end,
}

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local BookOrbitApi = require("bookorbit_api")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local function readFile(path)
    local handle = io.open(path, "rb")
    if not handle then return nil end
    local content = handle:read("*a")
    handle:close()
    return content
end

local function exists(path)
    local handle = io.open(path, "rb")
    if not handle then return false end
    handle:close()
    return true
end

local temp_root = os.tmpname()
os.remove(temp_root)
assert(os.execute("mkdir -p '" .. temp_root .. "'") == 0)
local final_path = temp_root .. "/cover.jpg"
local temp_path = temp_root .. "/cover.part"

local api = BookOrbitApi.new{
    server_url = "https://books.example.com/api/v1",
    username = "reader",
    userkey = "key",
    background_requests = true,
}

-- A complete response publishes the final file and leaves no temporary behind.
response.on_chunk = function()
    assert(not exists(final_path), "destination must not exist while the transfer is in flight")
end
local ok = api:downloadBlocking("/thumb", final_path, {
    temp_path = temp_path,
    expect_content_type = "image/",
})
response.on_chunk = nil
assertEqual(ok, true, "successful download reports ok")
assertEqual(readFile(final_path), "JFIF-part-oneJFIF-part-two", "published file holds the whole response")
assertEqual(exists(temp_path), false, "temporary file is consumed by the publish")
os.remove(final_path)

-- A server error publishes nothing and cleans up its temporary file.
response.code = 404
local failed, err = api:downloadBlocking("/thumb", final_path, { temp_path = temp_path })
assertEqual(failed, nil, "http error reports failure")
assertEqual(err, 404, "http error surfaces the status code")
assertEqual(exists(final_path), false, "http error publishes no file")
assertEqual(exists(temp_path), false, "http error removes the temporary file")
response.code = 200

-- An oversized body is cut off before it can be published.
local too_large, size_err = api:downloadBlocking("/thumb", final_path, {
    temp_path = temp_path,
    max_bytes = 4,
})
assertEqual(too_large, nil, "oversized response fails")
assertEqual(size_err, "response_too_large", "oversized response reports why")
assertEqual(exists(final_path), false, "oversized response publishes no file")
assertEqual(exists(temp_path), false, "oversized response removes the temporary file")

-- A wrong content type never reaches the cover cache.
response.headers = { ["content-type"] = "text/html" }
local wrong_type, type_err = api:downloadBlocking("/thumb", final_path, {
    temp_path = temp_path,
    expect_content_type = "image/",
})
assertEqual(wrong_type, nil, "unexpected content type fails")
assertEqual(type_err, "unexpected_content_type", "unexpected content type reports why")
assertEqual(exists(final_path), false, "unexpected content type publishes no file")
assertEqual(exists(temp_path), false, "unexpected content type removes the temporary file")
response.headers = { ["content-type"] = "image/jpeg" }

-- Same-origin redirects are followed explicitly without giving LuaSocket a
-- chance to forward credentials to an arbitrary host.
requests = {}
response.queue = {
    {
        code = 302,
        headers = { location = "/api/v1/redirected" },
        chunks = { "redirect body" },
    },
    {
        code = 200,
        headers = { ["content-type"] = "image/jpeg" },
        chunks = { "redirected image" },
    },
}
local redirected = api:downloadBlocking("/thumb", final_path, {
    temp_path = temp_path,
    expect_content_type = "image/",
})
assertEqual(redirected, true, "same-origin redirect succeeds")
assertEqual(#requests, 2, "same-origin redirect performs a bounded second request")
assertEqual(requests[1].redirect, false, "LuaSocket automatic redirects are disabled")
assertEqual(readFile(final_path), "redirected image", "redirect response body is not published")
os.remove(final_path)
response.queue = nil

-- Cross-origin redirects are rejected before credentials reach the target.
requests = {}
response.queue = {
    {
        code = 302,
        headers = { location = "https://attacker.example/cover" },
        chunks = {},
    },
}
local unsafe, redirect_err = api:downloadBlocking("/thumb", final_path, { temp_path = temp_path })
assertEqual(unsafe, nil, "cross-origin redirect fails")
assertEqual(redirect_err, "unsafe_redirect", "cross-origin redirect reports why")
assertEqual(#requests, 1, "cross-origin target is never requested")
assertEqual(exists(final_path), false, "unsafe redirect publishes nothing")
response.queue = nil

-- Outside a Trapper coroutine nothing forks; the call stays blocking.
wrapped = false
forks = 0
assertEqual(api:canForkSubprocess(), false, "no fork without a Trapper coroutine")
api:download("/thumb", final_path, { temp_path = temp_path })
assertEqual(forks, 0, "unwrapped download does not fork")
os.remove(final_path)

-- Inside one, a cover transfer runs in exactly one subprocess.
wrapped = true
forks = 0
assertEqual(api:download("/thumb", final_path, { temp_path = temp_path }), true, "wrapped download succeeds")
assertEqual(forks, 1, "wrapped download forks exactly one worker")
os.remove(final_path)

-- A caller that needs live byte progress cannot use a child, so it stays on
-- the blocking path rather than silently losing its callback.
forks = 0
local progressed = 0
api:download("/thumb", final_path, {
    temp_path = temp_path,
    progress_cb = function(received)
        progressed = received
    end,
})
assertEqual(forks, 0, "progress-reporting download does not fork")
assertEqual(progressed, 26, "progress callback still runs")
os.remove(final_path)

-- A background transfer that publishes progress through a snapshot file keeps
-- its worker: the snapshot, not an in-process callback, is the channel back.
local TransferProgress = require("bookorbit_transfer_progress")
local progress_path = temp_root .. "/cover.progress"
forks = 0
assertEqual(api:download("/thumb", final_path, {
    temp_path = temp_path,
    progress_path = progress_path,
    progress_generation = 7,
    expected_bytes = 26,
}), true, "snapshot-reporting download succeeds")
assertEqual(forks, 1, "snapshot-reporting download still forks a worker")
local snapshot = TransferProgress.read(progress_path, { generation = 7 })
assertEqual(snapshot ~= nil, true, "the child published a progress snapshot")
assertEqual(snapshot.done, true, "completion is published")
assertEqual(snapshot.received, 26, "the snapshot carries the transferred byte count")
assertEqual(TransferProgress.read(progress_path, { generation = 8 }), nil, "another generation ignores the snapshot")
TransferProgress.cleanup(progress_path)
os.remove(final_path)

-- Parent-owned publishing hands the complete temporary file back instead of
-- renaming it, so a cancelled generation cannot be published by a late child.
forks = 0
local handed_back = api:download("/thumb", final_path, {
    temp_path = temp_path,
    publish = "parent",
    hash = "partial_md5",
})
assertEqual(type(handed_back), "table", "parent publishing returns the transfer result")
assertEqual(handed_back.temp_path, temp_path, "the complete temporary file is handed back")
assertEqual(handed_back.bytes, 26, "the transferred byte count is reported")
assertEqual(handed_back.hash, "md5-26", "the child hashes the file it just wrote")
assertEqual(exists(final_path), false, "parent publishing never renames in the child")
assertEqual(exists(temp_path), true, "the temporary file survives for the parent to publish")
os.remove(temp_path)

-- An owned subprocess covers everything inside it: nested requests run inline
-- in the child instead of forking a second worker.
forks = 0
local completed, result = api:runInSubprocess(function()
    api:request("GET", "/koreader/plugin/version")
    api:request("GET", "/koreader/plugin/catalog/dashboard")
    api:download("/thumb", final_path, { temp_path = temp_path })
    return "done"
end)
assertEqual(completed, true, "owned subprocess completes")
assertEqual(result.body, "done", "owned subprocess returns its result")
assertEqual(forks, 1, "one worker owns every call inside the boundary")
assertEqual(api.subprocess_depth, 0, "ownership depth unwinds")
os.remove(final_path)

-- A dismissed request reports cancellation and publishes nothing.
package.loaded["ui/trapper"].dismissableRunInSubprocess = function()
    forks = forks + 1
    return false
end
forks = 0
local cancelled, cancel_err = api:download("/thumb", final_path, { temp_path = temp_path })
assertEqual(cancelled, nil, "dismissed download fails")
assertEqual(cancel_err, "cancelled", "dismissed download reports cancellation")
assertEqual(exists(final_path), false, "dismissed download publishes no file")

os.execute("rm -rf '" .. temp_root .. "'")

print("bookorbit_api_download_test.lua: ok")
