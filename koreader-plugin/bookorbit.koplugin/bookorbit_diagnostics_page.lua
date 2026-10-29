--[[--
Technical details: everything the sync knows, for bug reports.

The facts in titled cards (this device, account, sync, library, highlights,
last results), then what can be run from here. Like every BookOrbit page it
turns rather than scrolls; wide screens show two columns a page.
]]

local Device = require("device")
local UIManager = require("ui/uimanager")
local T = require("ffi/util").template
local _ = require("gettext")

local BoardMetrics = require("bookorbit_board_metrics")
local BoardUI = require("bookorbit_board_ui")
local MenuPage = require("bookorbit_menu_page")
local MenuUI = require("bookorbit_menu_ui")
local TextPages = require("bookorbit_text_pages")

local INK = BoardMetrics.INK
local px = BoardMetrics.px
local text, vstack, hstack, space, flex = BoardUI.text, BoardUI.vstack, BoardUI.hstack, BoardUI.space, BoardUI.flex

local Diagnostics = {}

local function hOf(widget) return widget:getSize().h end
local function wOf(widget) return widget:getSize().w end

-- A fact: the label left and the value right when the value is short; a
-- long value goes under its label instead.
local function fact(w, label, value)
    value = tostring(value or "")
    local v = text(value, { s = 14, b = true, data = true })
    local l = text(label, { s = 14, col = INK.g3 })
    if wOf(v) + px(16) + wOf(l) <= w then
        return hstack({ w = w, h = px(38) }, { l, flex(px(16)), v })
    end
    v:free()
    local probe = require("ui/widget/textboxwidget"):new{ text = value, face = BoardMetrics.face(14), bold = true, width = w }
    local lines = math.max(1, math.min(4, math.floor(probe:getSize().h / BoardMetrics.lh(14) + 0.5)))
    probe:free()
    local column = vstack({ w = w }, {
        l,
        space(nil, px(2)),
        text(value, { s = 14, b = true, w = w, lines = lines, data = true }),
    })
    return vstack({ w = w, pad = { px(8), 0, px(8), 0 } }, { column })
end

local function sectionBlock(w, section)
    local iw = MenuUI.rowsIn(w)
    local rows = {}
    for _i, r in ipairs(section.rows) do
        local row = fact(iw, r[1], r[2])
        row._no_icon = true
        table.insert(rows, row)
    end
    return MenuUI.section(w, section.title, MenuUI.group(w, rows, { inset = 0 }))
end

-- How an action stands after it was run from here.
local function actionSub(page, a)
    if a.kind == "test" and page.test then
        if page.test.running then return _("Testing…") end
        if page.test.ok then return _("Connection works") end
        if page.test.err then return T(_("Failed: %1"), page.test.err) end
    end
    if a.kind == "recheck" and page.sync then
        if page.sync.running then return page.sync.text or _("Rechecking…") end
        if page.sync.done then return _("Done: every book was checked again") end
        if page.sync.err then return T(_("Could not recheck: %1"), page.sync.err) end
    end
    return nil
end

local function actionsBlock(page, w, actions)
    local iw = MenuUI.rowsIn(w)
    local rows = {}
    for _i, a in ipairs(actions) do
        local sub = actionSub(page, a)
        local busy = (a.kind == "test" and page.test and page.test.running) or (a.kind == "recheck" and page.sync and page.sync.running)
        table.insert(rows, MenuUI.row(iw, { icon = a.icon, label = a.label, sub = sub, sub_data = true, chevron = not busy, h = 52,
            action = busy and { kind = "noop" } or { kind = a.kind } }))
    end
    return MenuUI.section(w, _("Run from here"), MenuUI.group(w, rows))
end

local function slice(list, first, last)
    local out = {}
    for index = first, last or #list do table.insert(out, list[index]) end
    return out
end

-- The sections in columns body_h tall. A section that does not fit the room
-- left splits between its rows, its title over the rest, so a page does not
-- end in a band of nothing; each part keeps at least two rows.
local function packColumns(page, cw, body_h, gap)
    local d = page.data
    local columns, col, room = {}, {}, body_h
    local function close()
        if #col > 0 then table.insert(columns, col) end
        col, room = {}, body_h
    end
    local function place(block)
        if #col > 0 then room = room - gap end
        table.insert(col, block)
        room = room - hOf(block)
    end
    local function avail() return #col > 0 and room - gap or room end
    for _i, section in ipairs(d.sections) do
        local rows = section.rows
        local first = 1
        while first <= #rows do
            local block = sectionBlock(cw, { title = section.title, rows = slice(rows, first) })
            if hOf(block) <= avail() then
                place(block)
                first = #rows + 1
            else
                local left = #rows - first + 1
                local part
                for k = left - 2, 2, -1 do
                    local try = sectionBlock(cw, { title = section.title, rows = slice(rows, first, first + k - 1) })
                    if hOf(try) <= avail() then part = try; first = first + k; break end
                    try:free()
                end
                if part then
                    block:free()
                    place(part)
                    close()
                elseif #col > 0 then
                    block:free()
                    close()
                else
                    -- Taller than a page and too short to split: drawn whole.
                    place(block)
                    first = #rows + 1
                end
            end
        end
    end
    if #d.actions > 0 then
        local block = actionsBlock(page, cw, d.actions)
        if #col > 0 and hOf(block) > avail() then close() end
        place(block)
    end
    close()
    if #columns == 0 then columns = { {} } end
    return columns
