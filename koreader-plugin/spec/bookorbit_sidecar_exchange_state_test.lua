-- A re-downloaded book gets a new, empty sidecar. Its first exchange used to send
-- that empty list as a complete key set, and the server deleted every highlight
-- and dogear the device had. The sidecar now carries a marker once it has been
-- through an exchange, and an unmarked empty one is reported as "new".

local settings_store = {}
local flushed = 0
local function fakeSettings(path)
    settings_store[path] = settings_store[path] or {}
    local values = settings_store[path]
    return {
        readSetting = function(_, key) return values[key] end,
        saveSetting = function(_, key, value) values[key] = value end,
        makeTrue = function(_, key) values[key] = true end,
        flush = function() flushed = flushed + 1 end,
    }
end

package.loaded["docsettings"] = {
    open = function(_, file) return fakeSettings(file) end,
    hasSidecarFile = function(_, file) return settings_store[file] ~= nil end,
    findSidecarFile = function() return nil end,
}
package.loaded["ui/widget/booklist"] = { setBookInfoCacheProperty = function() end }
package.loaded["ui/event"] = { new = function(_, name, payload) return { name = name, payload = payload } end }
package.loaded["ui/uimanager"] = { setDirty = function() end }
package.loaded["logger"] = { dbg = function() end }
package.loaded["ffi/sha2"] = { md5 = function(value) return value end }
package.loaded["ffi/util"] = { template = function(text) return text end }
package.loaded["gettext"] = function(value) return value end
package.loaded["util"] = {
    trim = function(value) return tostring(value or ""):match("^%s*(.-)%s*$") end,
}
package.loaded["libs/libkoreader-lfs"] = {
    attributes = function(path, attr)
        if attr == "mode" and path == "/books/on-device.epub" then return "file" end
        return nil
    end,
}

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local BookOrbitAnnotations = require("bookorbit_annotations")
local BookOrbitBookmarks = require("bookorbit_bookmarks")
local BookOrbitCapabilities = require("bookorbit_capabilities")
local BookOrbitSidecar = require("bookorbit_sidecar")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

-- The rule itself.
assertEqual(BookOrbitSidecar.sidecarState(true, 0), "known", "a marked sidecar is known even when empty")
assertEqual(BookOrbitSidecar.sidecarState(true, 7), "known", "a marked sidecar with entries is known")
assertEqual(BookOrbitSidecar.sidecarState(false, 0), "new", "an unmarked empty sidecar is new")
assertEqual(BookOrbitSidecar.sidecarState(false, 3), nil, "an unmarked sidecar with entries is left to the server")
assertEqual(BookOrbitSidecar.sidecarState(nil, 0), nil, "an unreadable sidecar says nothing")

-- Marker helpers.
assertEqual(BookOrbitSidecar.readMarked("/books/missing.epub"), false, "a book without a sidecar is unmarked")
local live = fakeSettings("/books/open.epub")
assertEqual(BookOrbitSidecar.isMarked(live), false, "a fresh sidecar is unmarked")
assertEqual(BookOrbitSidecar.markLive(live, 1000), true, "the open book is marked")
assertEqual(BookOrbitSidecar.isMarked(live), true, "the mark is read back")
assertEqual(BookOrbitSidecar.markLive(live, 2000), false, "an existing mark is left alone")
assertEqual(live:readSetting(BookOrbitSidecar.EXCHANGE_MARKER), 1000, "the first mark's time is kept")
assertEqual(BookOrbitSidecar.markFile("/books/not-on-device.epub", 1000), false, "a book file that is gone is not marked")
local before_flush = flushed
assertEqual(BookOrbitSidecar.markFile("/books/on-device.epub", 1000), true, "a closed book's sidecar is marked")
assertEqual(flushed, before_flush + 1, "a closed sidecar is written to disk")
assertEqual(BookOrbitSidecar.readMarked("/books/on-device.epub"), true, "the closed mark is read back")

local function client(capabilities, sent)
    return {
        server_url = "http://server",
        username = "reader",
        getPluginVersion = function() return { capabilities = capabilities } end,
        exchangeAnnotations = function(_, books)
            table.insert(sent, books[1])
            return { results = { { toApply = {}, more = false } } }
        end,
        exchangeBookmarks = function(_, books)
            table.insert(sent, books[1])
            return { results = { { toApply = {}, more = false } } }
        end,
    }
