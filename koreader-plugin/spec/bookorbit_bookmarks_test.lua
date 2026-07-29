-- Dogear sync: normalization, skip logic, live apply, sidecar apply,
-- deletion detection and the ack identity the server links devices by.

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;koreader-plugin/spec/?.lua;" .. package.path

local sidecar_store
local sidecar_flags
package.loaded["docsettings"] = {
    open = function()
        return {
            readSetting = function(_, key)
                if key == "annotations" then return sidecar_store end
            end,
            saveSetting = function(_, key, value)
                if key == "annotations" then sidecar_store = value end
            end,
            makeTrue = function(_, key) sidecar_flags[key] = true end,
            flush = function() sidecar_flags.flushed = true end,
        }
    end,
    hasSidecarFile = function() return false end,
    findSidecarFile = function() return nil end,
}

local handled_events = {}
package.loaded["ui/event"] = {
    new = function(_, name, payload)
        return { name = name, payload = payload }
    end,
}

local dirty_calls = 0
package.loaded["ui/uimanager"] = {
    setDirty = function() dirty_calls = dirty_calls + 1 end,
}

package.loaded["logger"] = { dbg = function() end }

-- Identity md5 is replaced by the input itself so assertions stay readable.
package.loaded["ffi/sha2"] = { md5 = function(value) return value end }
package.loaded["ffi/util"] = {
    template = function(pattern, a) return (pattern:gsub("%%1", tostring(a))) end,
}
package.loaded["gettext"] = function(value) return value end

package.loaded["libs/libkoreader-lfs"] = { attributes = function() return nil end }
package.loaded["ui/widget/booklist"] = { setBookInfoCacheProperty = function() end }

local capability_answer = true
local marked_unsupported = false
package.loaded["bookorbit_capabilities"] = {
    supports = function(_, feature)
        if feature ~= "bookmarkSync" then return false end
        return capability_answer
    end,
    markUnsupported = function() marked_unsupported = true end,
}

local BookOrbitSidecar = require("bookorbit_sidecar")
local BookOrbitBookmarks = require("bookorbit_bookmarks")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)), 2)
    end
end

local function assertTrue(value, label)
    if not value then error(label .. ": expected truthy", 2) end
end

-- normalizeBookmarks

local raw = {
    { page = "/body/DocFragment[2]/body/p[1]/text().0", datetime = "2026-06-01 10:00:00", chapter = "One", pageno = 4 },
    { page = "/body/DocFragment[3]", datetime = "2026-06-02 11:00:00", note = "Look", pageno = 9 },
    -- A highlight: has a drawer, belongs to the annotation exchange.
    { page = "/body/DocFragment[4]", pos0 = "/body/DocFragment[4]", drawer = "lighten", datetime = "2026-06-03 12:00:00" },
    -- A paging document dogear: the position is a page number, out of scope.
    { page = 12, datetime = "2026-06-04 13:00:00" },
    -- Unusable datetime.
    { page = "/body/DocFragment[5]", datetime = "nonsense" },
}

