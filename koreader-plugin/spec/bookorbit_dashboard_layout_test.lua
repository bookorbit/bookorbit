-- Proves the dashboard's vertical budget: that shelves are measured at the
-- height their cover cards actually need, that a page too tight for the
-- configured slots drops the stats strip before any shelf, and that nothing is
-- laid out past the available height.

package.loaded["document/documentregistry"] = { hasProvider = function() return true end }
package.loaded["util"] = {
    fixUtf8 = function(value) return value end,
    urlEncode = function(value) return value end,
}
package.loaded["ffi/util"] = { template = function(value) return value end }
package.loaded["gettext"] = function(text) return text end

local function widgetClass(height)
    return {
        new = function(_, opts)
            opts = opts or {}
            if not opts.getSize then
                function opts:getSize()
                    return { w = 100, h = self.width or height or 20 }
                end
            end
            return opts
        end,
    }
end

package.loaded["ffi/blitbuffer"] = { COLOR_DARK_GRAY = 1, COLOR_LIGHT_GRAY = 2 }
package.loaded["ui/widget/button"] = widgetClass()
package.loaded["ui/widget/container/centercontainer"] = widgetClass()
package.loaded["ui/font"] = { getFace = function() return {} end }
package.loaded["ui/geometry"] = widgetClass()
package.loaded["ui/widget/horizontalgroup"] = widgetClass(0)
package.loaded["ui/widget/horizontalspan"] = widgetClass(0)
package.loaded["ui/widget/infomessage"] = widgetClass()
package.loaded["ui/widget/linewidget"] = widgetClass()
package.loaded["ui/network/manager"] = { isConnected = function() return true end }
package.loaded["device"] = { screen = { scaleBySize = function(_, value) return value end } }
package.loaded["ui/size"] = {
    line = { thin = 1 },
    padding = { large = 8 },
    span = { horizontal_default = 4, vertical_default = 4 },
}
package.loaded["ui/widget/textboxwidget"] = widgetClass()
package.loaded["ui/widget/textwidget"] = widgetClass()
package.loaded["ui/uimanager"] = { show = function() end }
package.loaded["ui/widget/verticalgroup"] = widgetClass(0)
package.loaded["ui/widget/verticalspan"] = widgetClass()
package.loaded["bookorbit_stats_reader"] = {
    getReadingSummary = function()
        return { today_seconds = 600, week_seconds = 3600, streak_days = 3 }
    end,
}

local HEADER_HEIGHT = 20
local HEADER_ROW_HEIGHT = 14
local STATUS_LINE_HEIGHT = 16
local HIGHLIGHT_CARD_HEIGHT = 64

package.loaded["bookorbit_catalog_widgets"] = {
    DashboardCoverCard = widgetClass(),
    DashboardHeroCard = widgetClass(),
    DashboardHighlightCard = widgetClass(),
    DashboardBrowseRow = widgetClass(),
    DashboardIconButton = widgetClass(),
    assetIconFile = function() return nil end,
    dashboardSectionHeaderRowHeight = function() return HEADER_ROW_HEIGHT end,
    buildDashboardSectionHeader = function()
        return { getSize = function() return { w = 100, h = HEADER_HEIGHT } end }
    end,
    buildStatusLabel = function()
        return { getSize = function() return { w = 100, h = STATUS_LINE_HEIGHT } end }
    end,
    dashboardHighlightCardHeight = function()
        return HIGHLIGHT_CARD_HEIGHT
    end,
    coverCardHeight = function(card_w)
        return card_w + 20
    end,
    dashboardHeroHeightForCoverCard = function(card_w)
        return card_w + 24
    end,
}

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local CatalogDashboard = require("bookorbit_catalog_dashboard")
local DashboardSections = require("bookorbit_dashboard_sections")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local STATS_HEIGHT = 60

local function books(count)
    local list = {}
    for id = 1, count do list[id] = { id = id } end
    return list
end

