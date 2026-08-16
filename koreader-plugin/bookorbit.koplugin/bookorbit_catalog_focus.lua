--[[--
D-Pad focus bookkeeping for the catalog's custom pages.

A device with a D-Pad but no touchscreen (Kindle 3/4 and friends) drives the
whole catalog through KOReader's FocusManager, which needs two things this
plugin's pages cannot get from Menu alone: a cursor that survives a rebuild,
and a reachable title bar. Both are installed onto the catalog widget by
`install`, alongside the other catalog mixins.
]]

local Device = require("device")
local Event = require("ui/event")
local FocusManager = require("ui/widget/focusmanager")

local CatalogWidgets = require("bookorbit_catalog_widgets")

local CatalogFocus = {}

local FOOTER_ROW_ID = "footer"

--- Filters a title bar's buttons down to the ones it actually draws.
---
--- A focus layout may only name widgets that are on screen: a button reachable
--- by the cursor but absent from the paint is worse than one that cannot be
--- reached at all. TitleBar clears its own children and re-inits whenever a
--- shrink-to-fit title changes, which drops any button appended afterwards while
--- leaving the field pointing at it, so membership of the group is the only
--- trustworthy test for those.
---
--- `order` lists the button fields left to right. `appended` names the ones added
--- as direct children; TitleBar nests its own inside containers, so those are
--- taken on trust.
function CatalogFocus.drawnTitleBarButtons(bar, order, appended)
    local drawn = {}
    for _, child in ipairs(bar) do
        drawn[child] = true
    end
    local buttons = {}
    for _, field in ipairs(order) do
        local button = bar[field]
        if button and (not appended[field] or drawn[button]) then
            table.insert(buttons, button)
        end
    end
    return buttons
end

-- Identifies the page the cursor is currently on, so a rebuild can tell "the
-- same page refreshed" from "a different page opened".
function CatalogFocus:customFocusKey()
    local context = self.current_context or {}
    if context.kind == "dashboard" then
        return "dashboard"
    elseif context.kind == "detail" then
        return "detail:" .. tostring(context.detail and context.detail.id)
    end
    return nil
end

-- The custom pages rebuild their whole widget tree on every refresh - a shelf
-- page turn, a Discover reroll, a status change - which throws away the widget
-- the cursor was sitting on. Menu's own bookkeeping cannot put it back: it
-- derives a position from the selected item number over a uniform grid, and
-- these pages are rows of unequal width whose first row is a cluster of header
-- controls. Remember the coordinates before the layout is discarded.
function CatalogFocus:saveCustomFocus()
    self.custom_focus = nil
    if not CatalogWidgets.focusNavigation() then return end
    local key = self:customFocusKey()
    -- Returning to a page hands back the cursor it was left at, whatever page
    -- the reader wandered off to in between.
    if self.pending_focus then
        self.custom_focus = self.pending_focus
        self.pending_focus = nil
        self.custom_focus_key = key
        return
    end
    local row_id = self:focusRowId()
    -- A named row is remembered whatever page comes next. The footer is the same
    -- strip of controls on every page, and its controls are what *cause* the
    -- rebuild: pressing "next page" or "next book" from there has to leave the
    -- cursor on the button just pressed, or the reader cannot press it twice.
    if row_id or (key and key == self.custom_focus_key) then
        self.custom_focus = { x = self.selected.x, y = self.selected.y, row_id = row_id }
    end
    self.custom_focus_key = key
end

-- The id of the row the cursor is in, when that row has one.
function CatalogFocus:focusRowId()
    local row = (self.layout or {})[self.selected.y]
    return row and row.id
end

-- The cursor a page is being left at, stored on the navigation stack entry so
-- returning to the page puts it back. Pages are pushed and popped together with
-- their contexts, so this scopes and expires with them.
function CatalogFocus:captureFocus()
    if not CatalogWidgets.focusNavigation() then return nil end
    return { x = self.selected.x, y = self.selected.y, row_id = self:focusRowId() }