local bookmarks, max_datetime, signature = BookOrbitSidecar.normalizeBookmarks(raw)
assertEqual(#bookmarks, 2, "only rolling dogears are normalized")
assertEqual(bookmarks[1].pos, "/body/DocFragment[2]/body/p[1]/text().0", "position comes from page")
assertEqual(bookmarks[1].chapter, "One", "chapter is carried")
assertEqual(bookmarks[1].pageno, 4, "pageno is carried")
assertEqual(bookmarks[2].note, "Look", "note is carried")
assertEqual(max_datetime, "2026-06-02 11:00:00", "max datetime ignores highlights")

local renamed = {
    { page = "/body/DocFragment[2]/body/p[1]/text().0", datetime = "2026-06-01 10:00:00", chapter = "One", pageno = 4 },
    { page = "/body/DocFragment[3]", datetime = "2026-06-02 11:00:00", note = "Renamed", pageno = 9 },
}
local _renamed, _renamed_max, renamed_signature = BookOrbitSidecar.normalizeBookmarks(renamed)
assertTrue(renamed_signature ~= signature,
    "a note edit changes the signature even though KOReader leaves datetime_updated alone")

-- The highlight signature must not move, or every book re-exchanges after an update.
local annotations_before = select(3, BookOrbitSidecar.normalizeAnnotations(raw))
local annotations_after = select(3, BookOrbitSidecar.normalizeAnnotations(raw))
assertEqual(annotations_before, annotations_after, "highlight signature is stable")

-- keys and skip logic

local keys = BookOrbitBookmarks.collectKeys(bookmarks)
assertEqual(#keys, 2, "one key per bookmark")
assertEqual(keys[1].k, "2026-06-01 10:00:00|/body/DocFragment[2]/body/p[1]/text().0", "key is datetime|pos")
assertEqual(keys[1].dt, "2026-06-01 10:00:00", "key carries its datetime")

local book = {}
assertEqual(BookOrbitBookmarks.canSkipExchange(book, signature, 1000), false, "never exchanged, cannot skip")
BookOrbitBookmarks.rememberExchanged(book, signature, 1000)
assertEqual(BookOrbitBookmarks.canSkipExchange(book, signature, 1100), true, "unchanged set may skip")
assertEqual(BookOrbitBookmarks.canSkipExchange(book, renamed_signature, 1100), false, "changed set may not skip")
assertEqual(BookOrbitBookmarks.canSkipExchange(book, signature, 1000 + BookOrbitBookmarks.EXCHANGE_MAX_AGE + 1), false,
    "a stale stamp may not skip")
assertEqual(BookOrbitBookmarks.canSkipExchange(book, signature, 500), false, "a stamp in the future may not skip")

-- capability gate

assertEqual(BookOrbitBookmarks.enabled({}, false), false, "the two-way toggle gates bookmark sync")
assertEqual(BookOrbitBookmarks.enabled({}, true), true, "an advertising server enables bookmark sync")
capability_answer = false
assertEqual(BookOrbitBookmarks.enabled({}, true), false, "a server without the capability stays dormant")
capability_answer = true
BookOrbitBookmarks.markUnsupported({})
assertTrue(marked_unsupported, "a confirmed 404 downgrades the capability")

-- live apply

local resolvable = {}
local annotations = {}
local added_items = {}
local removed_indexes = {}
local ui = {
    document = {
        isXPointerInDocument = function(_, pos) return resolvable[pos] == true end,
    },
    annotation = {
        annotations = annotations,
        addItem = function(self, item)
            item.datetime = item.datetime or "2026-07-01 09:00:00"
            table.insert(self.annotations, item)
            table.insert(added_items, item)
            return #self.annotations
        end,
    },
    bookmark = {
        getCurrentPageNumber = function() return "/body/DocFragment[1]" end,
        setDogearVisibility = function() end,
        removeItemByIndex = function(_, index)
            table.insert(removed_indexes, index)
            table.remove(annotations, index)
        end,
    },
    toc = {
        getTocTitleByPage = function(_, pos)
            if pos == "/body/DocFragment[7]" then return "Chapter Seven" end
            return ""
        end,
    },
    handleEvent = function(_, event) table.insert(handled_events, event) end,
}

resolvable["/body/DocFragment[7]"] = true
resolvable["/body/DocFragment[8]"] = true

local applied, deleted, touched, deleted_touched = BookOrbitBookmarks.applyLive(ui, {
    add = {
        { serverId = 1, pos = "/body/DocFragment[7]", title = "Chapter Seven" },
        { serverId = 2, pos = "/body/DocFragment[8]", title = "My own label" },
        { serverId = 3, pos = "/body/DocFragment[9]", title = "Broken" },
    },
})
assertEqual(touched, 2, "two resolvable positions were added")
assertEqual(deleted_touched, 0, "nothing was deleted")
assertEqual(#deleted, 0, "no delete acks")
assertEqual(applied[1].status, "applied", "resolvable entry applied")
assertEqual(applied[1].key, "2026-07-01 09:00:00|/body/DocFragment[7]", "ack carries the device identity")
assertEqual(applied[1].pos, "/body/DocFragment[7]", "ack carries the device position")
assertEqual(added_items[1].chapter, "Chapter Seven", "the device fills the chapter from its own toc")
assertEqual(added_items[1].note, nil, "a title matching the chapter needs no note")
assertEqual(added_items[2].note, "My own label", "a title that is not the chapter becomes the note")
assertEqual(applied[3].status, "failed", "an unresolvable position fails instead of landing")
assertTrue(dirty_calls > 0, "the screen is refreshed after a change")

-- An entry already present locally is acked with the local identity, not re-added.
local before_count = #annotations
local applied_again = BookOrbitBookmarks.applyLive(ui, {
    add = { { serverId = 1, pos = "/body/DocFragment[7]", title = "Chapter Seven" } },
})
assertEqual(#annotations, before_count, "an already present position is not duplicated")
assertEqual(applied_again[1].key, "2026-07-01 09:00:00|/body/DocFragment[7]", "the existing identity is acked")

-- Delete by the identity the server was acked with.
local _a, deletes, _t, delete_touched = BookOrbitBookmarks.applyLive(ui, {
    delete = {
        { serverId = 1, key = "2026-07-01 09:00:00|/body/DocFragment[7]", datetime = "2026-07-01 09:00:00" },
        { serverId = 99, key = "never|seen", datetime = "2020-01-01 00:00:00" },
    },
})
assertEqual(delete_touched, 1, "only the known entry was removed")
assertEqual(#deletes, 2, "an already absent entry is still acked")
assertEqual(deletes[2].status, "applied", "a missing local entry counts as applied")

-- sidecar apply

sidecar_store = {
    { page = "/body/DocFragment[2]", datetime = "2026-06-01 10:00:00" },
    { page = "/body/DocFragment[4]", drawer = "lighten", pos0 = "/body/DocFragment[4]", datetime = "2026-06-03 12:00:00" },
}
sidecar_flags = {}

local s_applied, s_deleted, s_touched, s_deleted_touched = BookOrbitBookmarks.applySidecar("/books/one.epub", {
    add = { { serverId = 5, pos = "/body/DocFragment[6]", title = "From the web", pageno = 12 } },
    delete = { { serverId = 6, key = "2026-06-01 10:00:00|/body/DocFragment[2]", datetime = "2026-06-01 10:00:00" } },
})
assertEqual(s_touched, 2, "one add and one delete touched the sidecar")
assertEqual(s_deleted_touched, 1, "one delete landed")
assertEqual(#s_applied, 1, "one apply ack")
assertEqual(#s_deleted, 1, "one delete ack")
assertEqual(#sidecar_store, 2, "the highlight stayed and the new dogear was appended")
assertEqual(sidecar_store[2].note, "From the web", "a closed book has no toc, so the title lands in the note")
assertEqual(sidecar_store[2].pageno, 12, "the server pageno is kept")
assertTrue(sidecar_flags.annotations_externally_modified, "KOReader is asked to re-validate on open")
assertTrue(sidecar_flags.flushed, "the sidecar was flushed")

-- A highlight must never be touched by the bookmark exchange.
assertEqual(sidecar_store[1].drawer, "lighten", "the highlight survived the dogear delete")

print("bookorbit_bookmarks_test.lua: ok")