local function newCatalog(opts)
    local slots = {}
    for index = 1, DashboardSections.SLOT_COUNT do
        slots[index] = { type = opts.sections[index].type, books = books(opts.books or 12) }
    end
    local catalog = {
        settings = {
            [DashboardSections.SETTING_KEY] = {
                opts.sections[1], opts.sections[2], opts.sections[3], opts.sections[4],
                schemaVersion = DashboardSections.SCHEMA_VERSION,
            },
        },
        available_height = opts.avail,
        content_w = opts.content_w or 500,
        content_inset = 0,
        item_group = {},
        layout = {},
        current_context = {
            kind = "dashboard",
            dashboard = { continueReading = books(4), dashboardSlots = slots },
        },
        shelves = {},
        headers = {},
    }
    for name, fn in pairs(CatalogDashboard) do
        if name ~= "install" then catalog[name] = fn end
    end
    function catalog:prepareCustomUpdate() return nil end
    function catalog:finishCustomUpdate() end
    function catalog:ensureOnDeviceCurrent() end
    function catalog:isOnDevice() return false end
    function catalog:onDeviceCount() return 0 end
    function catalog:readStatusLabel() return nil end
    function catalog:buildDashboardStatsStrip()
        return { getSize = function() return { w = 100, h = STATS_HEIGHT } end }
    end

    local addHeader = catalog.addDashboardHeader
    function catalog:addDashboardHeader(text, controls)
        table.insert(self.headers, text)
        return addHeader(self, text, controls)
    end
    local addGrid = catalog.addDashboardCoverGrid
    function catalog:addDashboardCoverGrid(section_id, list, height, with_progress, with_caption, cols, card_w, page, rows)
        table.insert(self.shelves, { id = section_id, height = height, cols = cols, card_w = card_w })
        return addGrid(self, section_id, list, height, with_progress, with_caption, cols, card_w, page, rows)
    end
    return catalog
end

local DEFAULTS = {
    { type = "stats" }, { type = "continue-reading" }, { type = "random" }, { type = "browse" },
}
local FOUR_SHELVES = {
    { type = "random" }, { type = "recently-added" }, { type = "in-progress" }, { type = "random" },
}

