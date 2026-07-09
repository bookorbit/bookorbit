package.loaded["docsettings"] = {
    open = function()
        error("DocSettings should not be used by live apply")
    end,
}

package.loaded["ui/event"] = {
    new = function(_, name, payload)
        return { name = name, payload = payload }
    end,
}

local dirty_scope
local dirty_mode
package.loaded["ui/uimanager"] = {
    setDirty = function(_, scope, mode)
        dirty_scope = scope
        dirty_mode = mode
    end,
}

package.loaded["logger"] = {
    dbg = function() end,
}

package.loaded["ffi/sha2"] = {
    md5 = function(value)
        return value
    end,
}

package.loaded["util"] = {
    trim = function(value)
        return tostring(value or ""):match("^%s*(.-)%s*$")
    end,
}

package.loaded["bookorbit_sidecar"] = {
    normalizeAnnotations = function()
        return {}, ""
    end,
}

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local BookOrbitAnnotations = require("bookorbit_annotations")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local handled_event
local footer_updates = 0
local ui = {
    rolling = true,
    document = {
        isXPointerInDocument = function()
            return true
        end,
        getTextFromXPointers = function()
            return "fresh web highlight"
        end,
        getPageFromXPointer = function()
            return 12
        end,
    },
    annotation = {
        annotations = {},
        addItem = function(self, item)
            item.pageno = 12
            table.insert(self.annotations, item)
            return #self.annotations
        end,
    },
    view = {
        footer = {
            maybeUpdateFooter = function()
                footer_updates = footer_updates + 1
            end,
        },
    },
    handleEvent = function(_, event)
        handled_event = event
    end,
}

local applied, deleted, touched, deleted_touched = BookOrbitAnnotations.applyLive(ui, {
    add = {
        {
            serverId = 42,
            version = 3,
            datetime = "2026-07-08 09:10:11",
            datetimeUpdated = "2026-07-08 09:12:00",
            drawer = "lighten",
            color = "yellow",
            text = "fresh web highlight",
            note = "from web reader",
            chapter = "Chapter 1",
            posFormat = "xpointer",
            pos0 = "/body/DocFragment[1]/p[1]/text().0",
            pos1 = "/body/DocFragment[1]/p[1]/text().19",
        },
    },
})

assertEqual(#ui.annotation.annotations, 1, "remote highlight is inserted")
assertEqual(applied[1].status, "applied", "remote highlight is acked as applied")
assertEqual(applied[1].verified, true, "remote highlight is verified")
assertEqual(applied[1].pageno, 12, "ack includes inserted pageno")
assertEqual(#deleted, 0, "no deletes are emitted")
assertEqual(touched, 1, "one annotation is touched")
assertEqual(deleted_touched, 0, "no deleted touch is counted")
assertEqual(footer_updates, 1, "footer is refreshed")
assertEqual(dirty_scope, "all", "UI is dirtied")
assertEqual(dirty_mode, "ui", "UI dirty mode is set")
assertEqual(handled_event.name, "AnnotationsModified", "annotations modified event is sent")
assertEqual(handled_event.payload[1], ui.annotation.annotations[1], "event points at inserted item")
assertEqual(handled_event.payload.nb_highlights_added, 1, "event increments highlight count")
assertEqual(handled_event.payload.index_modified, 1, "event carries inserted index")

print("bookorbit_annotations_live_apply_test.lua: ok")