end

local function build(page, sw, sh)
    local d = page.data
    local mx = MenuUI.mx()
    local w = sw - 2 * mx
    local top, bottom = px(6), px(8)
    local header = MenuUI.pageHeader(w, _("Technical details"), { sub = _("Everything the sync knows, for bug reports") })
    local body_h = sh - top - bottom - hOf(header) - px(8) - px(8) - px(40)
    local gutter = px(24)
    local gap = px(16)
    local function blocksAt(cw)
        local out = {}
        for _i, section in ipairs(d.sections) do table.insert(out, sectionBlock(cw, section)) end
        if #d.actions > 0 then table.insert(out, actionsBlock(page, cw, d.actions)) end
        return out
    end
    -- Two columns on a wide screen, unless a column is too narrow for its
    -- rows at this interface size.
    local ncol = 1
    if MenuUI.wide() then
        local clean = BoardUI.fits(function() return BoardUI.collectHits(function() return blocksAt(math.floor((w - gutter) / 2)) end) end)
        if clean then ncol = 2 end
    end
    local cw = ncol == 2 and math.floor((w - gutter) / 2) or w
    local columns = packColumns(page, cw, body_h, gap)
    page.count = math.max(1, math.ceil(#columns / ncol))
    if page.index > page.count then page.index = page.count end

    local cols = {}
    for c = 1, ncol do
        local column = columns[(page.index - 1) * ncol + c]
        local items = {}
        for _i, block in ipairs(column or {}) do
            if #items > 0 then table.insert(items, space(nil, gap)) end
            table.insert(items, block)
        end
        table.insert(cols, vstack({ w = cw, h = body_h }, #items > 0 and items or { space(cw, 1) }))
    end
    -- Blocks on other pages were only measured.
    for index, column in ipairs(columns) do
        local on_page = index > (page.index - 1) * ncol and index <= page.index * ncol
        if not on_page then for _i, block in ipairs(column) do block:free() end end
    end
    local body = ncol == 2 and hstack({ w = w, gap = gutter, valign = "top" }, cols) or cols[1]
    local items = { header, space(nil, px(8)), body, space(nil, px(8)) }
    table.insert(items, page.count > 1 and TextPages.pager(w, page.index, page.count) or space(nil, px(40)))
    return vstack({ w = sw, h = sh, pad = { top, mx, bottom, mx } }, items)
end

local function reload(page)
    if page.closed then return end
    page.data = page.plugin:diagnosticsSections()
    page:refresh()
end

local function turn(page, delta)
    local next_index = math.max(1, math.min(page.count or 1, page.index + delta))
    if next_index == page.index then return end
    page.index = next_index
    page:refresh(Device:hasEinkScreen() and "partial" or "ui")
end

local function onAction(page, action)
    local plugin = page.plugin
    local kind = action.kind
    local refresh = function() reload(page) end
    if kind == "page" then
        turn(page, action.delta)
    elseif kind == "test" then
        plugin:startPageTest(page, refresh)
    elseif kind == "recheck" then
        plugin:startPageSync(page, refresh, { full_recheck = true })
    elseif kind == "check-update" then
        plugin:checkForUpdate()
    elseif kind == "retry-highlights" then
        plugin:retryOpenHighlightSync()
        UIManager:scheduleIn(1, refresh)
    elseif kind == "retry-match" then
        plugin:retryOpenBookMatch()
        UIManager:scheduleIn(1, refresh)
    end
    return true
end

function Diagnostics.open(plugin)
    local page = MenuPage:new{
        name = "bookorbit_diagnostics",
        build = build,
        on_action = onAction,
        on_swipe = function(page, ges)
            if ges.direction == "west" then turn(page, 1) return true end
            if ges.direction == "east" then turn(page, -1) return true end
            return false
        end,
        on_page_key = function(page, delta) turn(page, delta) end,
        plugin = plugin,
        data = plugin:diagnosticsSections(),
        index = 1,
    }
    UIManager:show(page, "ui")
    return page
end

return Diagnostics