end

-- Hands a remembered cursor to the next rebuild, used when popping the stack.
function CatalogFocus:restoreFocusOnNextUpdate(focus)
    if focus and CatalogWidgets.focusNavigation() then
        self.pending_focus = focus
    end
end

-- The row a cursor should land on when the page is opened rather than rebuilt.
--
-- A page may nominate the row it exists for - the detail page marks its Read or
-- Download button - and the cursor opens there. Otherwise it takes the first row
-- that is neither a merged title bar row nor a section header's controls, and
-- falls back to the first row when a page is nothing but chrome.
function CatalogFocus:firstContentFocusRow()
    local layout = self.layout or {}
    local start = (self.title_bar_layout_rows or 0) + 1
    for index = start, #layout do
        if layout[index].is_primary then return index end
    end
    local y = start
    while layout[y] and layout[y].is_chrome do
        y = y + 1
    end
    if not layout[y] then
        return math.min((self.title_bar_layout_rows or 0) + 1, math.max(1, #layout))
    end
    return y
end

-- Puts the cursor back, clamped into the layout that just replaced the old
-- one: a shelf that lost a row, or a header that lost its paging chevrons,
-- leaves the remembered coordinates pointing past the end.
function CatalogFocus:restoreCustomFocus()
    if not CatalogWidgets.focusNavigation() then return end
    local layout = self.layout
    if not layout or #layout == 0 then return end
    local target = self.custom_focus
    self.custom_focus = nil

    local function focusAt(x, y)
        y = math.max(1, math.min(y, #layout))
        while y > 1 and #layout[y] == 0 do
            y = y - 1
        end
        if #layout[y] == 0 then return end
        self:moveFocusTo(math.max(1, math.min(x, #layout[y])), y,
            FocusManager.FOCUS_ONLY_ON_NT)
    end

    -- A cursor we remembered is honoured on every page, including the mosaic and
    -- list grids we otherwise leave to Menu: a named row is found again wherever
    -- it landed this time, and anything else falls back to its coordinates.
    if target then
        if target.row_id then
            for index = 1, #layout do
                if layout[index].id == target.row_id and #layout[index] > 0 then
                    return focusAt(target.x, index)
                end
            end
        end
        return focusAt(target.x, target.y)
    end

    -- Nothing remembered, so this page is being opened rather than rebuilt. Only
    -- the pages we own pick their own opening row; the uniform grids are the
    -- ones Menu's own bookkeeping was written for.
    if not self.custom_focus_key then return end
    focusAt(1, self:firstContentFocusRow())
end

-- Menu skips the title bar on Kindle-style keypads because its own title bar
-- actions all have hardware keys. Ours do not: the search and refresh icons are
-- this plugin's, with no key mapping behind them, so skipping would strand them
-- on exactly the devices that cannot tap. Kindle 3/4 have a full 5-way pad, so
-- the buttons go in as one row and cost a single Down press to leave.
--
-- The D-Pad check is ours too: a focus layout is only ever walked by a D-Pad
-- (FocusManager binds no keys without one), so on a device that has none these
-- rows would be dead entries that only shift the cursor's row index.
function CatalogFocus:mergeTitleBarIntoLayout()
    self.title_bar_layout_rows = 0
    if not self.title_bar or not Device:hasDPad() then return end
    -- A few-keys device spends "Right" on the context menu, so its title bar
    -- has to stack vertically to stay reachable.
    local title_bar_layout = Device:hasFewKeys()
        and self.title_bar:generateVerticalLayout()
        or self.title_bar:generateHorizontalLayout()
    for index, row in ipairs(title_bar_layout) do
        table.insert(self.layout, index, row)
    end
    self.title_bar_layout_rows = #title_bar_layout
    self.selected.y = self.selected.y + self.title_bar_layout_rows
end

-- The footer's paginator and return arrow are Buttons that Menu never puts in
-- the focus layout, on the assumption that the hardware page-turn and Back keys
-- cover them. They mostly do, but those keys are easy to miss, and on the detail
-- page the same chevrons step through *books* rather than pages, which no key
-- covers at all.
--
-- So append whatever the footer is currently showing as the last row. It is
-- marked chrome, so a page opened fresh still starts on its content, and only
-- visible controls go in: the plugin hides the chevrons outright on pages that
-- do not page.
function CatalogFocus:footerFocusRow()
    if not CatalogWidgets.focusNavigation() then return nil end
    -- Screen order: the return arrow sits bottom-left, the paginator centred.
    local candidates = {
        self.page_return_arrow,
        self.page_info_first_chev,
        self.page_info_left_chev,
        self.page_info_text,
        self.page_info_right_chev,
        self.page_info_last_chev,
    }
    local row, included = {}, {}
    for _, widget in ipairs(candidates) do
        local shown = not widget.hidden
        -- The page indicator is a button in its own right - it opens "go to
        -- page" - but it is emptied rather than hidden when there is nothing to
        -- page through.
        if widget == self.page_info_text then
            shown = (widget.text or "") ~= ""
        end
        if shown then
            table.insert(row, widget)
            included[widget] = true
        end
    end

    -- A control that has just been hidden has to be told it is no longer
    -- focused. It is not in the layout any more, so no Unfocus would reach it,
    -- and a hidden Button still paints its frame: left inverted, it shows up as
    -- a black block where the chevron used to be.
    for _, widget in ipairs(candidates) do
        if not included[widget] then
            widget:handleEvent(Event:new("Unfocus"))
        end
    end

    if #row == 0 then return nil end
    row.is_chrome = true
    -- Named, so the cursor can be put back on it after a rebuild without relying
    -- on a row index that shifts with however much content the page has.
    row.id = FOOTER_ROW_ID
    return row
end

-- The Series, Authors, Libraries and Collections pages are drawn by plain Menu,
-- whose rows mark focus with a hairline that is invisible in a list of rows that
-- already have separators. Give them the catalog's own focus box.
--
-- Menu has already placed the cursor by the time this runs, so the box has to be
-- re-asserted afterwards or the row the page opens on stays unmarked until the
-- reader moves.
function CatalogFocus:makeMenuItemsFocusable()
    if not CatalogWidgets.focusNavigation() then return end
    for _, row in ipairs(self.layout or {}) do
        for _, widget in ipairs(row) do
            -- The underline container is what identifies a Menu row; the title
            -- bar's buttons and our own widgets bring their own focus styling.
            if type(widget) == "table" and widget._underline_container then
                CatalogWidgets.focusableMenuItem(widget)
            end
        end
    end
end

-- Redraws the focus box on whatever is currently selected.
function CatalogFocus:refocusCurrentRow()
    if not CatalogWidgets.focusNavigation() then return end
    local layout = self.layout
    if not layout or not layout[self.selected.y] then return end
    if not layout[self.selected.y][self.selected.x] then return end
    self:moveFocusTo(self.selected.x, self.selected.y, FocusManager.FOCUS_ONLY_ON_NT)
end

-- Whether the Back key should walk up a level rather than close the catalog.
--
-- Menu closes on Back because its own back affordance is the footer's return
-- arrow, and that arrow is a Button it never puts in the focus layout: a device
-- with no touchscreen cannot press it, leaving Back as the only key here and
-- closing the whole catalog from however deep the reader had browsed. Menu
-- already has the right rule for its own stack - go up a level, close only at
-- the root - so we apply it to ours.
--
-- Touch devices keep closing on Back: they can still tap the arrow, and a
-- multiswipe to close should not turn into one swipe per level.
function CatalogFocus:shouldReturnOnBack()
    return CatalogWidgets.focusNavigation() and #(self.stack or {}) > 0
end

function CatalogFocus.install(Catalog)
    for name, fn in pairs(CatalogFocus) do
        if name ~= "install" then
            Catalog[name] = fn
        end
    end
end

return CatalogFocus
