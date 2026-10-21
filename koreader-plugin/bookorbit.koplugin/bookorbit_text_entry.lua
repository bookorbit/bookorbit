--[[--
A panel to type into: search, filters, naming a download, and the account
fields (server address, username, password).

The field is KOReader's own InputText inside a BookOrbit panel hung from the
top edge, so KOReader's keyboard keeps the bottom of the screen and works as
it does everywhere else. Whatever the caller offers below the field (recent
searches, a note, buttons) is part of the same panel: there is no second
dialog behind a button.

A password field is masked, with its own show and hide button. A field that
checks its value keeps the panel open and says what is wrong under it.
]]

local InputText = require("ui/widget/inputtext")
local UIManager = require("ui/uimanager")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local util = require("util")

local BoardMetrics = require("bookorbit_board_metrics")
local BoardUI = require("bookorbit_board_ui")
local DialogUI = require("bookorbit_dialog_ui")
local MenuPage = require("bookorbit_menu_page")
local MenuUI = require("bookorbit_menu_ui")

local INK = BoardMetrics.INK
local px = BoardMetrics.px
local text, hstack, flex, icon = BoardUI.text, BoardUI.hstack, BoardUI.flex, BoardUI.icon

local TextEntry = {}

-- Holds the field across rebuilds: a rebuild frees the old widget tree, and
-- the field (and the keyboard bound to it) must outlive it.
local Keep = WidgetContainer:extend{}
function Keep:getSize() return self[1]:getSize() end
function Keep:free() end

local function fieldBox(page, w)
    local b = math.max(1, px(2))
    -- Room for the clear (or show password) button is kept whether it shows
    -- or not: a field that changed width would be rebuilt, and lose the
    -- keyboard bound to it.
    local iw = w - 2 * b - px(12) - px(20) - px(10) - px(44)
    if not page.input or page.input_w ~= iw then
        local value = page.input and page.input:getText() or page.opts.value or ""
        if page.input then page.input:onCloseKeyboard(); page.input:onCloseWidget() end
        page.input = InputText:new{
            text = value,
            hint = page.opts.hint,
            text_type = page.opts.password and not page.revealed and "password" or nil,
            show_password_toggle = false,
            face = BoardMetrics.face(18),
            width = iw,
            padding = 0,
            margin = 0,
            bordersize = 0,
            scroll = true,
            cursor_at_end = true,
            parent = page,
            enter_callback = function() page:submit() end,
            edit_callback = function() if page.edited then page:edited() end end,
        }
        page.input_w = iw
        page.keep = Keep:new{ page.input }
    end
    -- A long name wraps: the box grows with the field, from one line up.
    local h = math.max(px(48), page.keep:getSize().h + 2 * px(10) + 2 * b)
    local trail
    if page.opts.password then
        trail = BoardUI.hit(MenuUI.iconButton(page.revealed and "eye-off" or "eye", nil, { size = 20, sw = 2.25 }), { kind = "reveal" })
    elseif page.has_text then
        trail = BoardUI.hit(MenuUI.iconButton("x", nil, { size = 18, sw = 2.5 }), { kind = "clear" })
    else
        trail = BoardUI.space(px(44), 1)
    end
    local items = { BoardUI.space(px(12), 1), icon(page.opts.icon or "search", px(20), { sw = 2.25 }), BoardUI.space(px(10), 1), page.keep, flex(0), trail }
    return BoardUI.box({ w = w, h = h, radius = px(12), border = b, border_col = INK.black, bg = INK.white },
        hstack({ w = w - 2 * b, h = h - 2 * b }, items))
end

local function build(page, sw, sh)
    local kb = page.input and page.input.keyboard and page.input.keyboard.dimen
    local limit = sh - (kb and kb.h or 0) - px(16)
    return (DialogUI.topSheet(page, sw, sh, function(w, max_h)
        local items = {
            DialogUI.titleRow(w, page.opts.title, page.opts.sub, { close = false }),
            fieldBox(page, w),
        }
        if page.error then
            table.insert(items, DialogUI.note(w, "triangle-alert", page.error, { b = true, col = INK.black, lines = 3 }))
        end
        if page.opts.below then
            -- What is left under the field, after the gaps the panel adds.
            local room = max_h
            for _i, item in ipairs(items) do room = room - item:getSize().h - px(14) end
            for _i, item in ipairs(page.opts.below(page, w, room, page.has_text) or {}) do table.insert(items, item) end
        end
        return items
    end, { limit = limit, pop_w = 560 }))