end

local function exchangeHighlights(capabilities, sidecar_state, annotations)
    BookOrbitCapabilities.reset()
    local sent = {}
    BookOrbitAnnotations.exchangeBook({
        client = client(capabilities, sent),
        state = { getBook = function() return {} end, setUnmatched = function() end },
        digest = "abc123",
        annotations = annotations or {},
        sidecar_state = sidecar_state,
        apply_mode = "sidecar",
        file = "/books/on-device.epub",
    })
    return sent
end

-- A server that knows the field gets it, with the complete key set.
local sent = exchangeHighlights({ "sidecarState" }, "new")
assertEqual(sent[1].sidecarState, "new", "a new sidecar is reported")
assertEqual(sent[1].keysComplete, true, "the key set stays complete for a server that reads the state")

sent = exchangeHighlights({ "sidecarState" }, "known")
assertEqual(sent[1].sidecarState, "known", "a known sidecar is reported")

sent = exchangeHighlights({ "sidecarState" }, nil)
assertEqual(sent[1].sidecarState, nil, "an undecided sidecar sends no state")
assertEqual(sent[1].keysComplete, true, "an undecided sidecar keeps today's complete key set")

-- An older server rejects unknown fields and would read the empty set as deletions.
sent = exchangeHighlights({}, "new")
assertEqual(sent[1].sidecarState, nil, "an older server never gets the field")
assertEqual(sent[1].keysComplete, false, "a new sidecar's keys go to an older server as incomplete")
assertEqual(#sent[1].keys, 0, "no keys go out when the set is marked incomplete")

sent = exchangeHighlights({}, "known")
assertEqual(sent[1].sidecarState, nil, "an older server never gets a known state either")
assertEqual(sent[1].keysComplete, true, "a known sidecar keeps its complete key set on an older server")

-- Follow-up requests carry nothing that could delete.
local followups = {}
BookOrbitCapabilities.reset()
local paged_client = client({ "sidecarState" }, followups)
local responses = {
    { results = { { toApply = { add = { { serverId = 1, version = 1 } } }, more = true } } },
    { results = { { toApply = {}, more = false } } },
}
paged_client.exchangeAnnotations = function(_, books)
    table.insert(followups, books[1])
    return table.remove(responses, 1)
end
paged_client.exchangeAck = function() return { results = {} } end
BookOrbitAnnotations.exchangeBook({
    client = paged_client,
    state = { getBook = function() return {} end, setUnmatched = function() end },
    digest = "abc123",
    annotations = {},
    sidecar_state = "new",
    apply_mode = "sidecar",
    file = "/books/on-device.epub",
})
assertEqual(#followups, 2, "the paged pull asked again")
assertEqual(followups[1].sidecarState, "new", "the first request carries the state")
assertEqual(followups[2].sidecarState, nil, "a follow-up pull carries no state")
assertEqual(followups[2].keysComplete, false, "a follow-up pull never claims a complete key set")

-- Dogears follow the same rules.
local function exchangeDogears(capabilities, sidecar_state)
    BookOrbitCapabilities.reset()
    local dogear_sent = {}
    BookOrbitBookmarks.exchangeBook({
        client = client(capabilities, dogear_sent),
        state = { getBook = function() return {} end, setUnmatched = function() end },
        digest = "abc123",
        bookmarks = {},
        sidecar_state = sidecar_state,
        apply_mode = "sidecar",
        file = "/books/on-device.epub",
    })
    return dogear_sent
end

sent = exchangeDogears({ "sidecarState", "bookmarkSync" }, "new")
assertEqual(sent[1].sidecarState, "new", "a new sidecar's dogears are reported as new")
sent = exchangeDogears({ "bookmarkSync" }, "new")
assertEqual(sent[1].sidecarState, nil, "an older server gets no dogear state")
assertEqual(sent[1].keysComplete, false, "a new sidecar's dogear keys go to an older server as incomplete")

print("bookorbit_sidecar_exchange_state_test: ok")
