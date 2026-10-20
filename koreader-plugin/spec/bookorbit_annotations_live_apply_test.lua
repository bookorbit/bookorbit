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

local existing = ui.annotation.annotations[1]
local old_pos0, old_pos1 = existing.pos0, existing.pos1
ui.document.getTextFromXPointers = function(_, pos0)
    return pos0 == '/body/DocFragment[2]/p[1]/text().0' and 'moved selection' or 'fresh web highlight'
end
applied = BookOrbitAnnotations.applyLive(ui, {
    edit = {{
        serverId = 42, version = 4, datetime = existing.datetime,
        text = 'moved selection', note = 'moved on another device',
        pos0 = '/body/DocFragment[2]/p[1]/text().0',
        pos1 = '/body/DocFragment[2]/p[1]/text().15',
    }},
})
assertEqual(applied[1].verified, true, 'a moved edit verifies its new range')
assertEqual(existing.pos0, '/body/DocFragment[2]/p[1]/text().0', 'a moved edit updates the rendered start')
assertEqual(existing.text, 'moved selection', 'a moved edit updates the quote')

ui.document.isXPointerInDocument = function() return false end
local previous_note = existing.note
applied = BookOrbitAnnotations.applyLive(ui, {
    add = {{
        serverId = 42, version = 5, datetime = existing.datetime, posFormat = 'xpointer',
        text = 'unresolvable selection', note = 'must remain pending', pos0 = old_pos0, pos1 = old_pos1,
    }},
})
assertEqual(applied[1].status, 'failed', 'an existing identity still needs range verification')
assertEqual(existing.note, previous_note, 'a failed redelivery preserves the applied annotation')

ui.document.findAllText = function()
    return {
        { start = '/body/DocFragment[1]/p[1]/text().0', ['end'] = '/body/DocFragment[1]/p[1]/text().9' },
        { start = '/body/DocFragment[2]/p[1]/text().0', ['end'] = '/body/DocFragment[2]/p[1]/text().9' },
    }
end
applied = BookOrbitAnnotations.applyLive(ui, {
    add = {{ serverId = 99, version = 1, datetime = '2026-07-09 09:00:00', posFormat = 'xpointer',
        text = 'repeated text', pos0 = '/invalid', pos1 = '/invalid' }},
})
assertEqual(applied[1].status, 'failed', 'repeated text without a trustworthy location stays pending')
assertEqual(#ui.annotation.annotations, 1, 'ambiguous repair never draws a guessed passage')
