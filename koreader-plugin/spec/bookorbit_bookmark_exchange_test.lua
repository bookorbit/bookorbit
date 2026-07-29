-- The bookmark exchange round trip: full-set upload with chunking, the pull
-- and ack loop, the skip stamp and the error classification the call sites
-- branch on.

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;koreader-plugin/spec/?.lua;" .. package.path

local sidecar_annotations = {}
package.loaded["docsettings"] = {
    open = function()
        return {
            readSetting = function(_, key)
                if key == "annotations" then return sidecar_annotations end
            end,
            saveSetting = function(_, key, value)
                if key == "annotations" then sidecar_annotations = value end
            end,
            makeTrue = function() end,
            flush = function() end,
        }
    end,
    hasSidecarFile = function() return false end,
    findSidecarFile = function() return nil end,
}
package.loaded["ui/event"] = { new = function(_, name, payload) return { name = name, payload = payload } end }
package.loaded["ui/uimanager"] = { setDirty = function() end }
package.loaded["logger"] = { dbg = function() end }
package.loaded["ffi/sha2"] = { md5 = function(value) return value end }
package.loaded["ffi/util"] = { template = function(pattern, a) return (pattern:gsub("%%1", tostring(a))) end }
package.loaded["gettext"] = function(value) return value end
package.loaded["libs/libkoreader-lfs"] = { attributes = function() return nil end }
package.loaded["ui/widget/booklist"] = { setBookInfoCacheProperty = function() end }
package.loaded["bookorbit_capabilities"] = {
    supports = function() return true end,
    markUnsupported = function() end,
}

local BookOrbitBookmarks = require("bookorbit_bookmarks")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)), 2)
    end
end

local function assertTrue(value, label)
    if not value then error(label .. ": expected truthy", 2) end
end

local function makeState(book)
    return {
        getBook = function() return book end,
        setUnmatched = function(self) self.unmatched = true end,
    }
end

local function bookmark(datetime, pos)
    return { datetime = datetime, pos = pos, pageno = 1 }
end

-- Upload: the whole local set goes out, chunked, with the key list only on the
-- first request. A watermark delta would drop renames, because KOReader leaves
-- datetime_updated alone when a dogear note is edited.

local requests = {}
local client = {
    exchangeBookmarks = function(_, books)
        table.insert(requests, books[1])
        return { results = { { hash = "digest", toApply = { add = {}, delete = {} } } }, unmatched = {} }
    end,
    exchangeBookmarksAck = function() return { results = {} } end,
}

local many = {}
for index = 1, 120 do
    table.insert(many, bookmark(string.format("2026-06-01 10:%02d:00", index % 60), "/body/p[" .. index .. "]"))
end

