-- Phase 4 fast path: an unchanged annotation set may skip its exchange, but
-- only while the change signal, the pending state and the age bound all agree.
-- Also covers the head-cursor delta consumption and the identity index that
-- replaced a full list scan per remote entry.

local sidecar_annotations = {}

package.loaded["docsettings"] = {
    open = function()
        return {
            readSetting = function(_, key)
                if key == "annotations" then return sidecar_annotations end
            end,
            saveSetting = function() end,
            makeTrue = function() end,
            flush = function() end,
        }
    end,
    hasSidecarFile = function() return false end,
    findSidecarFile = function() return nil end,
}
package.loaded["ui/widget/booklist"] = {
    setBookInfoCacheProperty = function() end,
}
package.loaded["ui/event"] = {
    new = function(_, name, payload) return { name = name, payload = payload } end,
}
package.loaded["ui/uimanager"] = {
    setDirty = function() end,
}
package.loaded["logger"] = {
    dbg = function() end,
}
package.loaded["ffi/sha2"] = {
    md5 = function(value) return value end,
}
package.loaded["util"] = {
    trim = function(value)
        return tostring(value or ""):match("^%s*(.-)%s*$")
    end,
}
package.loaded["libs/libkoreader-lfs"] = {
    attributes = function() return nil end,
}

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local BookOrbitAnnotations = require("bookorbit_annotations")
local BookOrbitSidecar = require("bookorbit_sidecar")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local function highlight(datetime, pos0, text)
    return {
        drawer = "lighten",
        datetime = datetime,
        pos0 = pos0,
        pos1 = pos0 .. ".12",
        text = text,
    }
end

