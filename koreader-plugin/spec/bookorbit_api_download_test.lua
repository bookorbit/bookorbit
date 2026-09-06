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
        -- A link that drops mid-body never reaches the sink's end marker and
        -- reports a transport failure instead of a status.
        if active.transport_error then return nil, active.transport_error end
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
local ResumeOrigin = require("bookorbit_resume_origin")

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

local function writeFile(path, content)
    local handle = assert(io.open(path, "wb"))
    handle:write(content)
    handle:close()
end

-- Leaves a partial the way an interrupted attempt does: the bytes, plus the
-- record written before the first of them that says what they are. Bytes
-- without that record are unproven and get discarded, so seeding one without
-- the other would test a state the transfer never produces.
local function writePartial(content, record)
    writeFile(temp_path, content)
    assert(ResumeOrigin.save(temp_path, record or {
        url = "https://books.example.com/api/v1/thumb",
        username = "reader",
        validator = '"1a-2b"',
        total = 26,
    }), "the seeded record must be persistable")
end

-- A link that drops mid-body leaves the bytes it already delivered behind, so
-- the next attempt has something to continue from. The record naming the
-- representation they came from was written before the first of them landed,
-- which is what makes them safe to continue rather than merely present.
requests = {}
response.queue = {
    {
        code = 206,
        headers = { etag = '"1a-2b"', ["content-range"] = "bytes 0-0/26" },
        chunks = { "J" },
    },
    { chunks = { "JFIF-part-one" }, transport_error = "closed" },
}
local dropped, drop_err = api:downloadBlocking("/thumb", final_path, {
    temp_path = temp_path,
    resume = true,
    keep_partial = true,
})
assertEqual(dropped, nil, "a dropped link reports failure")
assertEqual(drop_err, "closed", "the transport error reaches the caller")
assertEqual(exists(final_path), false, "a dropped link publishes nothing")
assertEqual(readFile(temp_path), "JFIF-part-one", "the delivered bytes stay for the next attempt")
assertEqual(exists(ResumeOrigin.path(temp_path)), true, "the record stays with the bytes it vouches for")