-- A roomy page renders every configured slot, and each shelf is exactly as tall
-- as its cover cards need to be.
local catalog = newCatalog{ sections = DEFAULTS, avail = 800 }
catalog:updateDashboardItems()
assertEqual(#catalog.shelves, 1, "the default dashboard renders its one shelf")
assertEqual(#catalog.headers, 3, "Continue reading, the shelf and Browse each get a header")
assertEqual(catalog.shelves[1].height, catalog.shelves[1].card_w + 20, "a roomy shelf is drawn in aspect")
assertEqual(catalog.shelves[1].cols, 6, "a roomy shelf keeps its natural slot count")
assertEqual(catalog.dash_used <= 800, true, "a roomy page stays inside the available height")

-- Four shelves share the page and stay in aspect: the cards get narrower rather
-- than being squashed to fit.
catalog = newCatalog{ sections = FOUR_SHELVES, avail = 600 }
catalog:updateDashboardItems()
assertEqual(#catalog.shelves, 4, "four configured shelves all render")
for _, shelf in ipairs(catalog.shelves) do
    assertEqual(shelf.height, shelf.card_w + 20, "every shelf is drawn in aspect")
end
assertEqual(catalog.shelves[1].cols, 6, "a crowded page still stops at the column cap")
assertEqual(catalog.dash_used <= 600, true, "four shelves stay inside the available height")

-- Too tight for everything: the stats strip goes before any shelf does.
catalog = newCatalog{ sections = DEFAULTS, avail = 450 }
catalog:updateDashboardItems()
assertEqual(#catalog.shelves, 1, "the shelf survives a tight page")
assertEqual(catalog.headers[1], "Continue reading", "the stats strip is dropped first")
assertEqual(catalog.dash_used <= 450, true, "dropping stats brings the page back inside its height")

-- Tighter still: shelves go from the bottom up, and the native slots stay.
catalog = newCatalog{ sections = FOUR_SHELVES, avail = 260 }
catalog:updateDashboardItems()
assertEqual(#catalog.shelves < 4, true, "an impossible page drops shelves from the bottom")
assertEqual(catalog.shelves[1].id, "section1", "the first configured shelf is the last to go")
assertEqual(catalog.dash_used <= 260, true, "dropping shelves brings the page back inside its height")

-- A slot waiting on a refresh renders its placeholder rather than the books
-- cached for the previous choice.
catalog = newCatalog{ sections = DEFAULTS, avail = 800 }
catalog.current_context.section_stale = { [3] = true }
catalog:updateDashboardItems()
assertEqual(#catalog.shelves, 0, "a pending shelf renders no cover grid")
assertEqual(catalog.headers[2], "Discover", "a pending shelf still shows its header")

-- A stale (cached) dashboard announces itself with a status line that takes
-- part in the vertical budget.
catalog = newCatalog{ sections = DEFAULTS, avail = 800 }
catalog.current_context.stale = true
catalog:updateDashboardItems()
assertEqual(catalog.dash_used <= 800, true, "the status line stays inside the available height")
local without_status = newCatalog{ sections = DEFAULTS, avail = 800 }
without_status:updateDashboardItems()
assertEqual(catalog.dash_used, without_status.dash_used, "budget accounting is unchanged aside from the trailing spacer")

-- The Highlight of the day slot renders its measured card and drops after
-- stats but before any shelf when the page gets tight.
local WITH_HIGHLIGHT = {
    { type = "stats" }, { type = "continue-reading" }, { type = "highlight" }, { type = "random" },
}
catalog = newCatalog{ sections = WITH_HIGHLIGHT, avail = 800 }
catalog.current_context.dashboard.highlightOfTheDay = { text = "quote", bookId = 7 }
catalog:updateDashboardItems()
assertEqual(catalog.headers[2], "Highlight of the day", "the highlight slot renders its header")
assertEqual(#catalog.shelves, 1, "the shelf renders alongside the highlight card")
assertEqual(catalog.dash_used <= 800, true, "the highlight card stays inside the available height")

catalog = newCatalog{ sections = WITH_HIGHLIGHT, avail = 340 }
catalog.current_context.dashboard.highlightOfTheDay = { text = "quote", bookId = 7 }
catalog:updateDashboardItems()
local saw_highlight = false
for _, header in ipairs(catalog.headers) do
    if header == "Highlight of the day" then saw_highlight = true end
end
assertEqual(saw_highlight, false, "a tight page drops the highlight card after stats, before shelves")
assertEqual(#catalog.shelves, 1, "the shelf survives the tight page")

-- Header controls are built at the header's label-row height, so a section
-- carrying chevrons or a reroll button is exactly as tall as a bare one. That
-- is what keeps the single measured header height the budget uses honest, and
-- what stops the controls from floating above the label.
catalog = newCatalog{ sections = DEFAULTS, avail = 800 }
local prev_control, next_control = catalog:buildDashboardHeaderNav("section3", 2, 4)
local reroll_control = catalog:buildDashboardRerollButton(3)
for label, control in pairs({ prev = prev_control, next = next_control, reroll = reroll_control }) do
    assertEqual(control.dimen.h, HEADER_ROW_HEIGHT, label .. " control fills the header row exactly")
    assertEqual(control.dimen.w, HEADER_ROW_HEIGHT, label .. " control is square")
    assertEqual(control.tap_padding_v > 0, true, label .. " control takes taps from the gap around it")
end
assertEqual(prev_control.enabled, true, "a page-2 back chevron is live")
assertEqual(catalog:buildDashboardHeaderNav("section3", 1, 4).enabled, false,
    "the back chevron is disabled on the first page")

-- Page turns record each section's band and narrow the refresh to it.
catalog = newCatalog{ sections = DEFAULTS, avail = 800 }
catalog.dimen = { x = 0, y = 0, w = 520, h = 900 }
function catalog:menuChromeHeight() return 30, 40 end
catalog.dash_refresh_section = "section3"
catalog:updateDashboardItems()
local band = catalog.dash_section_bands["section3"]
assertEqual(band ~= nil and band.h > 0, true, "the shelf records its rendered band")
local region = catalog.custom_refresh_region
assertEqual(region ~= nil, true, "a page turn narrows the refresh to the changed band")
assertEqual(region.y, 30 + band.y - 4, "the refresh band sits below the title bar with its padding")
assertEqual(region.h, band.h + 8, "the refresh band covers the section plus padding")
assertEqual(catalog.dash_refresh_section, nil, "the page-turn hint is consumed by the rebuild")

print("bookorbit_dashboard_layout_test.lua: ok")
