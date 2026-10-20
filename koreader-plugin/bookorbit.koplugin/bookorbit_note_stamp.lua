--[[--
Dates note edits in the open book.

KOReader stamps datetime_updated only when a note save flips an item between
highlight and note, so rewriting an existing note's text leaves no edit time
and the next sync can only date it by when it ran: an older offline rewrite
then beats a later edit made elsewhere. Every note save, from the highlight
dialog or the bookmark list, ends in ReaderHighlight:writePdfAnnotation
("content", item, ...), for EPUBs too (it returns early there), so the open
book's ReaderHighlight is wrapped to stamp the item at that moment.
]]

local BookOrbitNoteStamp = {}

local INSTALLED = "_bookorbit_note_stamp"

function BookOrbitNoteStamp.install(ui)
    local highlight = ui and ui.highlight
    if type(highlight) ~= "table" or highlight[INSTALLED] then return false end
    local original = highlight.writePdfAnnotation
    if type(original) ~= "function" then return false end
    highlight.writePdfAnnotation = function(self, action, item, content)
        if action == "content" and type(item) == "table" and item.drawer then
            item.datetime_updated = os.date("%Y-%m-%d %H:%M:%S")
        end
        return original(self, action, item, content)
    end
    highlight[INSTALLED] = true
    return true
end

return BookOrbitNoteStamp
