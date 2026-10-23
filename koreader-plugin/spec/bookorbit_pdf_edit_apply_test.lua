-- D-14: a web edit to a KOReader PDF highlight (page positions, not xpointers) must apply and
-- ack as applied with the serialized position the server keyed it by, on the open book and in
-- a closed book's sidecar. Before the fix the live path ran xpointer range verification on the
-- page tables, acked "failed", and the server re-sent the edit on every exchange.

local sidecar_store = {}
package.loaded["docsettings"] = {
    open = function()
        return {
            readSetting = function(_, key) return sidecar_store[key] end,
            saveSetting = function(_, key, value) sidecar_store[key] = value end,
            makeTrue = function(_, key) sidecar_store[key] = true end,
            flush = function() end,
        }
    end,
}
package.loaded["ui/event"] = {
    new = function(_, name, payload) return { name = name, payload = payload } end,
}
package.loaded["ui/uimanager"] = { setDirty = function() end }
package.loaded["logger"] = { dbg = function() end }
package.loaded["ffi/sha2"] = { md5 = function(value) return value end }
package.loaded["util"] = {
    trim = function(value) return tostring(value or ""):match("^%s*(.-)%s*$") end,
}
package.loaded["bookorbit_capabilities"] = {}
package.loaded["ui/widget/booklist"] = {}
package.loaded["libs/libkoreader-lfs"] = {}

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local BookOrbitAnnotations = require("bookorbit_annotations")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local function pdfHighlight()
    return {
        datetime = "2026-10-18 15:01:37",
        drawer = "lighten",
        color = "green",
        text = "With Jonnen in her arms, Mia had swum through the vast storage tanks below",
        note = "AS-PDF-02 KOReader PDF note",
        page = 22,
        pos0 = { page = 22, x = 90, y = 98 },
        pos1 = { page = 22, x = 538, y = 98 },
    }
end

local function editEntry()
    return {
        serverId = 2093,
        version = 2,
        key = "key-2093",
        datetime = "2026-10-18 15:01:37",
        datetimeUpdated = "2026-10-18 15:03:00",
        drawer = "lighten",
        color = "green",
        text = "With Jonnen in her arms, Mia had swum through the vast storage tanks below",
        note = "AS-PDF-03 web edit of R PDF note",
    }
end

-- Live: the PDF is open (paging), so the document has no xpointer API at all.
local live = pdfHighlight()
local events = {}
local ui = {
    paging = true,
    document = {},
    annotation = { annotations = { live } },
    handleEvent = function(_, event) table.insert(events, event) end,
}
local applied, _, touched = BookOrbitAnnotations.applyLive(ui, { edit = { editEntry() } })

assertEqual(live.note, "AS-PDF-03 web edit of R PDF note", "live: the web note is applied")
assertEqual(live.datetime_updated, "2026-10-18 15:03:00", "live: the edit time is taken")
assertEqual(type(live.pos0), "table", "live: the page position is left alone")
assertEqual(touched, 1, "live: one highlight touched")
assertEqual(#events, 1, "live: KOReader is told the annotation changed")
assertEqual(applied[1].status, "applied", "live: acked as applied, not failed")
assertEqual(applied[1].verified, true, "live: acked as verified so the server stops re-sending it")
assertEqual(applied[1].pos0, '{"page":22,"x":90.00,"y":98.00}', "live: ack carries the serialized pos0 the key was built from")
assertEqual(applied[1].pos1, '{"page":22,"x":538.00,"y":98.00}', "live: ack carries the serialized pos1")

-- Closed book: the edit lands in the sidecar.
sidecar_store.annotations = { pdfHighlight() }
local sapplied, _, stouched = BookOrbitAnnotations.applySidecar("/books/darkdawn.pdf", { edit = { editEntry() } })
local stored = sidecar_store.annotations[1]

assertEqual(stored.note, "AS-PDF-03 web edit of R PDF note", "sidecar: the web note is applied")
assertEqual(stored.bookorbit_pending_verification, nil, "sidecar: no xpointer verification is left pending for a PDF item")
assertEqual(stouched, 1, "sidecar: one highlight touched")
assertEqual(sidecar_store.annotations_externally_modified, true, "sidecar: KOReader re-reads it on open")
assertEqual(sapplied[1].status, "applied", "sidecar: acked as applied")
assertEqual(sapplied[1].verified, true, "sidecar: acked as verified")
assertEqual(sapplied[1].pos0, '{"page":22,"x":90.00,"y":98.00}', "sidecar: ack carries the serialized pos0")

print("bookorbit_pdf_edit_apply_test: ok")
