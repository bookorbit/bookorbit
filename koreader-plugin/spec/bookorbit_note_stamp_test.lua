-- KOReader dates a note save only when the item flips between highlight and
-- note. Every note save calls ReaderHighlight:writePdfAnnotation("content",
-- item, ...), so the open book's highlight module is wrapped to stamp it then.

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local BookOrbitNoteStamp = require("bookorbit_note_stamp")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local calls = {}
local highlight = {
    writePdfAnnotation = function(self, action, item, content)
        table.insert(calls, { self = self, action = action, item = item, content = content })
        return "written"
    end,
}
local ui = { highlight = highlight }

assertEqual(BookOrbitNoteStamp.install(ui), true, "installs on an open book")
assertEqual(BookOrbitNoteStamp.install(ui), false, "installs once per book")

local before = os.date("%Y-%m-%d %H:%M:%S")
local item = { drawer = "lighten", datetime = "2026-07-08 09:00:00", note = "rewritten" }
assertEqual(highlight:writePdfAnnotation("content", item, "rewritten"), "written", "the original still runs")
assertEqual(#calls, 1, "the original is called once")
assertEqual(calls[1].action, "content", "with the same arguments")
assertEqual(calls[1].self, highlight, "on the same module")
assert(item.datetime_updated and item.datetime_updated >= before, "a note save dates the highlight")

local saved = { drawer = "lighten", datetime = "2026-07-08 09:00:00" }
highlight:writePdfAnnotation("save", saved)
assertEqual(saved.datetime_updated, nil, "other writes leave the date alone")

local dogear = { datetime = "2026-07-08 09:00:00", note = "page note" }
highlight:writePdfAnnotation("content", dogear, "page note")
assertEqual(dogear.datetime_updated, nil, "dogears are not touched")

assertEqual(BookOrbitNoteStamp.install({}), false, "a reader without highlights is left alone")

print("bookorbit_note_stamp_test: ok")
