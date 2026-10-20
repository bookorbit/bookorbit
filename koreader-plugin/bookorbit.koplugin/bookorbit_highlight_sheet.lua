--[[--
The Highlight of the day drawer. The dashboard tile is deliberately concise;
this sheet keeps the full passage readable and leaves book details one tap away.
Long passages turn page by page inside the drawer.
]]

local Device = require("device")
local TextBoxWidget = require("ui/widget/textboxwidget")
local UIManager = require("ui/uimanager")
local _ = require("gettext")

local BoardMetrics = require("bookorbit_board_metrics")
local BoardUI = require("bookorbit_board_ui")
local DialogUI = require("bookorbit_dialog_ui")
local TextPages = require("bookorbit_text_pages")

local INK = BoardMetrics.INK
local px, lh = BoardMetrics.px, BoardMetrics.lh
local text, vstack, hstack, space = BoardUI.text, BoardUI.vstack, BoardUI.hstack, BoardUI.space

local HighlightSheet = {}

local BODY_SIZE = 16

local function hOf(widget) return widget:getSize().h end

function HighlightSheet.pageWindow(total_lines, available_height, line_height, index)
    total_lines = math.max(1, tonumber(total_lines) or 1)
    line_height = math.max(1, tonumber(line_height) or 1)
    local per_page = math.max(1, math.floor(math.max(1, available_height) / line_height))
    local count = math.max(1, math.ceil(total_lines / per_page))
    index = math.max(1, math.min(count, tonumber(index) or 1))
    return {
        count = count,
        index = index,
        per_page = per_page,
        first_line = (index - 1) * per_page + 1,
        height = math.min(total_lines, per_page) * line_height,
    }
end

local function chapterLine(highlight, w)
    local chapter = type(highlight.chapterTitle) == "string" and highlight.chapterTitle:match("^%s*(.-)%s*$") or nil
    if not chapter or chapter == "" then return nil end
    return text(chapter, { s = 13, b = true, col = INK.g3, w = w, data = true })
end

local function buildBody(page, w, max_body_h)
    local highlight = page.highlight
    local head = DialogUI.titleRow(w, _("Highlight of the day"), highlight.bookTitle)
    local chapter = chapterLine(highlight, w)
    local details = highlight.bookId and DialogUI.pillRow(w, {
        { label = _("Book details"), icon = "book-open-text", kind = "outline", action = { kind = "details" } },
    }) or nil
    local gap = px(14)
    local line_height = lh(BODY_SIZE)
    local bar = math.max(2, px(3))
    local quote_gap = px(14)
    local quote_w = math.max(1, w - bar - quote_gap)
    local total_lines = TextPages.linesNeeded(highlight.text or "", { s = BODY_SIZE, serif = true, i = true }, quote_w)

    local function fixedHeight(with_pager)
        local fixed_items = { head }
        if chapter then table.insert(fixed_items, chapter) end
        if with_pager then table.insert(fixed_items, true) end
        if details then table.insert(fixed_items, details) end
        local height = 0
        for _i, item in ipairs(fixed_items) do
            height = height + (item == true and px(40) or hOf(item))
        end
        return height + #fixed_items * gap
    end

    local window = HighlightSheet.pageWindow(total_lines, max_body_h - fixedHeight(false), line_height, page.index)
    if window.count > 1 then
        window = HighlightSheet.pageWindow(total_lines, max_body_h - fixedHeight(true), line_height, page.index)
    end
    page.index = window.index
    page.count = window.count

    local quote = TextBoxWidget:new{
        text = highlight.text or "",
        face = BoardMetrics.face(BODY_SIZE, "serif_italic"),
        width = quote_w,
        height = window.height,
        virtual_line_num = window.first_line,
        fgcolor = INK.black,
        bgcolor = INK.white,
    }
    local quote_block = hstack({ w = w, valign = "top" }, {
        BoardUI.rect(bar, window.height, INK.black, math.floor(bar / 2)),
        space(quote_gap, 1),
        quote,
    })
    local items = { head, quote_block }
    if chapter then table.insert(items, chapter) end
    if window.count > 1 then table.insert(items, TextPages.pager(w, window.index, window.count)) end
    if details then table.insert(items, details) end
    return items
end

local function turn(page, delta)
    local next_index = math.max(1, math.min(page.count or 1, page.index + delta))
    if next_index == page.index then return end
    page.index = next_index
    page:refresh(Device:hasEinkScreen() and "partial" or "ui")
end

function HighlightSheet.open(catalog, highlight)
    if type(highlight) ~= "table" then return nil end
    return DialogUI.open{
        name = "bookorbit_highlight_of_the_day",
        build = function(page, sw, sh)
            return DialogUI.sheet(page, sw, sh, function(w, max_body_h)
                return buildBody(page, w, max_body_h)
            end, { pop_w = 520 })
        end,
        on_action = function(page, action)
            if action.kind == "page" then
                turn(page, action.delta)
            elseif action.kind == "details" and page.highlight.bookId then
                local book_id = page.highlight.bookId
                page:close()
                UIManager:tickAfterNext(function() catalog:loadBookDetail(book_id) end)
            end
            return true
        end,
        on_swipe = function(page, ges)
            if ges.direction == "west" then turn(page, 1) return true end
            if ges.direction == "east" then turn(page, -1) return true end
            return false
        end,
        on_page_key = function(page, delta) turn(page, delta) end,
        highlight = highlight,
        index = 1,
    }
end

return HighlightSheet
