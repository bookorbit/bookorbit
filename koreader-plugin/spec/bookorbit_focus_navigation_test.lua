-- Proves the D-Pad bookkeeping the custom catalog pages need on a device with
-- no touchscreen: that the title bar joins the focus layout on the Kindle
-- keypads Menu skips, and that the cursor survives a rebuild instead of being
-- teleported by Menu's uniform-grid focus math.

local device = {
    hasDPad = function() return true end,
    hasFewKeys = function() return false end,
}
package.loaded["device"] = device
package.loaded["ui/widget/focusmanager"] = { FOCUS_ONLY_ON_NT = 0 }
package.loaded["ui/event"] = {
    new = function(_, name, ...) return { handler = "on" .. name, name, ... } end,
}

local focus_navigation = true
package.loaded["bookorbit_catalog_widgets"] = {
    focusNavigation = function() return focus_navigation end,
}

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local CatalogFocus = require("bookorbit_catalog_focus")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local function titleBar(buttons)
    return {
        generateHorizontalLayout = function()
            return #buttons > 0 and { buttons } or {}
        end,
        generateVerticalLayout = function()
            local rows = {}
            for _, button in ipairs(buttons) do
                table.insert(rows, { button })
            end
            return rows
        end,
    }
end

local function newCatalog(opts)
    opts = opts or {}
    local catalog = {
        layout = opts.layout or {},
        selected = { x = opts.x or 1, y = opts.y or 1 },
        current_context = opts.context,
        title_bar = opts.title_bar,
        title_bar_layout_rows = opts.title_bar_layout_rows,
        custom_focus_key = opts.custom_focus_key,
        custom_focus = opts.custom_focus,
    }
    function catalog:moveFocusTo(x, y, flags)
        self.moved = { x = x, y = y, flags = flags }
        self.selected.x, self.selected.y = x, y
    end
    CatalogFocus.install(catalog)
    return catalog
end