-- The change signal must survive a delete plus an add that leaves both the
-- count and the maximum datetime exactly where they were.
local original = {
    highlight("2026-07-08 09:00:00", "/body/p[1]", "one"),
    highlight("2026-07-08 09:05:00", "/body/p[2]", "two"),
}
local swapped = {
    highlight("2026-07-08 09:00:00", "/body/p[1]", "one"),
    highlight("2026-07-08 09:05:00", "/body/p[9]", "nine"),
}
local _, original_max, original_signature = BookOrbitSidecar.normalizeAnnotations(original)
local _, swapped_max, swapped_signature = BookOrbitSidecar.normalizeAnnotations(swapped)
assertEqual(#original, #swapped, "the fixture keeps the annotation count identical")
assertEqual(swapped_max, original_max, "the fixture keeps the maximum datetime identical")
assert(swapped_signature ~= original_signature,
    "a delete-plus-add that keeps count and datetime still changes the signal")

local reordered = { original[2], original[1] }
local _, _, reordered_signature = BookOrbitSidecar.normalizeAnnotations(reordered)
assertEqual(reordered_signature, original_signature, "reordering the same set is not a change")

-- Skip conditions.
local MAX_AGE = BookOrbitAnnotations.EXCHANGE_MAX_AGE
local book = {}
assertEqual(BookOrbitAnnotations.canSkipExchange(book, original_signature, 1000), false,
    "a book that never exchanged cannot skip")
BookOrbitAnnotations.rememberExchanged(book, original_signature, 1000)
assertEqual(BookOrbitAnnotations.canSkipExchange(book, original_signature, 1000), true,
    "an unchanged set exchanged just now may skip")
assertEqual(BookOrbitAnnotations.canSkipExchange(book, swapped_signature, 1000), false,
    "a changed set always exchanges, so complete-key deletion detection still runs")
assertEqual(BookOrbitAnnotations.canSkipExchange(book, original_signature, 1000 + MAX_AGE), true,
    "the bound is inclusive at its edge")
assertEqual(BookOrbitAnnotations.canSkipExchange(book, original_signature, 1000 + MAX_AGE + 1), false,
    "an exchange older than the bound runs even when nothing changed locally")
assertEqual(BookOrbitAnnotations.canSkipExchange(book, original_signature, 900), false,
    "a stamp in the device's future is treated as expired")
assertEqual(BookOrbitAnnotations.canSkipExchange(book, nil, 1000), false,
    "a snapshot without a signal cannot skip")

-- Delta consumption walks a head cursor: every entry is uploaded once, in
-- order, across bounded chunks.
local many = {}
for index = 1, 120 do
    table.insert(many, highlight(string.format("2026-07-08 09:%02d:00", index % 60), "/body/p[" .. index .. "]", "h" .. index))
end
local normalized_many, many_max, many_signature = BookOrbitSidecar.normalizeAnnotations(many)
assertEqual(#normalized_many, 120, "the fixture normalizes every entry")

local requests = {}
local uploaded_order = {}
local state_book = {}
local exchange_state = {
    getBook = function() return state_book end,
    setUnmatched = function() error("the fixture book stays matched") end,
}
local client = {
    exchangeAnnotations = function(_, books)
        local entry = books[1]
        table.insert(requests, { keys = #entry.keys, complete = entry.keysComplete, changes = #entry.changes })
        for _, change in ipairs(entry.changes) do
            table.insert(uploaded_order, change.pos0)
        end
        return { results = { { toApply = {}, more = false } } }
    end,
    exchangeAck = function() error("nothing to apply in this fixture") end,
}

local result = BookOrbitAnnotations.exchangeBook({
    client = client,
    state = exchange_state,
    digest = "abc123",
    annotations = normalized_many,
    ann_max_datetime = many_max,
    ann_signature = many_signature,
    apply_mode = "sidecar",
    file = "/books/many.epub",
})
assertEqual(result.uploaded, 120, "every delta entry is uploaded")
assertEqual(#requests, 3, "120 entries go out in three bounded chunks")
assertEqual(requests[1].changes, 50, "the first chunk is full")
assertEqual(requests[3].changes, 20, "the last chunk holds the remainder")
assertEqual(requests[1].keys, 120, "the complete key set goes out with the first request")
assertEqual(requests[1].complete, true, "the first request reports the key set as complete")
assertEqual(requests[2].keys, 0, "follow-up requests do not repeat the key set")
assertEqual(#uploaded_order, 120, "no entry is uploaded twice or dropped")
for index = 1, 120 do
    assertEqual(uploaded_order[index], normalized_many[index].pos0, "delta order is preserved")
end
assertEqual(#normalized_many, 120, "the source list is not consumed destructively")
assertEqual(state_book.annSignature, many_signature, "a complete exchange records the signal")
assert(type(state_book.annExchangedAt) == "number", "a complete exchange records when it happened")

-- Remote changes the device could not apply must keep the next exchange
-- mandatory rather than being stamped as complete.
local pending_book = {}
local pending_state = {
    getBook = function() return pending_book end,
    setUnmatched = function() end,
}
local pending_result = BookOrbitAnnotations.exchangeBook({
    client = {
        exchangeAnnotations = function()
            return { results = { { toApply = { add = { { serverId = 1 } } }, more = false } } }
        end,
    },
    state = pending_state,
    digest = "abc123",
    annotations = {},
    ann_max_datetime = "",
    ann_signature = original_signature,
    apply_mode = "skip",
})
assert(pending_result.remote_pending ~= nil, "unapplied remote changes are reported")
assertEqual(pending_book.annSignature, nil, "a parked remote change leaves the book unstamped")

-- The identity index resolves entries the same way the scan did, including the
-- ambiguous duplicate-datetime case, and stays correct while the same pass
-- inserts and removes list entries.
sidecar_annotations = {
    {
        datetime = "2026-07-08 11:00:00",
        drawer = "lighten",
        text = "shared time A",
        page = "/body/p[10]",
        pos0 = "/body/p[10]",
        pos1 = "/body/p[10].4",
    },
    {
        datetime = "2026-07-08 11:00:00",
        drawer = "lighten",
        text = "shared time B",
        page = "/body/p[11]",
        pos0 = "/body/p[11]",
        pos1 = "/body/p[11].4",
    },
    {
        datetime = "2026-07-08 12:00:00",
        drawer = "lighten",
        text = "unique",
        page = "/body/p[12]",
        pos0 = "/body/p[12]",
        pos1 = "/body/p[12].4",
    },
}

local applied, deleted, touched = BookOrbitAnnotations.applySidecar("/books/index.epub", {
    add = {
        {
            serverId = 20,
            datetime = "2026-07-08 13:00:00",
            drawer = "lighten",
            text = "fresh",
            posFormat = "xpointer",
            pos0 = "/body/p[13]",
            pos1 = "/body/p[13].4",
        },
        -- Same datetime as two local entries: only the range plus text can
        -- decide, which is exactly the scanning path the index falls back to.
        {
            serverId = 21,
            datetime = "2026-07-08 11:00:00",
            drawer = "lighten",
            color = "green",
            text = "shared time B",
            posFormat = "xpointer",
            pos0 = "/body/p[11]",
            pos1 = "/body/p[11].4",
        },
    },
    delete = {
        {
            serverId = 22,
            datetime = "2026-07-08 12:00:00",
            text = "unique",
            pos0 = "/body/p[12]",
            pos1 = "/body/p[12].4",
        },
    },
    edit = {},
})

assertEqual(#sidecar_annotations, 3, "one add and one delete leave three entries")
assertEqual(sidecar_annotations[2].color, "green", "the ambiguous datetime resolves by range and text")
assertEqual(sidecar_annotations[3].text, "fresh", "the appended entry survives the removal")
assertEqual(#applied, 2, "both adds are acked")
assertEqual(#deleted, 1, "the delete is acked")
assertEqual(touched, 3, "each applied change is counted")
for _, annotation in ipairs(sidecar_annotations) do
    assert(annotation.text ~= "unique", "the deleted entry is gone")
end

-- Two entries sharing a range key make the index ambiguous, so resolution has
-- to fall back to scanning, which is what defines the winner.
sidecar_annotations = {
    { datetime = "2026-07-08 15:00:00", drawer = "lighten", text = "twin", pos0 = "/body/p[7]", pos1 = "/body/p[7].4" },
    { datetime = "2026-07-08 15:01:00", drawer = "lighten", text = "twin", pos0 = "/body/p[7]", pos1 = "/body/p[7].9" },
}
BookOrbitAnnotations.applySidecar("/books/twins.epub", {
    edit = {
        {
            serverId = 40,
            datetime = "2026-07-08 15:30:00",
            color = "red",
            text = "twin",
            pos0 = "/body/p[7]",
        },
    },
})
assertEqual(sidecar_annotations[1].color, "red", "an ambiguous range resolves to the first scan hit")
assertEqual(sidecar_annotations[2].color, nil, "the second twin is left alone")

-- A delete that shifts positions must not leave the index pointing at the
-- wrong entry for a later lookup in the same pass.
sidecar_annotations = {
    { datetime = "2026-07-08 14:00:00", drawer = "lighten", text = "first", pos0 = "/body/p[1]", pos1 = "/body/p[1].4" },
    { datetime = "2026-07-08 14:01:00", drawer = "lighten", text = "second", pos0 = "/body/p[2]", pos1 = "/body/p[2].4" },
    { datetime = "2026-07-08 14:02:00", drawer = "lighten", text = "third", pos0 = "/body/p[3]", pos1 = "/body/p[3].4" },
}
BookOrbitAnnotations.applySidecar("/books/shift.epub", {
    delete = {
        { serverId = 30, datetime = "2026-07-08 14:00:00", text = "first", pos0 = "/body/p[1]" },
        { serverId = 31, datetime = "2026-07-08 14:02:00", text = "third", pos0 = "/body/p[3]" },
    },
})
assertEqual(#sidecar_annotations, 1, "both deletes land after the list shifted")
assertEqual(sidecar_annotations[1].text, "second", "the surviving entry is the untouched one")

local function read(path)
    local file = assert(io.open(path, "rb"))
    local content = file:read("*a")
    file:close()
    return content
end

local plugin_dir = "koreader-plugin/bookorbit.koplugin/"
local annotations_source = read(plugin_dir .. "bookorbit_annotations.lua")
local book_sync_source = read(plugin_dir .. "bookorbit_book_sync.lua")
assert(not annotations_source:find("table.remove(delta, 1)", 1, true),
    "the exchange delta must not be drained from the front")
assert(not book_sync_source:find("table.remove(ctx.ann_delta, 1)", 1, true),
    "the legacy upload delta must not be drained from the front")

print("bookorbit_annotation_exchange_skip_test.lua: ok")
