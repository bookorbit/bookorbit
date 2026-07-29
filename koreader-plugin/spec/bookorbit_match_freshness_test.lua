-- Phase 4 fast path: a known book may answer its match check from local state
-- only inside a bounded age, and only while the library-version token it was
-- verified against is still the one the plugin knows.

package.loaded["datastorage"] = {
    getSettingsDir = function() return "/nonexistent" end,
}
package.loaded["dump"] = function() return "{}" end
package.loaded["ffi/util"] = {
    fsyncOpenedFile = function() end,
    fsyncDirectory = function() end,
}
package.loaded["libs/libkoreader-lfs"] = {
    attributes = function() return nil end,
}
package.loaded["luasettings"] = {
    open = function() error("this test must not touch the settings file") end,
}

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local BookOrbitState = require("bookorbit_state")
local MAX_AGE = BookOrbitState.MATCH_MAX_AGE

local function newState(global)
    return BookOrbitState.snapshot({ global = global or {} })
end

local function read(path)
    local file = assert(io.open(path, "rb"))
    local content = file:read("*a")
    file:close()
    return content
end

-- A fresh match is stamped with the time and the token it was verified against.
local state = newState({ libraryVersion = "lib-v1" })
state:setMatched("abc123", 11, 7, "/books/a.epub")
local book = state:getBook("abc123")
assert(type(book.matchVerifiedAt) == "number", "a match records when it was verified")
assert(book.matchVerifiedVersion == "lib-v1", "a match records the token it was verified against")

local now = book.matchVerifiedAt
assert(BookOrbitState.isMatchFresh(book, state.global, now) == true,
    "a just-verified match needs no request")
assert(BookOrbitState.isMatchFresh(book, state.global, now + MAX_AGE) == true,
    "the bound is inclusive at its edge")
assert(BookOrbitState.isMatchFresh(book, state.global, now + MAX_AGE + 1) == false,
    "an expired match rechecks even though nothing changed and no new token arrived")
assert(BookOrbitState.isMatchFresh(book, state.global, now - 60) == false,
    "a stamp in the device's future is treated as expired")

-- State written before the stamp existed must recheck once, not be trusted.
local legacy = newState({ libraryVersion = "lib-v1" })
legacy.books["legacy1"] = { bookId = 3, fileId = 4, file = "/books/legacy.epub" }
assert(BookOrbitState.isMatchFresh(legacy:getBook("legacy1"), legacy.global) == false,
    "a match carrying no stamp is expired, not fresh")

-- The global recheck flag alone must not force a request on every book: a book
-- verified against the current token stays on the fast path.
local recheck = newState({ libraryVersion = "lib-v1" })
recheck:setMatched("current", 1, 1, "/books/current.epub")
recheck:setMatched("stale", 2, 2, "/books/stale.epub", "lib-v0")
recheck.global.needsFullRecheck = true
assert(BookOrbitState.isMatchFresh(recheck:getBook("current"), recheck.global) == true,
    "a book verified against the current token stays fast while a recheck is pending")
assert(BookOrbitState.isMatchFresh(recheck:getBook("stale"), recheck.global) == false,
    "a book verified against an older token rechecks")

local untokened = newState({})
untokened:setMatched("notoken", 5, 5, "/books/notoken.epub")
untokened.global.needsFullRecheck = true
assert(BookOrbitState.isMatchFresh(untokened:getBook("notoken"), untokened.global) == false,
    "without a known token a pending recheck cannot be answered locally")

-- An explicit rematch must not be answered from the stamp.
local retry = newState({ libraryVersion = "lib-v1" })
retry:setMatched("retryme", 6, 6, "/books/retry.epub")
BookOrbitState.expireMatch(retry:getBook("retryme"))
assert(BookOrbitState.isMatchFresh(retry:getBook("retryme"), retry.global) == false,
    "an explicitly expired match rechecks")

-- One invalidation path for the token, whatever response carried it.
local tokens = newState({})
assert(BookOrbitState.applyLibraryVersion(tokens, "lib-v1", 1000) == false,
    "the first observed token is not a change")
assert(tokens.global.libraryVersion == "lib-v1")
assert(tokens.global.libraryVersionCheckedAt == 1000,
    "the observation time is persisted separately from per-book freshness")
assert(tokens.global.needsFullRecheck ~= true, "a first observation marks nothing for recheck")
assert(BookOrbitState.applyLibraryVersion(tokens, "lib-v1", 2000) == false,
    "an unchanged token is not a change")
assert(tokens.global.libraryVersionCheckedAt == 2000)
assert(BookOrbitState.applyLibraryVersion(tokens, "lib-v2", 3000) == true,
    "a changed token is reported as a change")
assert(tokens.global.needsFullRecheck == true,
    "a changed token immediately marks local matches for recheck")
assert(BookOrbitState.applyLibraryVersion(tokens, "", 4000) == false,
    "an empty token is ignored")
assert(tokens.global.libraryVersion == "lib-v2")

local plugin_dir = "koreader-plugin/bookorbit.koplugin/"
local book_sync = read(plugin_dir .. "bookorbit_book_sync.lua")
local main = read(plugin_dir .. "main.lua")

local step_match = assert(book_sync:match("stepMatch = function%(ctx%)%s*(.-)%s*stepStats = function"))
local fresh_at = assert(step_match:find("BookOrbitState.isMatchFresh", 1, true),
    "the drained lifecycle sync must consult match freshness")
assert(fresh_at < assert(step_match:find("client:matchCheck", 1, true)),
    "freshness is decided before the request is made")
local apply_at = assert(step_match:find("BookOrbitState.applyLibraryVersion", 1, true))
assert(apply_at < assert(step_match:find("setMatched", 1, true)),
    "the response token is applied before the match is stamped against it")

local open_match = assert(main:match(
    "function BookOrbit:matchOpenBookForAutoSync%(on_done%)%s*(.-)%s*\n-- Two%-way annotation"))
assert(open_match:find("BookOrbitState.isMatchFresh", 1, true),
    "the open-book match path honors the same age bound")
assert(not open_match:find("if state:getBook(digest) then", 1, true),
    "any local match must no longer end the open-book path unconditionally")

local retry_match = assert(main:match(
    "function BookOrbit:retryOpenBookMatch%(%)%s*(.-)%s*function BookOrbit:submitSyncJob"))
assert(retry_match:find("BookOrbitState.expireMatch", 1, true),
    "an explicit rematch expires the stored freshness stamp")

print("bookorbit_match_freshness_test.lua: ok")