-- The title bar goes in as one row on a full keypad, and the cursor's row
-- index shifts to stay on the widget it was already on.
local catalog = newCatalog{
    layout = { { "hero" }, { "a", "b" } },
    title_bar = titleBar{ "back", "search", "refresh", "menu" },
    y = 1,
}
catalog:mergeTitleBarIntoLayout()
assertEqual(#catalog.layout, 3, "the title bar adds a single row on a full keypad")
assertEqual(#catalog.layout[1], 4, "every title bar button shares that row")
assertEqual(catalog.layout[1][2], "search", "the plugin's own search icon is reachable")
assertEqual(catalog.title_bar_layout_rows, 1, "the merged row count is recorded")
assertEqual(catalog.selected.y, 2, "the cursor follows its widget down the layout")

-- A few-keys device spends "Right" on the context menu, so its title bar has to
-- stack instead.
device.hasFewKeys = function() return true end
catalog = newCatalog{
    layout = { { "hero" } },
    title_bar = titleBar{ "back", "search" },
    y = 1,
}
catalog:mergeTitleBarIntoLayout()
assertEqual(#catalog.layout, 3, "a few-keys title bar stacks one button per row")
assertEqual(catalog.title_bar_layout_rows, 2, "both stacked rows are recorded")
assertEqual(catalog.selected.y, 3, "the cursor shifts by both rows")
device.hasFewKeys = function() return false end

-- Without a D-Pad there is no cursor to place, and a page with no title bar
-- must not claim rows it did not add.
catalog = newCatalog{ layout = { { "a" } }, title_bar = titleBar{ "back" } }
device.hasDPad = function() return false end
catalog:mergeTitleBarIntoLayout()
assertEqual(#catalog.layout, 1, "a device with no D-Pad skips the merge")
assertEqual(catalog.title_bar_layout_rows, 0, "and records no merged rows")
device.hasDPad = function() return true end

catalog = newCatalog{ layout = { { "a" } } }
catalog:mergeTitleBarIntoLayout()
assertEqual(catalog.title_bar_layout_rows, 0, "a page with no title bar merges nothing")

-- The two devices this exists for. Kindle 3 and Kindle 4 are the models the bug
-- was reported on, and they are exactly the ones upstream Menu refuses to merge
-- a title bar for (K3 has a Sym key, K4 an on-screen keyboard). Neither sets
-- hasFewKeys, so both take the single-row title bar.
for _, profile in ipairs({
    { model = "Kindle3", has_sym_key = true, has_screen_kb = false },
    { model = "Kindle4", has_sym_key = false, has_screen_kb = true },
}) do
    device.hasSymKey = function() return profile.has_sym_key end
    device.hasScreenKB = function() return profile.has_screen_kb end
    catalog = newCatalog{
        layout = { { "hero" } },
        title_bar = titleBar{ "back", "search", "refresh" },
        y = 1,
    }
    catalog:mergeTitleBarIntoLayout()
    assertEqual(catalog.title_bar_layout_rows, 1,
        profile.model .. " gets its title bar as one row")
    assertEqual(#catalog.layout[1], 3,
        profile.model .. " can reach every title bar button")
    assertEqual(catalog.selected.y, 2,
        profile.model .. " shifts the cursor past the merged row")
end
device.hasSymKey = nil
device.hasScreenKB = nil

-- Opening a page for the first time records its key but has nothing to restore.
catalog = newCatalog{ context = { kind = "dashboard" }, x = 3, y = 4 }
catalog:saveCustomFocus()
assertEqual(catalog.custom_focus, nil, "a page opened fresh has no remembered cursor")
assertEqual(catalog.custom_focus_key, "dashboard", "but its key is recorded for the next rebuild")

-- Refreshing the same page keeps the cursor.
catalog:saveCustomFocus()
assertEqual(catalog.custom_focus.x, 3, "a rebuild of the same page remembers the column")
assertEqual(catalog.custom_focus.y, 4, "and the row")

-- Opening a different page does not.
catalog.current_context = { kind = "detail", detail = { id = 7 } }
catalog:saveCustomFocus()
assertEqual(catalog.custom_focus, nil, "opening another page starts its cursor from scratch")
assertEqual(catalog.custom_focus_key, "detail:7", "and the detail key names the book")

catalog.current_context = { kind = "detail", detail = { id = 8 } }
catalog:saveCustomFocus()
assertEqual(catalog.custom_focus, nil, "another book is another page")

-- A rebuilt layout can be shorter than the one the cursor was remembered
-- against: a shelf that lost a row, or a header that lost its paging chevrons.
catalog = newCatalog{
    layout = { { "a", "b" }, { "c" }, { "d", "e", "f", "g" } },
    custom_focus_key = "dashboard",
    custom_focus = { x = 5, y = 9 },
}
catalog:restoreCustomFocus()
assertEqual(catalog.moved.y, 3, "a row past the end clamps to the last row")
assertEqual(catalog.moved.x, 4, "and a column past the end clamps to that row's width")
assertEqual(catalog.custom_focus, nil, "the remembered cursor is consumed by the restore")

catalog = newCatalog{
    layout = { { "a", "b", "c" }, { "d" } },
    custom_focus_key = "dashboard",
    custom_focus = { x = 2, y = 1 },
}
catalog:restoreCustomFocus()
assertEqual(catalog.moved.x, 2, "a cursor still inside the layout is left alone")
assertEqual(catalog.moved.y, 1, "on both axes")

-- An empty row is skipped rather than focused.
catalog = newCatalog{
    layout = { { "a" }, { "b" }, {} },
    custom_focus_key = "dashboard",
    custom_focus = { x = 1, y = 3 },
}
catalog:restoreCustomFocus()
assertEqual(catalog.moved.y, 2, "an empty row hands the cursor to the one above it")

-- A page opened fresh starts below the title bar, on content.
catalog = newCatalog{
    layout = { { "back", "search" }, { "hero" }, { "a", "b" } },
    custom_focus_key = "dashboard",
    title_bar_layout_rows = 1,
}
catalog:restoreCustomFocus()
assertEqual(catalog.moved.y, 2, "a fresh page opens on its first content row")
assertEqual(catalog.moved.x, 1, "at the start of that row")

-- Section headers carry paging chevrons that are disabled on page one, so a
-- fresh cursor skips past them to the books rather than opening on a dead
-- control.
local chrome = { "prev", "next" }
chrome.is_chrome = true
catalog = newCatalog{
    layout = { { "back" }, chrome, { "book" } },
    custom_focus_key = "dashboard",
    title_bar_layout_rows = 1,
}
catalog:restoreCustomFocus()
assertEqual(catalog.moved.y, 3, "a fresh page skips a section header's controls")

-- Chrome is only skipped when opening; a remembered cursor may well be sitting
-- on a chevron the reader was paging with.
catalog = newCatalog{
    layout = { { "back" }, chrome, { "book" } },
    custom_focus_key = "dashboard",
    custom_focus = { x = 2, y = 2 },
    title_bar_layout_rows = 1,
}
catalog:restoreCustomFocus()
assertEqual(catalog.moved.y, 2, "a remembered cursor stays on its chevron")
assertEqual(catalog.moved.x, 2, "in the column it was paging from")

-- A page that is nothing but chrome still has to put the cursor somewhere.
local only_chrome = { "prev", "next" }
only_chrome.is_chrome = true
catalog = newCatalog{
    layout = { { "back" }, only_chrome },
    custom_focus_key = "dashboard",
    title_bar_layout_rows = 1,
}
catalog:restoreCustomFocus()
assertEqual(catalog.moved.y, 2, "a page with no content row falls back to its first row")

-- The mosaic and list views are the uniform grids Menu already handles.
catalog = newCatalog{ layout = { { "a" } } }
catalog:restoreCustomFocus()
assertEqual(catalog.moved, nil, "a plain book grid is left to Menu's own bookkeeping")

-- A touchscreen has no cursor to keep.
focus_navigation = false
catalog = newCatalog{ context = { kind = "dashboard" }, layout = { { "a" } }, x = 2, y = 2 }
catalog:saveCustomFocus()
assertEqual(catalog.custom_focus_key, nil, "a touch device tracks no page key")
assertEqual(catalog.custom_focus, nil, "and remembers no cursor")
catalog.custom_focus_key = "dashboard"
catalog.custom_focus = { x = 2, y = 2 }
catalog:restoreCustomFocus()
assertEqual(catalog.moved, nil, "and never moves the cursor")
focus_navigation = true

-- The footer's return arrow is a Button Menu never puts in the focus layout, so
-- Back is the only way up a level on a device that cannot tap it.
catalog = newCatalog{}
catalog.stack = { "dashboard", "books" }
assertEqual(catalog:shouldReturnOnBack(), true, "Back walks up while there is a level to return to")
catalog.stack = {}
assertEqual(catalog:shouldReturnOnBack(), false, "Back closes the catalog at the root")
catalog.stack = nil
assertEqual(catalog:shouldReturnOnBack(), false, "a catalog with no stack yet closes on Back")

-- A touch device can tap the arrow, so Back keeps closing outright: a multiswipe
-- to leave should not turn into one swipe per level browsed.
focus_navigation = false
catalog = newCatalog{}
catalog.stack = { "dashboard", "books" }
assertEqual(catalog:shouldReturnOnBack(), false, "a touch device still closes on Back")
focus_navigation = true


-- A page may nominate the row it exists for. The detail page marks its Read or
-- Download button, so the cursor opens on the thing the reader came to press
-- rather than five rows above it.
local primary = { "download" }
primary.is_primary = true
local header_chrome = { "prev", "next" }
header_chrome.is_chrome = true
catalog = newCatalog{
    layout = { { "back" }, header_chrome, { "meta" }, primary },
    custom_focus_key = "detail:7",
    title_bar_layout_rows = 1,
}
catalog:restoreCustomFocus()
assertEqual(catalog.moved.y, 4, "a fresh page opens on the row it nominated")

-- A remembered cursor still wins: the reader was somewhere for a reason.
catalog = newCatalog{
    layout = { { "back" }, { "meta" }, primary },
    custom_focus_key = "detail:7",
    custom_focus = { x = 1, y = 2 },
    title_bar_layout_rows = 1,
}
catalog:restoreCustomFocus()
assertEqual(catalog.moved.y, 2, "a rebuild keeps the cursor where it was")

-- The footer's paginator and return arrow join the layout as a last row, so a
-- reader who never learns the page-turn keys can still reach them. Only what is
-- actually on screen goes in: the plugin hides the chevrons on pages that do
-- not page.
local function footerCatalog(opts)
    local c = newCatalog{}
    for k, v in pairs(opts) do
        -- Model a real widget: the footer tells hidden controls they lost focus.
        if type(v) == "table" and not v.handleEvent then
            v.handleEvent = function(self, event)
                if event.handler == "onUnfocus" then self.focused = false end
                return true
            end
        end
        c[k] = v
    end
    return c
end

local chevrons = footerCatalog{
    page_return_arrow = { name = "return" },
    page_info_first_chev = { name = "first" },
    page_info_left_chev = { name = "prev" },
    page_info_text = { name = "text", text = "Page 1 of 15" },
    page_info_right_chev = { name = "next" },
    page_info_last_chev = { name = "last" },
}
local footer = chevrons:footerFocusRow()
assertEqual(#footer, 6, "every visible footer control is reachable")
assertEqual(footer[1].name, "return", "the return arrow comes first, as drawn")
assertEqual(footer[4].name, "text", "the page indicator sits between the chevrons")
assertEqual(footer.is_chrome, true, "the footer is chrome, so a fresh page skips it")

-- A page that does not page hides its chevrons and empties the indicator.
local dashboard_footer = footerCatalog{
    page_return_arrow = { name = "return", hidden = true },
    page_info_first_chev = { name = "first", hidden = true },
    page_info_left_chev = { name = "prev", hidden = true },
    page_info_text = { name = "text", text = "" },
    page_info_right_chev = { name = "next", hidden = true },
    page_info_last_chev = { name = "last", hidden = true },
}
assertEqual(dashboard_footer:footerFocusRow(), nil, "a page with no footer controls adds no row")

-- A return arrow with nothing beside it is still worth reaching.
local only_return = footerCatalog{
    page_return_arrow = { name = "return" },
    page_info_text = { name = "text", text = "" },
}
local lone = only_return:footerFocusRow()
assertEqual(#lone, 1, "a lone return arrow still gets a row")
assertEqual(lone[1].name, "return", "holding the arrow")

-- A touch device taps the footer directly.
focus_navigation = false
assertEqual(chevrons:footerFocusRow(), nil, "a touch device adds no footer row")
focus_navigation = true

-- The footer is the one row that has to survive a change of page: its controls
-- are what cause the rebuild, so pressing "next page" or "next book" from there
-- must leave the cursor on the button just pressed.
local function footerRow(...)
    local row = { ... }
    row.id = "footer"
    row.is_chrome = true
    return row
end

-- The row index shifts with however much content the page has; the id does not.
catalog = newCatalog{
    layout = { { "a" }, { "b" }, { "c" }, footerRow("return", "prev", "next") },
    custom_focus_key = "books",
    custom_focus = { x = 3, y = 4, row_id = "footer" },
}
catalog:restoreCustomFocus()
assertEqual(catalog.moved.y, 4, "the footer is found at its new row index")
assertEqual(catalog.moved.x, 3, "on the same control")

catalog = newCatalog{
    layout = { { "a" }, footerRow("return", "prev", "next") },
    custom_focus_key = "books",
    custom_focus = { x = 3, y = 9, row_id = "footer" },
}
catalog:restoreCustomFocus()
assertEqual(catalog.moved.y, 2, "a shorter page still finds the footer")
assertEqual(catalog.moved.x, 3, "keeping the control that caused the rebuild")

-- Even where the page has no key of its own: the book grid is Menu's to manage,
-- but its footer is ours.
catalog = newCatalog{
    layout = { { "a" }, footerRow("return", "next") },
    custom_focus = { x = 2, y = 2, row_id = "footer" },
}
catalog:restoreCustomFocus()
assertEqual(catalog.moved ~= nil, true, "a grid with no page key still restores its footer")
assertEqual(catalog.moved.x, 2, "on the pressed control")

-- Resting on the footer is remembered whatever page comes next.
catalog = newCatalog{
    layout = { { "a" }, footerRow("return", "next") },
    context = { kind = "detail", detail = { id = 1 } },
    custom_focus_key = "detail:99",
    x = 2, y = 2,
}
catalog:saveCustomFocus()
assertEqual(catalog.custom_focus ~= nil, true, "the footer cursor survives moving to another book")
assertEqual(catalog.custom_focus.row_id, "footer", "and remembers it was the footer")

-- Off the footer, a change of page still starts the new one fresh.
catalog = newCatalog{
    layout = { { "a" }, { "b" } },
    context = { kind = "detail", detail = { id = 1 } },
    custom_focus_key = "detail:99",
    x = 1, y = 2,
}
catalog:saveCustomFocus()
assertEqual(catalog.custom_focus, nil, "an ordinary row does not follow the reader to another page")

-- Returning to a page restores the cursor it was left at, across any number of
-- pages visited in between and whether or not the page keys its own focus.
catalog = newCatalog{ layout = { { "a", "b" }, { "c" } }, x = 2, y = 1 }
local left_at = catalog:captureFocus()
assertEqual(left_at.x, 2, "leaving a page captures the column")
assertEqual(left_at.y, 1, "and the row")

catalog = newCatalog{ layout = { { "a", "b" }, { "c" } } }
catalog:restoreFocusOnNextUpdate(left_at)
catalog:saveCustomFocus()
catalog:restoreCustomFocus()
assertEqual(catalog.moved.x, 2, "returning puts the cursor back in its column")
assertEqual(catalog.moved.y, 1, "and its row")

-- A touch device captures nothing to restore.
focus_navigation = false
catalog = newCatalog{ layout = { { "a" } }, x = 1, y = 1 }
assertEqual(catalog:captureFocus(), nil, "a touch device captures no cursor")
catalog:restoreFocusOnNextUpdate({ x = 1, y = 1 })
assertEqual(catalog.pending_focus, nil, "and accepts none")
focus_navigation = true

-- A focus layout may only name buttons the title bar actually draws. TitleBar
-- clears its children and re-inits whenever a shrink-to-fit title changes, which
-- drops any button appended afterwards while leaving the field pointing at it.
-- Trusting the field sent the cursor to controls that were not on screen - and
-- the same drop hid those buttons from touch users too.
local ORDER = { "left_button", "search_button", "refresh_button", "right_button" }
local APPENDED = { search_button = true, refresh_button = true }
local function titleBar(fields, drawn)
    local b = {}
    for k, v in pairs(fields) do b[k] = v end
    for _, child in ipairs(drawn or {}) do table.insert(b, child) end
    return b
end

local left, search, refresh = { "left" }, { "search" }, { "refresh" }

-- All three drawn: all three reachable.
local drawnButtons = CatalogFocus.drawnTitleBarButtons(
    titleBar({ left_button = left, search_button = search, refresh_button = refresh },
             { search, refresh }), ORDER, APPENDED)
assertEqual(#drawnButtons, 3, "every drawn button is reachable")
assertEqual(drawnButtons[2], search, "in left-to-right order")

-- Re-init dropped them from the group but left the fields set.
drawnButtons = CatalogFocus.drawnTitleBarButtons(
    titleBar({ left_button = left, search_button = search, refresh_button = refresh }, {}),
    ORDER, APPENDED)
assertEqual(#drawnButtons, 1, "buttons dropped from the group are not reachable")
assertEqual(drawnButtons[1], left, "leaving only the bar's own button")

-- One of the two survived.
drawnButtons = CatalogFocus.drawnTitleBarButtons(
    titleBar({ left_button = left, search_button = search, refresh_button = refresh },
             { refresh }), ORDER, APPENDED)
assertEqual(#drawnButtons, 2, "a partially rebuilt bar reports only what it drew")
assertEqual(drawnButtons[2], refresh, "and keeps their order")

-- TitleBar's own buttons are nested rather than direct children, so they are
-- taken on trust and must not be filtered out.
drawnButtons = CatalogFocus.drawnTitleBarButtons(
    titleBar({ left_button = left, right_button = { "right" } }, {}), ORDER, APPENDED)
assertEqual(#drawnButtons, 2, "the bar's own buttons are trusted without membership")

assertEqual(#CatalogFocus.drawnTitleBarButtons(titleBar({}, {}), ORDER, APPENDED), 0,
    "a bar with no buttons reports none")

-- A footer control that has just been hidden is no longer in the layout, so no
-- Unfocus would ever reach it - and a hidden Button still paints its frame, so a
-- stale inverted one shows up as a black block where the chevron used to be.
local function footerWidget(name, hidden)
    return {
        name = name, hidden = hidden, focused = not not hidden,
        handleEvent = function(self, event)
            if event.handler == "onUnfocus" or event[1] == "Unfocus" then
                self.focused = false
            end
            return true
        end,
    }
end

local shown_chev = footerWidget("next", false)
local hidden_chev = footerWidget("last", true)
local page_text = footerWidget("text", false)
page_text.text = "Page 1 of 3"
catalog = newCatalog{}
catalog.page_return_arrow = footerWidget("return", false)
catalog.page_info_first_chev = footerWidget("first", true)
catalog.page_info_left_chev = footerWidget("prev", true)
catalog.page_info_text = page_text
catalog.page_info_right_chev = shown_chev
catalog.page_info_last_chev = hidden_chev

local built = catalog:footerFocusRow()
assertEqual(#built, 3, "only the controls actually on screen are reachable")
assertEqual(hidden_chev.focused, false, "a hidden chevron is told it lost focus")
assertEqual(catalog.page_info_first_chev.focused, false, "every hidden control is")
assertEqual(shown_chev.focused, false, "a shown one is left alone to be focused normally")

-- An emptied page indicator is excluded too: it is blanked rather than hidden.
page_text.text = ""
built = catalog:footerFocusRow()
for _, w in ipairs(built) do
    assertEqual(w ~= page_text, true, "an empty page indicator is not reachable")
end

print("bookorbit_focus_navigation_test.lua: ok")