end

-- opts: title, sub, value, hint, icon, password, allow_empty,
-- validate(text) returning what is wrong or nil, below(page, w, max_h,
-- has_text) returning widgets under the field, on_submit(text),
-- on_action(page, action), on_close.
function TextEntry.open(opts)
    local page
    page = MenuPage:new{
        name = "bookorbit_text_entry",
        backdrop = true,
        dismiss_outside = true,
        -- The keyboard sits above the panel in the window stack; taps it does
        -- not take must still reach the panel.
        is_always_active = true,
        build = build,
        opts = opts,
        has_text = (opts.value or "") ~= "",
        -- The field is built inside the first build, so these exist before it.
        -- A password is taken as typed, spaces and all.
        entryText = function(self)
            local value = self.input and self.input:getText() or ""
            return opts.password and value or util.trim(value)
        end,
        submit = function(self)
            local value = self:entryText()
            if value == "" and not opts.allow_empty then return end
            local problem = opts.validate and opts.validate(value)
            if problem then
                self.error = problem
                self:refresh()
                return
            end
            self:close()
            UIManager:tickAfterNext(function() opts.on_submit(value) end)
        end,
        -- Only a change between empty and not, or a problem to clear, redraws
        -- the panel; the field repaints itself as you type.
        edited = function(self)
            if not self.input then return end
            local has = self:entryText() ~= ""
            if has ~= self.has_text or self.error then
                self.has_text = has
                self.error = nil
                self:refresh()
            end
        end,
        -- KOReader's keyboard Back key closes the dialog it types into.
        onCloseDialog = function(self)
            self:close()
        end,
        on_action = function(self, action)
            if action.kind == "clear" then
                self.input:setText("")
                self:edited()
            elseif action.kind == "reveal" then
                self.revealed = not self.revealed
                self.input.text_type = self.revealed and "text" or "password"
                self.input:setText(self.input:getText(), true)
                self:refresh()
            elseif action.kind == "submit" then
                self:submit()
            elseif opts.on_action then
                opts.on_action(self, action)
            end
            return true
        end,
        on_close = function(self)
            if self.input then
                self.input:onCloseKeyboard()
                self.input:onCloseWidget()
            end
            if opts.on_close then opts.on_close() end
        end,
    }
    UIManager:show(page, "ui")
    if page.input then page.input:onShowKeyboard() end
    return page
end

-- Rows under a search field: recent searches, or what pressing Search does.
-- Taps come back as { kind = "recent", index }, "clear-recents" and "submit".
function TextEntry.searchBelow(recents)
    local _ = require("gettext")
    return function(page, w, max_h, has_text)
        local iw = MenuUI.rowsIn(w)
        if has_text then
            return { MenuUI.group(w, {
                MenuUI.row(iw, { icon = "search", label = _("Search books, authors and series"), sub = _("Or press Enter on the keyboard"), chevron = true, bold = true, action = { kind = "submit" } }),
            }) }
        end
        if #recents == 0 then return {} end
        local clear = BoardUI.hit(text(_("Clear"), { s = 14, b = true }), { kind = "clear-recents" })
        local rows = {}
        for index, q in ipairs(recents) do
            table.insert(rows, MenuUI.row(iw, { icon = "clock", label = q, data = true, h = 48, action = { kind = "recent", index = index } }))
        end
        local list = MenuUI.group(w, rows)
        -- Not enough room above the keyboard (landscape): the same searches
        -- as chips.
        if MenuUI.lh1(13) + px(8) + list:getSize().h > max_h then
            list:free()
            local chips = {}
            for index, q in ipairs(recents) do
                local chip = hstack({ gap = px(6) }, { icon("clock", px(16), { sw = 2.25 }), text(q, { s = 14, data = true }) })
                local cw = chip:getSize().w + px(10) + px(14)
                local h = px(36)
                table.insert(chips, BoardUI.hit(BoardUI.box({ w = cw, h = h, radius = math.floor(h / 2), border = math.max(1, px(1)), border_col = INK.g8, bg = INK.white },
                    hstack({ w = cw - 2 * math.max(1, px(1)), h = h - 2 * math.max(1, px(1)) }, { BoardUI.space(px(10) - math.max(1, px(1)), 1), chip, flex(0) })), { kind = "recent", index = index }))
            end
            list = DialogUI.wrap(w, chips, px(8))
        end
        return { DialogUI.section(w, _("Recent"), list, clear) }
    end
end

return TextEntry