local book = {}
local result = BookOrbitBookmarks.exchangeBook({
    client = client,
    state = makeState(book),
    digest = "digest",
    bookmarks = many,
    bm_signature = "sig-120",
    apply_mode = "sidecar",
    file = "/books/one.epub",
})
assertEqual(result.uploaded, 120, "every bookmark is uploaded")
assertEqual(#requests, 3, "120 bookmarks chunk into three requests")
assertEqual(#requests[1].keys, 120, "the full key set rides the first request")
assertEqual(requests[1].keysComplete, true, "the key set is complete")
assertEqual(#requests[2].keys, 0, "follow-up chunks carry no keys")
assertEqual(requests[2].keysComplete, false, "only the first request may drive deletion detection")
assertEqual(book.bmSignature, "sig-120", "a clean exchange records the skip stamp")

-- An empty local set still exchanges once, so the server can push web bookmarks
-- at a book the device has never bookmarked.
requests = {}
local empty_book = {}
local empty_result = BookOrbitBookmarks.exchangeBook({
    client = client,
    state = makeState(empty_book),
    digest = "digest",
    bookmarks = {},
    bm_signature = "sig-empty",
    apply_mode = "sidecar",
    file = "/books/one.epub",
})
assertEqual(#requests, 1, "an empty set still asks the server")
assertEqual(empty_result.uploaded, 0, "nothing was uploaded")

-- Pull, apply and ack, then a follow-up round while the server reports more.
local rounds = 0
local acks = {}
sidecar_annotations = {}
local pull_client = {
    exchangeBookmarks = function()
        rounds = rounds + 1
        if rounds == 1 then
            return {
                results = { {
                    hash = "digest",
                    toApply = { add = { { serverId = 1, pos = "/body/p[1]", title = "First" } }, delete = {} },
                    more = true,
                } },
            }
        end
        return {
            results = { {
                hash = "digest",
                toApply = { add = { { serverId = 2, pos = "/body/p[2]", title = "Second" } }, delete = {} },
                more = false,
            } },
        }
    end,
    exchangeBookmarksAck = function(_, books)
        table.insert(acks, books[1])
        return { results = {} }
    end,
}

local pull_book = {}
local pull_result = BookOrbitBookmarks.exchangeBook({
    client = pull_client,
    state = makeState(pull_book),
    digest = "digest",
    bookmarks = {},
    bm_signature = "sig-pull",
    apply_mode = "sidecar",
    file = "/books/one.epub",
})
assertEqual(pull_result.applied, 2, "both pushed bookmarks landed")
assertEqual(#acks, 2, "each round is acknowledged before the next pull")
assertEqual(acks[1].applied[1].serverId, 1, "the ack names the server id")
assertEqual(acks[1].applied[1].key ~= nil, true, "the ack carries the device identity")
assertEqual(#sidecar_annotations, 2, "both dogears are in the sidecar")
assertEqual(pull_book.bmSignature, "sig-pull", "a fully drained pull records the skip stamp")

-- Skip mode parks server changes instead of applying them, and must not record
-- the stamp: the next exchange has to come back for them.
local skip_book = {}
local skip_result = BookOrbitBookmarks.exchangeBook({
    client = {
        exchangeBookmarks = function()
            return { results = { { hash = "digest", toApply = { add = { { serverId = 9, pos = "/body/p[9]", title = "Later" } } } } } }
        end,
        exchangeBookmarksAck = function() error("skip mode must not ack") end,
    },
    state = makeState(skip_book),
    digest = "digest",
    bookmarks = {},
    bm_signature = "sig-skip",
    apply_mode = "skip",
})
assertTrue(skip_result.remote_pending, "server changes are parked")
assertEqual(skip_result.remote_pending.to_apply.add[1].serverId, 9, "the parked payload is preserved")
assertEqual(skip_book.bmSignature, nil, "parked changes keep the next exchange mandatory")

-- Error classification the call sites branch on.
local function exchangeWithError(err)
    return select(2, BookOrbitBookmarks.exchangeBook({
        client = {
            exchangeBookmarks = function() return nil, err end,
            exchangeBookmarksAck = function() return { results = {} } end,
        },
        state = makeState({}),
        digest = "digest",
        bookmarks = {},
        bm_signature = "sig-error",
        apply_mode = "sidecar",
        file = "/books/one.epub",
    }))
end
assertEqual(exchangeWithError(401), "auth", "401 is an auth failure")
assertEqual(exchangeWithError(403), "auth", "403 is an auth failure")
assertEqual(exchangeWithError(404), "unsupported_server", "404 downgrades the capability")
assertEqual(exchangeWithError("timeout"), "network", "a transport failure is a network error")

-- An unmatched book stops the exchange and is remembered as unmatched.
local unmatched_state = makeState({})
local unmatched_result, unmatched_err = BookOrbitBookmarks.exchangeBook({
    client = {
        exchangeBookmarks = function() return { results = {}, unmatched = { "digest" } } end,
        exchangeBookmarksAck = function() return { results = {} } end,
    },
    state = unmatched_state,
    digest = "digest",
    bookmarks = {},
    bm_signature = "sig-unmatched",
    apply_mode = "sidecar",
    file = "/books/one.epub",
})
assertEqual(unmatched_result, nil, "an unmatched book produces no result")
assertEqual(unmatched_err, "unmatched", "the caller learns the book is unmatched")
assertTrue(unmatched_state.unmatched, "the unmatched digest is recorded")

-- A 500 mid-upload leaves the stamp unset so the next sync retries.
local failing_book = {}
local flaky_calls = 0
local two_chunks = {}
for index = 1, 60 do
    table.insert(two_chunks, bookmark(string.format("2026-06-01 10:%02d:00", index % 60), "/body/p[" .. index .. "]"))
end
local flaky_result = BookOrbitBookmarks.exchangeBook({
    client = {
        exchangeBookmarks = function()
            flaky_calls = flaky_calls + 1
            if flaky_calls == 1 then
                return { results = { { hash = "digest", toApply = { add = {}, delete = {} } } } }
            end
            return nil, 500
        end,
        exchangeBookmarksAck = function() return { results = {} } end,
    },
    state = makeState(failing_book),
    digest = "digest",
    bookmarks = two_chunks,
    bm_signature = "sig-flaky",
    apply_mode = "sidecar",
    file = "/books/one.epub",
})
assertTrue(flaky_result.had_errors, "a 5xx is reported as an error")
assertEqual(failing_book.bmSignature, nil, "a failed upload does not record the skip stamp")

print("bookorbit_bookmark_exchange_test.lua: ok")