-- That next attempt probes the remote file for a validator, hands it back in
-- If-Range and asks only for the remainder.
requests = {}
response.queue = {
    {
        code = 206,
        headers = { etag = '"1a-2b"', ["content-range"] = "bytes 0-0/26" },
        chunks = { "J" },
    },
    {
        code = 206,
        headers = { ["content-type"] = "image/jpeg", ["content-range"] = "bytes 13-25/26" },
        chunks = { "JFIF-part-two" },
    },
}
local continued = api:downloadBlocking("/thumb", final_path, {
    temp_path = temp_path,
    publish = "parent",
    resume = true,
    keep_partial = true,
    expect_content_type = "image/",
})
assertEqual(#requests, 2, "resuming probes once and then asks for the remainder")
assertEqual(requests[1].headers["range"], "bytes=0-0", "the probe reads a single byte")
assertEqual(requests[2].headers["range"], "bytes=13-", "the transfer continues at the first missing byte")
assertEqual(requests[2].headers["if-range"], '"1a-2b"', "the probed validator authorizes the resume")
assertEqual(type(continued), "table", "a resumed transfer returns its result")
assertEqual(continued.bytes, 26, "the byte count covers the whole file, not just this attempt")
assertEqual(continued.resumed, 13, "the result reports how much was already on disk")
assertEqual(readFile(temp_path), "JFIF-part-oneJFIF-part-two", "the remainder is appended to the bytes on disk")
assertEqual(exists(ResumeOrigin.path(temp_path)), false, "a completed transfer takes its record with it")
os.remove(temp_path)

-- The file the bytes came from changed while the transfer was interrupted. The
-- probe reports the new representation, so If-Range would match it trivially
-- and splice new bytes onto old ones. Only the record written before the old
-- bytes landed can tell them apart, and it does.
requests = {}
writePartial("OLD-part-one", {
    url = "https://books.example.com/api/v1/thumb",
    username = "reader",
    validator = '"aa-bb"',
    total = 26,
})
-- The server here honors the stale offset rather than refusing it, which is
-- what makes this a corruption and not a wasted request: the old prefix and the
-- new remainder add up to the advertised length and publish as complete.
response.queue = {
    {
        code = 206,
        headers = { etag = '"1a-2b"', ["content-range"] = "bytes 0-0/26" },
        chunks = { "J" },
    },
    {
        code = 206,
        headers = { ["content-range"] = "bytes 12-25/26" },
        chunks = { "NEW-remainder!" },
    },
}
local rewritten = api:downloadBlocking("/thumb", final_path, {
    temp_path = temp_path,
    publish = "parent",
    resume = true,
    keep_partial = true,
})
assertEqual(#requests, 2, "a changed representation still runs the transfer")
assertEqual(requests[2].headers["range"], nil, "bytes from another representation are never continued")
assertEqual(rewritten.resumed, 0, "a changed representation continues nothing")
assertEqual(readFile(temp_path), "NEW-remainder!", "the old prefix is gone rather than spliced onto")
os.remove(temp_path)

-- Same file, same length, same validator, but recorded against another server
-- or account. Resume keys are derived from the file id alone, so without the
-- origin check this would continue into a stranger's partial.
requests = {}
writePartial("JFIF-part-one", {
    url = "https://other.example.com/api/v1/thumb",
    username = "reader",
    validator = '"1a-2b"',
    total = 26,
})
response.queue = {
    {
        code = 206,
        headers = { etag = '"1a-2b"', ["content-range"] = "bytes 0-0/26" },
        chunks = { "J" },
    },
}
local foreign = api:downloadBlocking("/thumb", final_path, {
    temp_path = temp_path,
    publish = "parent",
    resume = true,
    keep_partial = true,
})
assertEqual(requests[2].headers["range"], nil, "a partial recorded elsewhere is never continued")
assertEqual(foreign.resumed, 0, "a foreign origin continues nothing")
os.remove(temp_path)

-- Bytes nobody vouched for are the pre-upgrade case and the corrupted-sidecar
-- case at once. They are discarded rather than trusted.
requests = {}
writeFile(temp_path, "JFIF-part-one")
response.queue = {
    {
        code = 206,
        headers = { etag = '"1a-2b"', ["content-range"] = "bytes 0-0/26" },
        chunks = { "J" },
    },
}
local unproven = api:downloadBlocking("/thumb", final_path, {
    temp_path = temp_path,
    publish = "parent",
    resume = true,
    keep_partial = true,
})
assertEqual(requests[2].headers["range"], nil, "an unrecorded partial is never continued")
assertEqual(unproven.resumed, 0, "an unrecorded partial continues nothing")
assertEqual(readFile(temp_path), "JFIF-part-oneJFIF-part-two", "the unproven bytes are replaced")
os.remove(temp_path)

-- A server that refuses If-Range answers with the whole file. The bytes on disk
-- describe a representation it no longer serves, so they are dropped and the
-- transfer starts over rather than appending to them.
requests = {}
writePartial("stale-content")
response.queue = {
    {
        code = 206,
        headers = { etag = '"1a-2b"', ["content-range"] = "bytes 0-0/26" },
        chunks = { "J" },
    },
    {
        code = 200,
        headers = { ["content-type"] = "image/jpeg" },
        chunks = { "JFIF-part-one", "JFIF-part-two" },
    },
}
local restarted = api:downloadBlocking("/thumb", final_path, {
    temp_path = temp_path,
    publish = "parent",
    resume = true,
})
assertEqual(#requests, 3, "a refused If-Range starts the transfer over")
assertEqual(requests[3].headers["range"], nil, "the restarted request asks for the whole file")
assertEqual(restarted.bytes, 26, "the restarted transfer reports only its own bytes")
assertEqual(restarted.resumed, 0, "a restarted transfer continued nothing")
assertEqual(readFile(temp_path), "JFIF-part-oneJFIF-part-two", "the stale bytes are gone")

-- A file that shrank below the offset answers 416, which is the same verdict.
requests = {}
writePartial("stale-content")
response.queue = {
    {
        code = 206,
        headers = { etag = '"1a-2b"', ["content-range"] = "bytes 0-0/26" },
        chunks = { "J" },
    },
    { code = 416, headers = {}, chunks = {} },
}
local unsatisfiable = api:downloadBlocking("/thumb", final_path, {
    temp_path = temp_path,
    publish = "parent",
    resume = true,
})
assertEqual(#requests, 3, "an unsatisfiable range starts the transfer over")
assertEqual(unsatisfiable.bytes, 26, "the restarted transfer completes")
assertEqual(readFile(temp_path), "JFIF-part-oneJFIF-part-two", "the stale bytes are gone")

-- An intermediary that rewrites the range answers 206 somewhere other than the
-- offset that was asked for. Appending that to the bytes on disk would corrupt
-- the file, so it counts as a refusal too.
requests = {}
writePartial("stale-content")
response.queue = {
    {
        code = 206,
        headers = { etag = '"1a-2b"', ["content-range"] = "bytes 0-0/26" },
        chunks = { "J" },
    },
    {
        code = 206,
        headers = { ["content-range"] = "bytes 0-25/26" },
        chunks = { "JFIF-part-oneJFIF-part-two" },
    },
}
local misaligned = api:downloadBlocking("/thumb", final_path, {
    temp_path = temp_path,
    publish = "parent",
    resume = true,
})
assertEqual(#requests, 3, "a range that starts elsewhere starts the transfer over")
assertEqual(misaligned.resumed, 0, "a misaligned range is never appended to")
assertEqual(readFile(temp_path), "JFIF-part-oneJFIF-part-two", "the file is transferred in full")

-- A server that ignores the range starts sending the whole file. The probe
-- wants headers, not bytes, so it is cut off instead of buffering a book.
requests = {}
writePartial("JFIF-part-one")
response.queue = {
    {
        code = 200,
        headers = { ["content-type"] = "image/jpeg" },
        chunks = { string.rep("x", 4096) },
    },
}
local ignored = api:downloadBlocking("/thumb", final_path, {
    temp_path = temp_path,
    publish = "parent",
    resume = true,
})
assertEqual(#requests, 2, "a server that ignores the range authorizes no resume")
assertEqual(requests[2].headers["range"], nil, "the transfer falls back to the whole file")
assertEqual(ignored.resumed, 0, "nothing is continued against a server that ignores ranges")
assertEqual(readFile(temp_path), "JFIF-part-oneJFIF-part-two", "the file is transferred in full")

-- Only a strong validator proves the bytes below the offset are still current,
-- so a weak one sends the transfer back to byte zero.
requests = {}
writePartial("JFIF-part-one")
response.queue = {
    {
        code = 206,
        headers = { etag = 'W/"1a-2b"', ["content-range"] = "bytes 0-0/26" },
        chunks = { "J" },
    },
}
local weak = api:downloadBlocking("/thumb", final_path, {
    temp_path = temp_path,
    publish = "parent",
    resume = true,
})
assertEqual(#requests, 2, "a weak validator still costs the probe")
assertEqual(requests[2].headers["range"], nil, "a weak validator authorizes no resume")
assertEqual(weak.resumed, 0, "a weak validator continues nothing")
assertEqual(readFile(temp_path), "JFIF-part-oneJFIF-part-two", "the file is transferred in full")
os.remove(temp_path)

-- Nothing on disk means nothing to continue, but the probe still runs: its
-- answer is the record this attempt writes before its first byte, and without
-- one the bytes it leaves behind could never be resumed.
requests = {}
response.queue = {
    {
        code = 206,
        headers = { etag = '"1a-2b"', ["content-range"] = "bytes 0-0/26" },
        chunks = { "J" },
    },
}
local fresh = api:downloadBlocking("/thumb", final_path, {
    temp_path = temp_path,
    publish = "parent",
    resume = true,
})
assertEqual(#requests, 2, "a first attempt is probed so it can record its origin")
assertEqual(requests[2].headers["range"], nil, "a first attempt asks for the whole file")
assertEqual(fresh.resumed, 0, "a first attempt continued nothing")
assertEqual(exists(ResumeOrigin.path(temp_path)), false, "a complete transfer leaves no record behind")
os.remove(temp_path)

-- A link that drops during the probe says nothing about the bytes on disk. It
-- must not cost them: the attempt gives up while they are still there, and the
-- error is retryable so the caller comes back for them.
requests = {}
writePartial("JFIF-part-one")
response.queue = { { chunks = {}, transport_error = "closed" } }
local probe_dropped, probe_err = api:downloadBlocking("/thumb", final_path, {
    temp_path = temp_path,
    publish = "parent",
    resume = true,
    keep_partial = true,
})
assertEqual(probe_dropped, nil, "a probe that loses the link reports failure")
assertEqual(probe_err, "probe_failed", "the caller is told the probe failed, not the transfer")
assertEqual(#requests, 1, "a failed probe never starts the transfer")
assertEqual(readFile(temp_path), "JFIF-part-one", "a failed probe leaves the saved partial alone")
assertEqual(exists(ResumeOrigin.path(temp_path)), true, "a failed probe leaves the record that proves them")

-- A server that answers and cannot support the resume is a settled verdict, so
-- the transfer proceeds from zero rather than reporting a retryable failure.
requests = {}
response.queue = {
    { code = 404, headers = {}, chunks = {} },
    { code = 200, headers = { ["content-type"] = "image/jpeg" }, chunks = { "JFIF-part-one", "JFIF-part-two" } },
}
local unsupported = api:downloadBlocking("/thumb", final_path, {
    temp_path = temp_path,
    publish = "parent",
    resume = true,
    keep_partial = true,
})
assertEqual(#requests, 2, "a settled probe answer still runs the transfer")
assertEqual(requests[2].headers["range"], nil, "a probe the server refused authorizes no resume")
assertEqual(unsupported.resumed, 0, "nothing is continued when the probe was refused")
os.remove(temp_path)

-- A temporary file that opens but refuses to seek would append at byte zero
-- while still counting from the offset, publishing a corrupt file as complete.
-- The transfer restarts instead.
requests = {}
writePartial("JFIF-part-one")
local real_open = io.open
io.open = function(path, mode)
    local handle = real_open(path, mode)
    if not handle or path ~= temp_path or mode ~= "r+b" then return handle end
    -- A file handle is userdata and takes no stubbed field, so the refusal is
    -- staged on a proxy that forwards everything else to the real handle.
    return {
        seek = function() return nil, "seek_failed" end,
        write = function(_, ...) return handle:write(...) end,
        close = function() return handle:close() end,
    }
end
response.queue = {
    {
        code = 206,
        headers = { etag = '"1a-2b"', ["content-range"] = "bytes 0-0/26" },
        chunks = { "J" },
    },
    {
        code = 200,
        headers = { ["content-type"] = "image/jpeg" },
        chunks = { "JFIF-part-one", "JFIF-part-two" },
    },
}
local unseekable = api:downloadBlocking("/thumb", final_path, {
    temp_path = temp_path,
    publish = "parent",
    resume = true,
    keep_partial = true,
})
io.open = real_open
assertEqual(requests[2].headers["range"], nil, "a failed seek restarts the transfer from zero")
assertEqual(unseekable.resumed, 0, "a failed seek continues nothing")
assertEqual(unseekable.bytes, 26, "the restarted transfer counts only its own bytes")
assertEqual(readFile(temp_path), "JFIF-part-oneJFIF-part-two", "the restarted body replaces the partial")
os.remove(temp_path)

-- Without keep_partial a dropped link leaves nothing behind, which is what a
-- non-resumable caller expects.
requests = {}
response.queue = { { chunks = { "JFIF-part-one" }, transport_error = "closed" } }
local discarded = api:downloadBlocking("/thumb", final_path, { temp_path = temp_path })
assertEqual(discarded, nil, "a dropped link reports failure")
assertEqual(exists(temp_path), false, "a non-resumable transfer removes its temporary file")
response.queue = nil

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
