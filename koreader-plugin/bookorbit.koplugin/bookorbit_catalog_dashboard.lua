--[[--
Dashboard mixin for the BookOrbit catalog browser.

Builds and renders the single-page dashboard as four ordered, configurable
slots. Stats keeps its compact strip, Continue reading keeps its hero row, book
sources and SmartScopes use cover grids, and Browse keeps its action list.

The renderer measures native slots first, then divides the remaining vertical
budget evenly among all configured cover-grid shelves. Cover cards are always
sized from their width, so a tight page gives shelves narrower cards rather
than squashed ones; only when even the narrowest row does not fit is a slot
dropped, stats first. Grid sources carry up to SHELF_PAGE_SIZE books and
paginate independently. The mixin also owns offline caching and per-slot
Discover rerolls.
]]

local Blitbuffer = require("ffi/blitbuffer")
local Button = require("ui/widget/button")
local CenterContainer = require("ui/widget/container/centercontainer")
local Font = require("ui/font")
local Geom = require("ui/geometry")
local HorizontalGroup = require("ui/widget/horizontalgroup")
local HorizontalSpan = require("ui/widget/horizontalspan")
local InfoMessage = require("ui/widget/infomessage")
local LineWidget = require("ui/widget/linewidget")
local NetworkMgr = require("ui/network/manager")
local Screen = require("device").screen
local Size = require("ui/size")
local TextBoxWidget = require("ui/widget/textboxwidget")
local TextWidget = require("ui/widget/textwidget")
local UIManager = require("ui/uimanager")
local VerticalGroup = require("ui/widget/verticalgroup")
local VerticalSpan = require("ui/widget/verticalspan")
local T = require("ffi/util").template
local _ = require("gettext")

local Capabilities = require("bookorbit_capabilities")
local CatalogUtil = require("bookorbit_catalog_util")
local CatalogWidgets = require("bookorbit_catalog_widgets")
local DashboardSections = require("bookorbit_dashboard_sections")
local BookOrbitStatsReader = require("bookorbit_stats_reader")

local formatDuration = CatalogUtil.formatDuration
local formatProgress = CatalogUtil.formatProgress
local formatRelativeTime = CatalogUtil.formatRelativeTime
local readingStreakDays = CatalogUtil.readingStreakDays

local BookOrbitDashboardCoverCard = CatalogWidgets.DashboardCoverCard
local BookOrbitDashboardHeroCard = CatalogWidgets.DashboardHeroCard
local BookOrbitDashboardHighlightCard = CatalogWidgets.DashboardHighlightCard
local BookOrbitDashboardBrowseRow = CatalogWidgets.DashboardBrowseRow
local BookOrbitDashboardIconButton = CatalogWidgets.DashboardIconButton

-- How long the local reading-stats summary is reused before re-querying
-- statistics.sqlite3 (the dashboard re-renders on every row page turn).
local STATS_CACHE_TTL = 120
-- Six columns is what makes a two-up Continue reading card exactly three shelf
-- columns wide at any screen size: one for its cover, two for its text. That is
-- also the width the hero sizes its cover from, so the two rows agree.
local SECTION_TARGET_SLOTS = 6
local SECTION_COMPACT_GAP = 6
local STATS_MIN_BODY_HEIGHT = 56
local SECTION_PAGE_PREFIX = "section"
-- Books requested per shelf. Mirrors DASHBOARD_SECTION_LIMIT on the server so
-- a shelf and the dashboard body it may be served from hold the same count.
local SHELF_PAGE_SIZE = 12
-- Cover cards never get narrower than this, however tight the page is.
local SHELF_MIN_CARD_WIDTH = 72
-- Bounds on the Continue reading hero, which is otherwise sized to match the
-- shelf cover.
local HERO_MIN_HEIGHT = 76
local HERO_MAX_HEIGHT = 170
-- Header controls are drawn inside the section header's label row, so the row
-- stays as tall as a header without controls; the tap box reaches into the gap
-- above and below it to stay finger-sized.
local HEADER_CONTROL_ICON = 19
local HEADER_CONTROL_TAP_PAD = 9
-- The seven-day activity chart inside the stats strip.
local WEEK_BAR_MAX_HEIGHT = 18
local WEEK_BAR_WIDTH = 5
local WEEK_BAR_GAP = 3
-- Breathing room above and below the stats blocks, inside the strip's rules.
local STATS_BODY_PADDING = 6
-- The marker a stats block shows between its value and its label when it has
-- no sparkline of its own.
local STATS_ICON_SIZE = 20

local CatalogDashboard = {}

local function isDashboardUnsupported(err)
    return err == 404 or err == 405
end

function CatalogDashboard:dashboardCache()
    local cache = self.settings.catalog_dashboard_cache
    return type(cache) == "table" and cache or nil
end

function CatalogDashboard:cacheDashboard(body)
    if type(body) ~= "table" then return end
    self:persistSetting("catalog_dashboard_cache", body)
    self:persistSetting("catalog_dashboard_cache_section", DashboardSections.settingsSignature(self.settings))
end

function CatalogDashboard:dashboardCacheMatchesSection()
    return self.settings.catalog_dashboard_cache_section == DashboardSections.settingsSignature(self.settings)
end

function CatalogDashboard:dashboardConfiguredSection(index)
    return DashboardSections.at(self.settings, index or 1)
end

function CatalogDashboard.dashboardSlotSection(body, index)
    if type(body) ~= "table" or type(body.dashboardSlots) ~= "table" then return nil end
    local section = body.dashboardSlots[index]
    return type(section) == "table" and section or nil
end

function CatalogDashboard.dashboardSlotBooks(body, index)
    local section = CatalogDashboard.dashboardSlotSection(body, index)
    return section and section.books or {}
end

function CatalogDashboard.dashboardItems()
    return {
        {
            text = _("Dashboard"),
            kind = "dashboard",
        },
    }
end

local function greetingForHour(hour)
    if hour >= 5 and hour < 12 then
        return _("Good morning"), _("Good morning, %1")
    elseif hour >= 12 and hour < 18 then
        return _("Good afternoon"), _("Good afternoon, %1")
    end
    return _("Good evening"), _("Good evening, %1")
end

function CatalogDashboard:dashboardSubtitle(dashboard)
    local username = dashboard and (dashboard.displayName or dashboard.name or dashboard.username)
        or (self.settings and self.settings.username)
    local plain, templated = greetingForHour(tonumber(os.date("%H")) or 12)
    if type(username) == "string" and username ~= "" then
        return T(templated, username)
    end
    return plain
end

function CatalogDashboard:dashboardContext(dashboard, opts)
    opts = opts or {}
    return self.dashboardItems(), {
        kind = "dashboard",
        title = self.title,
        subtitle = self:dashboardSubtitle(dashboard),
        dashboard = dashboard,
        stale = opts.stale == true,
        unavailable = opts.unavailable == true,
        loading = opts.loading == true,
        section_stale = opts.section_stale,
    }
end

-- A cached body is served whole, but its configurable row is only trusted when
-- it was fetched for the section that is configured now.
function CatalogDashboard:cachedDashboardContext(cached, opts)
    opts = opts or {}
    opts.stale = true
    if not self:dashboardCacheMatchesSection() then
        opts.section_stale = {}
        for index = 1, DashboardSections.SLOT_COUNT do
            opts.section_stale[index] = true
        end
    end
    return self:dashboardContext(cached, opts)
end

-- What the catalog widget opens on, built without touching the network: the
-- cached dashboard when there is one, otherwise a placeholder the pending
-- refresh replaces in place.
function CatalogDashboard:initialDashboardContext()
    local cached = self:dashboardCache()
    if cached then
        return self:cachedDashboardContext(cached)
    end
    if self:shouldRefreshDashboardOnOpen() then
        return self:dashboardContext(nil, { stale = true, loading = true })
    end
    return self:dashboardContext(nil, { stale = true, unavailable = true })
end

-- An offline-tolerant open (auto-open, offline browse) never asks for a
-- connection on its own; only an explicit browse goes through the connected
-- gate.
function CatalogDashboard:shouldRefreshDashboardOnOpen()
    if self.prefer_cached_dashboard and not NetworkMgr:isConnected() then
        return false
    end
    return true
end

function CatalogDashboard:dashboardRoot(opts)
    local function requestIsCurrent()
        return not opts or not opts.is_current or opts.is_current()
    end
    local cached = self:dashboardCache()
    if self.prefer_cached_dashboard and cached and not NetworkMgr:isConnected() then
        return self:cachedDashboardContext(cached)
    end

    local body, err = self:fetch(_("Loading dashboard..."), function()
        return self.client:catalogDashboard()
    end, opts)
    if body and body.continueReading then
        local function fetchSection(config)
            if not requestIsCurrent() then return nil, "cancelled" end
            if config.type == DashboardSections.DEFAULT_TYPE then
                if type(body.discover) == "table" then
                    return { type = config.type, books = body.discover }
                end
                local response, discover_err = self:fetch(_("Loading dashboard..."), function()
                    return self.client:catalogDiscover()
                end, opts)
                if discover_err or type(response) ~= "table" then
                    return nil, discover_err or "invalid response"
                end
                return { type = config.type, books = response.discover or {} }
            end
            -- Sources without a catalog-books equivalent go through the server's
            -- dashboard-section endpoint. A confirmed 404/405 downgrades the
            -- capability so the picker stops offering them against this server.
            if DashboardSections.usesSectionEndpoint(config.type) then
                local known = Capabilities.cached(self.client)
                if known and not known[DashboardSections.SECTION_ENDPOINT_CAPABILITY] then
                    return { type = config.type, books = {} }
                end
                local response, section_err = self:fetch(_("Loading dashboard..."), function()
                    return self.client:catalogDashboardSection(config.type)
                end, opts)
                if isDashboardUnsupported(section_err) then
                    Capabilities.markUnsupported(self.client, DashboardSections.SECTION_ENDPOINT_CAPABILITY)
                    return { type = config.type, books = {} }
                end
                if section_err or type(response) ~= "table" then
                    return nil, section_err or "invalid response"
                end
                local section = type(response.section) == "table" and response.section or {}
                return { type = config.type, books = section.books or {} }
            end

            local params = { page = 1, size = SHELF_PAGE_SIZE }
            if config.type == "recently-added" then
                params.sort = "recently_added"
            elseif config.type == "in-progress" then
                params.sort = "recently_read"
                params.readStatus = "reading"
            elseif DashboardSections.isCatalogSelector(config.type) then
                for key, value in pairs(config.params or {}) do params[key] = value end
            else
                return nil
            end
            local response, section_err = self:fetch(_("Loading dashboard..."), function()
                return self.client:catalogBooks(params)
            end, opts)
            if section_err or type(response) ~= "table" then return nil, section_err or "invalid response" end
            return { type = config.type, books = response.items or {} }
        end

        -- Slots pointing at the same source cost one request between them, and
        -- a source that failed is not retried by the next slot that wants it.
        body.dashboardSlots = {}
        local shelves = {}
        for index = 1, DashboardSections.SLOT_COUNT do
            if not requestIsCurrent() then return nil, "cancelled" end
            local config = DashboardSections.at(self.settings, index)
            local slot = { type = config.type, smartScopeId = config.params and config.params.smartScopeId }
            if DashboardSections.isBookSource(config.type) then
                local signature = DashboardSections.signature(config)
                local books = shelves[signature]
                if not books then
                    local section, section_err = fetchSection(config)
                    if section_err == "cancelled" then return nil, section_err end
                    books = section_err and {} or (section and section.books or {})
                    shelves[signature] = books
                end
                slot.books = books
            end
            body.dashboardSlots[index] = slot
        end
        self:cacheDashboard(body)
        return self:dashboardContext(body)
    end

    if isDashboardUnsupported(err) then
        if requestIsCurrent() then
            UIManager:show(InfoMessage:new{
                text = _("BookOrbit dashboard needs a newer server. Showing the catalog instead."),
                timeout = 4,
            })
        end
        return self:rootItems(), { kind = "root", title = self.title }
    end

    if cached then
        return self:cachedDashboardContext(cached)
    end

    if err ~= "cancelled" and requestIsCurrent() then
        self:showServerError(err)
    end
    return self:dashboardContext(nil, { stale = true, unavailable = true })
end

function CatalogDashboard:loadDashboardRoot(replace, opts)
    self.dashboard_request_generation = (self.dashboard_request_generation or 0) + 1
    local request_generation = self.dashboard_request_generation
    local expected_context = self.current_context
    local request_opts = {}
    for key, value in pairs(opts or {}) do request_opts[key] = value end
    request_opts.is_current = function()
        return not self.catalog_closed
            and request_generation == self.dashboard_request_generation
            and self.current_context == expected_context
    end
    self:runConnected(function()
        local items, context = self:dashboardRoot(request_opts)
        if self.catalog_closed or request_generation ~= self.dashboard_request_generation
                or self.current_context ~= expected_context then
            return
        end
        self:switchTo(context.title or self.title, items, context, not replace)
    end)
end

-- All books available to dashboard slots, used for thumbnail prefetching and
-- cover-cache eviction. Each grid source carries up to twelve books.
function CatalogDashboard.dashboardBooks(dashboard)
    dashboard = dashboard or {}
    local books = {}
    for _, book in ipairs(dashboard.continueReading or {}) do
        table.insert(books, book)
    end
    for index = 1, DashboardSections.SLOT_COUNT do
        for _, book in ipairs(CatalogDashboard.dashboardSlotBooks(dashboard, index)) do
            table.insert(books, book)
        end
    end
    return books
end

function CatalogDashboard:dashboardActionEntries(total_books)
    return {
        {
            text = _("In progress"),
            icon = "dogear.reading",
            icon_file = CatalogWidgets.assetIconFile("in_progress"),
            kind = "books",
            params = { sort = "recently_read", readStatus = "reading" },
        },
        {
            text = _("On device"),
            icon = "appbar.filebrowser",
            mandatory = tostring(self:onDeviceCount()),
            kind = "on-device",
        },
        {
            text = _("Libraries"),
            icon = "column.two",
            kind = "section",
            section = "libraries",
        },
        {
            text = _("All Books"),
            icon = "appbar.pageview",
            mandatory = total_books and tostring(total_books) or nil,
            kind = "books",
            params = { sort = "title" },
        },
        {
            text = _("Authors"),
            icon = "bookmark",
            kind = "section",
            section = "authors",
        },
        {
            text = _("Series"),
            icon = "book.opened",
            kind = "section",
            section = "series",
        },
        {
            text = _("Collections"),
            icon = "texture-box",
            icon_file = CatalogWidgets.assetIconFile("collections"),
            kind = "section",
            section = "collections",
        },
        {
            text = _("SmartScopes"),
            icon = "cre.render.working",
            kind = "section",
            section = "smart-scopes",
        },
        {
            text = _("Search"),
            icon = "appbar.search",
            kind = "dashboard-search",
        },
    }
end

function CatalogDashboard:addDashboardSpacer(height)
    if not height or height <= 0 then return end
    table.insert(self.item_group, VerticalSpan:new{ width = height })
    self.dash_used = self.dash_used + height
end

-- Insert a widget (built at self.content_w) flush within the dashboard's
-- horizontal margins. Tappable widgets are also registered for focus nav.
function CatalogDashboard:addDashboardInset(widget, tappable)
    table.insert(self.item_group, HorizontalGroup:new{
        align = "center",
        HorizontalSpan:new{ width = self.content_inset },
        widget,
        HorizontalSpan:new{ width = self.content_inset },
    })
    self.dash_used = self.dash_used + widget:getSize().h
    if tappable then
        table.insert(self.layout, { widget })
    end
end

-- Section headers reuse the detail page's tab idiom: an uppercase label on a
-- thick underline running into a hairline rule. Controls (paging chevrons,
-- the Discover reroll) are pinned to the header's right edge so the rows
-- below keep the full content width and stay aligned with the margins.
-- focus_controls names the tappable subset when controls also carries
-- display-only widgets such as the page indicator.
function CatalogDashboard:addDashboardHeader(text, controls, focus_controls)
    local right
    if controls and #controls > 0 then
        right = HorizontalGroup:new{ align = "center" }
        for index, control in ipairs(controls) do
            if index > 1 then
                -- The control boxes already carry padding around their glyphs;
                -- a wide span on top of that scatters the cluster.
                table.insert(right, HorizontalSpan:new{ width = Size.span.horizontal_small })
            end
            table.insert(right, control)
        end
    end
    self:addDashboardInset(CatalogWidgets.buildDashboardSectionHeader(text, self.content_w, right))
    local focus_row = focus_controls or controls
    if focus_row and #focus_row > 0 then
        table.insert(self.layout, focus_row)
    end
end

-- Reshuffling only means something for a random row; every other source has a
-- defined order the server chose.
function CatalogDashboard:dashboardSectionSupportsReroll(config)
    return (config or {}).type == DashboardSections.DEFAULT_TYPE
end

-- Every header control is a square the size of the header's label row, so the
-- controls fill that row rather than making the header taller than one without
-- them.
function CatalogDashboard:buildDashboardHeaderControl(opts)
    local size = CatalogWidgets.dashboardSectionHeaderRowHeight()
    return BookOrbitDashboardIconButton:new{
        entry = opts.entry,
        dimen = Geom:new{ x = 0, y = 0, w = size, h = size },
        icon_size = Screen:scaleBySize(HEADER_CONTROL_ICON),
        tap_padding_v = Screen:scaleBySize(HEADER_CONTROL_TAP_PAD),
        enabled = opts.enabled,
        callback = opts.callback,
        menu = self,
    }
end

function CatalogDashboard:buildDashboardRerollButton(index)
    return self:buildDashboardHeaderControl{
        entry = {
            kind = "dashboard-reroll",
            section_index = index or 1,
            icon = "cre.render.reload",
            icon_file = CatalogWidgets.assetIconFile("shuffle"),
        },
    }
end

-- Paging chevrons for a section header, with a "page/pages" indicator between
-- them so a shelf's extent is visible.
function CatalogDashboard:buildDashboardHeaderNav(section_id, page, page_count)
    local function navButton(icon, enabled, delta)
        return self:buildDashboardHeaderControl{
            entry = { icon = icon },
            enabled = enabled,
            callback = function()
                self:turnDashboardPage(section_id, delta)
            end,
        }
    end
    local indicator = TextWidget:new{
        text = tostring(page) .. "/" .. tostring(page_count),
        face = Font:getFace("cfont", 12),
        fgcolor = Blitbuffer.COLOR_DARK_GRAY,
    }
    return navButton("chevron.left", page > 1, -1), navButton("chevron.right", page < page_count, 1), indicator
end

function CatalogDashboard:dashboardPage(section_id, page_count)
    local context = self.current_context or {}
    context.dash_pages = context.dash_pages or {}
    local page = tonumber(context.dash_pages[section_id]) or 1
    page = math.max(1, math.min(page, page_count))
    context.dash_pages[section_id] = page
    return page
end

function CatalogDashboard:turnDashboardPage(section_id, delta)
    local context = self.current_context or {}
    context.dash_pages = context.dash_pages or {}
    context.dash_pages[section_id] = math.max(1, (tonumber(context.dash_pages[section_id]) or 1) + delta)
    -- A page turn changes one section band and nothing else, so only that band
    -- needs an e-ink refresh; the rebuild below records the band's position.
    self.dash_refresh_section = section_id
    self:updateItems(nil, true)
end

function CatalogDashboard:dashboardHeroMetaText(book)
    local parts = {}
    local progress = formatProgress(book.progressPercentage)
    if progress then
        table.insert(parts, T(_("%1 read"), progress))
    else
        local status = self:readStatusLabel(book)
        if status then table.insert(parts, status) end
    end
    local recency = formatRelativeTime(book.lastReadAt)
    if recency then
        table.insert(parts, recency)
    end
    if self:isOnDevice(book) then
        table.insert(parts, _("On device"))
    end
    return #parts > 0 and table.concat(parts, " - ") or nil
end

function CatalogDashboard:buildDashboardHeroCard(book, width, height)
    return BookOrbitDashboardHeroCard:new{
        entry = {
            kind = "dashboard-book",
            book_id = book.id,
            book = book,
            resume = true,
            meta_text = self:dashboardHeroMetaText(book),
        },
        dimen = Geom:new{ x = 0, y = 0, w = width, h = height },
        menu = self,
    }
end

-- Hero cards per page: two side by side, one on narrow screens or when only
-- one book is in progress.
function CatalogDashboard:dashboardHeroSlots(count)
    if count <= 1 then return 1 end
    return self.content_w >= Screen:scaleBySize(420) and 2 or 1
end

-- The Continue-reading hero row: full-width hero cards side by side, paged
-- through all in-progress books via the chevrons in the section header (the
-- e-ink take on a horizontal scroll).
function CatalogDashboard:addDashboardHeroRow(books, height, slots, page)
    local gap = self.dash_inner_gap
    local card_w = math.floor((self.content_w - (slots - 1) * gap) / slots)
    local first = (page - 1) * slots + 1

    local row = HorizontalGroup:new{ align = "center" }
    local focus_row = {}
    table.insert(row, HorizontalSpan:new{ width = self.content_inset })
    for slot = 1, slots do
        if slot > 1 then
            table.insert(row, HorizontalSpan:new{ width = gap })
        end
        local book = books[first + slot - 1]
        if book then
            local card = self:buildDashboardHeroCard(book, card_w, height)
            table.insert(row, card)
            table.insert(focus_row, card)
        else
            table.insert(row, HorizontalSpan:new{ width = card_w })
        end
    end
    table.insert(row, HorizontalSpan:new{ width = self.content_inset })
    table.insert(self.item_group, row)
    if #focus_row > 0 then
        table.insert(self.layout, focus_row)
    end
    self.dash_used = self.dash_used + height
end

function CatalogDashboard:sectionRowMetrics(count, gap)
    local slots = math.min(SECTION_TARGET_SLOTS, count)
    gap = gap or self.dash_inner_gap
    local min_card_w = Screen:scaleBySize(SHELF_MIN_CARD_WIDTH)
    while slots > 1
        and math.floor((self.content_w - (slots - 1) * gap) / slots) < min_card_w do
        slots = slots - 1
    end
    local card_w = math.max(min_card_w, math.floor((self.content_w - (slots - 1) * gap) / slots))
    return slots, card_w, CatalogWidgets.coverCardHeight(card_w, false, false)
end

-- Shelf geometry under a vertical budget. A cover card's height follows from
-- its width, so a shelf that is too tall gets more, narrower cards per row
-- rather than cards drawn out of aspect. The row can still exceed max_height
-- once the cards hit their minimum width; the caller decides what to do then.
function CatalogDashboard:shelfRowMetrics(count, gap, max_height)
    local slots, card_w, row_h = self:sectionRowMetrics(count, gap)
    if not max_height then return slots, card_w, row_h end
    local min_card_w = Screen:scaleBySize(SHELF_MIN_CARD_WIDTH)
    while row_h > max_height do
        local next_card_w = math.floor((self.content_w - slots * gap) / (slots + 1))
        if next_card_w < min_card_w then break end
        slots, card_w = slots + 1, next_card_w
        row_h = CatalogWidgets.coverCardHeight(card_w, false, false)
    end
    return slots, card_w, row_h
end

-- A paged row of cover cards, evenly distributed across the full
-- content width. Paging is driven by the chevrons in the section header.
function CatalogDashboard:addDashboardCoverRow(
    _section_id, books, height, with_progress, with_caption, slots, card_w, page, first_index)
    local first = first_index or ((page - 1) * slots + 1)
    local card_gap = slots > 1 and math.floor(math.max(0, self.content_w - slots * card_w) / (slots - 1)) or 0

    local row = HorizontalGroup:new{ align = "center" }
    local focus_row = {}
    table.insert(row, HorizontalSpan:new{ width = self.content_inset })
    for slot = 1, slots do
        if slot > 1 then
            table.insert(row, HorizontalSpan:new{ width = card_gap })
        end
        local book = books[first + slot - 1]
        if book then
            local card = BookOrbitDashboardCoverCard:new{
                entry = { kind = "dashboard-book", book_id = book.id, book = book },
                show_caption = with_caption == true,
                show_progress = with_progress == true,
                reserve_progress = with_progress == true,
                quiet_placeholder = with_caption ~= true,
                dimen = Geom:new{ x = 0, y = 0, w = card_w, h = height },
                menu = self,
            }
            table.insert(row, card)
            table.insert(focus_row, card)
        else
            table.insert(row, HorizontalSpan:new{ width = card_w })
        end
    end
    table.insert(row, HorizontalSpan:new{ width = self.content_inset })
    table.insert(self.item_group, row)
    if #focus_row > 0 then
        table.insert(self.layout, focus_row)
    end
    self.dash_used = self.dash_used + height
end

function CatalogDashboard:addDashboardCoverGrid(
    section_id, books, height, with_progress, with_caption, slots, card_w, page, rows)
    rows = math.max(1, rows or 1)
    local first = (page - 1) * slots * rows + 1
    for row = 1, rows do
        self:addDashboardCoverRow(section_id, books, height, with_progress, with_caption, slots, card_w, 1, first)
        first = first + slots
        if row < rows then
            self:addDashboardSpacer(self.dash_inner_gap)
        end
    end
end

-- A friendlier empty/unavailable state than a bare status line: a short
-- centered message with an optional borderless action button underneath.
function CatalogDashboard:addDashboardEmptyState(text, button_text, callback)
    local col = VerticalGroup:new{ align = "center" }
    table.insert(col, TextBoxWidget:new{
        text = text,
        width = self.content_w,
        alignment = "center",
        fgcolor = Blitbuffer.COLOR_DARK_GRAY,
        face = Font:getFace("cfont", 14),
    })
    if not button_text then
        self:addDashboardInset(col)
        return
    end
    local button = Button:new{
        text = button_text,
        bordersize = 0,
        margin = 0,
        text_font_size = 14,
        text_font_bold = true,
        callback = callback,
    }
    table.insert(col, VerticalSpan:new{ width = Size.span.vertical_default })
    table.insert(col, CenterContainer:new{
        dimen = Geom:new{ w = self.content_w, h = button:getSize().h },
        button,
    })
    self:addDashboardInset(col)
    table.insert(self.layout, { button })
end

-- A muted status line shown while the dashboard renders cached data, built
-- from the generatedAt timestamp the cached body carries.
function CatalogDashboard:buildDashboardStatusLine(dashboard)
    local updated = formatRelativeTime(dashboard and dashboard.generatedAt)
    local text
    if NetworkMgr:isConnected() then
        text = updated and T(_("Showing cached dashboard - updated %1"), updated)
            or _("Showing cached dashboard")
    else
        text = updated and T(_("Offline - updated %1"), updated)
            or _("Offline - showing cached dashboard")
    end
    return CatalogWidgets.buildStatusLabel(text, self.content_w, nil, "center")
end

-- Local reading activity from statistics.sqlite3, cached briefly so row page
-- turns do not reopen the database. The local streak is retained as a fallback
-- for cached responses from servers that do not provide the account streak.
function CatalogDashboard:dashboardStatsSummary()
    local cache = self._dash_stats_cache
    if not cache or os.time() - cache.at >= STATS_CACHE_TTL then
        cache = { summary = BookOrbitStatsReader.getReadingSummary(), at = os.time() }
        self._dash_stats_cache = cache
    end
    local summary = cache.summary
    if not summary then return nil end
    if (summary.today_seconds or 0) == 0 and (summary.week_seconds or 0) == 0
        and (summary.streak_days or 0) == 0 then
        return nil
    end
    return summary
end

-- The last seven days as bar heights, oldest first, normalized to the busiest
-- day. Falls back to the account streak's read/not-read days when local
-- statistics carry nothing, and to nil when neither side has data.
local function weekBarData(summary, dashboard)
    local day_seconds = type(summary.day_seconds) == "table" and summary.day_seconds or {}
    local values, max_value = {}, 0
    for day = 1, 7 do
        local value = tonumber(day_seconds[day]) or 0
        values[day] = value
        max_value = math.max(max_value, value)
    end
    if max_value > 0 then return values, max_value end
    local reading_streak = dashboard and dashboard.readingStreak
    local last_seven = type(reading_streak) == "table" and reading_streak.lastSevenDays or nil
    if type(last_seven) ~= "table" then return nil end
    local any = false
    for day = 1, 7 do
        values[day] = last_seven[day] and 1 or 0
        any = any or values[day] > 0
    end
    if not any then return nil end
    return values, 1
end

-- A seven-day activity chart under the "Past 7 days" value: a bar per day
-- scaled against the busiest one and standing on a shared baseline, today
-- solid black and earlier days dark gray.
function CatalogDashboard:buildDashboardWeekBars(summary, dashboard)
    local values, max_value = weekBarData(summary, dashboard)
    if not values then return nil end
    local max_h = Screen:scaleBySize(WEEK_BAR_MAX_HEIGHT)
    local min_fill = math.max(1, Screen:scaleBySize(2))
    local bar_w = Screen:scaleBySize(WEEK_BAR_WIDTH)
    local gap = Screen:scaleBySize(WEEK_BAR_GAP)
    local row = HorizontalGroup:new{ align = "bottom" }
    for day = 1, 7 do
        if day > 1 then
            table.insert(row, HorizontalSpan:new{ width = gap })
        end
        local fill_h = values[day] > 0
            and math.max(min_fill, math.floor(max_h * values[day] / max_value + 0.5))
            or 0
        table.insert(row, CatalogWidgets.buildDashboardWeekBar(bar_w, max_h, fill_h, day == 7))
    end
    return CatalogWidgets.buildDashboardWeekChart(row)
end

-- Activity blocks separated by hairlines: no boxes, so the strip reads as
-- information rather than competing with the tappable cards. Inventory counts
-- live in the Browse block; the strip keeps to reading activity plus the
-- yearly goal when one is set.
function CatalogDashboard:buildDashboardStatsStrip(summary, dashboard, height)
    local sep_w = Size.line.thin
    local streak_days = readingStreakDays(dashboard, summary.streak_days)
    local week_bars = self:buildDashboardWeekBars(summary, dashboard)
    -- The blocks without a sparkline take an icon in that row instead, so the
    -- strip reads as four equally furnished blocks rather than one chart and
    -- three gaps.
    local icon_size = Screen:scaleBySize(STATS_ICON_SIZE)
    local blocks = {
        {
            value = formatDuration(summary.today_seconds or 0),
            label = _("Today"),
            extra = CatalogWidgets.buildDashboardStatIcon("stat_today", icon_size),
        },
        {
            value = formatDuration(summary.week_seconds or 0),
            label = _("Past 7 days"),
            -- No per-day data to chart (a fresh install, or a server without
            -- the streak) still gets a marker rather than the lone gap.
            extra = week_bars or CatalogWidgets.buildDashboardStatIcon("stat_week", icon_size),
        },
        {
            value = tostring(streak_days),
            label = _("Day streak"),
            extra = CatalogWidgets.buildDashboardStatIcon("stat_streak", icon_size),
        },
    }
    local reading_goal = dashboard and type(dashboard.readingGoal) == "table" and dashboard.readingGoal or nil
    local goal_books = reading_goal and tonumber(reading_goal.goalBooks) or nil
    if goal_books and goal_books > 0 then
        table.insert(blocks, {
            value = tostring(tonumber(reading_goal.completedBooks) or 0) .. " / " .. tostring(goal_books),
            label = reading_goal.year and T(_("%1 goal"), reading_goal.year) or _("Yearly goal"),
            extra = CatalogWidgets.buildDashboardStatIcon("stat_goal", icon_size),
        })
    end

    -- One set of row heights for every block, so the values sit on one baseline
    -- and the labels on another whether a block carries the sparkline or an icon.
    local marker_h = week_bars and week_bars:getSize().h or 0
    for _, block in ipairs(blocks) do
        if block.extra then marker_h = math.max(marker_h, block.extra:getSize().h) end
    end
    local metrics = CatalogWidgets.dashboardStatMetrics(marker_h)
    local block_w = math.floor((self.content_w - (#blocks - 1) * sep_w) / #blocks)
    local row = HorizontalGroup:new{ align = "center" }
    for index, block in ipairs(blocks) do
        if index > 1 then
            table.insert(row, LineWidget:new{
                background = Blitbuffer.COLOR_LIGHT_GRAY,
                dimen = Geom:new{ w = sep_w, h = metrics.total_h },
            })
        end
        table.insert(row, CatalogWidgets.buildDashboardStat(
            block.value, block.label, block_w, block.extra, metrics))
    end
    local line_h = Size.line.thin
    local padded_h = row:getSize().h + 2 * Screen:scaleBySize(STATS_BODY_PADDING)
    local body_h = height and math.max(padded_h, height - 2 * line_h)
        or math.max(padded_h, Screen:scaleBySize(STATS_MIN_BODY_HEIGHT))
    return VerticalGroup:new{
        align = "center",
        LineWidget:new{
            background = Blitbuffer.COLOR_LIGHT_GRAY,
            dimen = Geom:new{ w = self.content_w, h = line_h },
        },
        CenterContainer:new{
            dimen = Geom:new{ w = self.content_w, h = body_h },
            row,
        },
        LineWidget:new{
            background = Blitbuffer.COLOR_LIGHT_GRAY,
            dimen = Geom:new{ w = self.content_w, h = line_h },
        },
    }
end

function CatalogDashboard:addDashboardBrowseList(entries, row_h, cols, rows)
    local col_gap = Screen:scaleBySize(24)
    local col_w = math.floor((self.content_w - (cols - 1) * col_gap) / cols)
    rows = rows or math.ceil(#entries / cols)
    for row_index = 1, rows do
        local index = (row_index - 1) * cols + 1
        local row = HorizontalGroup:new{ align = "center" }
        local focus_row = {}
        table.insert(row, HorizontalSpan:new{ width = self.content_inset })
        for col = 0, cols - 1 do
            local entry = entries[index + col]
            if col > 0 then
                table.insert(row, HorizontalSpan:new{ width = col_gap })
            end
            if entry then
                local item = BookOrbitDashboardBrowseRow:new{
                    entry = entry,
                    dimen = Geom:new{ x = 0, y = 0, w = col_w, h = row_h },
                    menu = self,
                }
                table.insert(row, item)
                table.insert(focus_row, item)
            else
                table.insert(row, HorizontalSpan:new{ width = col_w })
            end
        end
        table.insert(row, HorizontalSpan:new{ width = self.content_inset })
        table.insert(self.item_group, row)
        if #focus_row > 0 then
            table.insert(self.layout, focus_row)
        end
        self.dash_used = self.dash_used + row_h
    end
end

function CatalogDashboard:recalculateDashboardDimen()
    self.perpage = 1
    self.page = 1
    self.page_num = 1
    local top_height, bottom_height = self:menuChromeHeight()
    self.available_height = self.inner_dimen.h - top_height - bottom_height
    self.content_inset = Size.padding.large
    self.content_w = math.max(1, self.inner_dimen.w - 2 * self.content_inset)
    self.item_dimen = Geom:new{
        x = 0,
        y = 0,
        w = self.inner_dimen.w,
        h = self.available_height,
    }
end

function CatalogDashboard:updateDashboardItems(select_number, no_recalculate_dimen)
    local old_dimen = self:prepareCustomUpdate(no_recalculate_dimen)
    self:ensureOnDeviceCurrent()
    local context = self.current_context or {}
    local dashboard = context.dashboard or {}
    local continue_books = dashboard.continueReading or {}
    local action_entries = self:dashboardActionEntries(tonumber(dashboard.totalBooks or dashboard.bookCount))
    local summary = self:dashboardStatsSummary() or { today_seconds = 0, week_seconds = 0, streak_days = 0 }
    local stale_sections = type(context.section_stale) == "table" and context.section_stale or {}
    local highlight = type(dashboard.highlightOfTheDay) == "table" and dashboard.highlightOfTheDay or nil

    local function px(n) return Screen:scaleBySize(n) end
    local avail = self.available_height
    local inner_gap = px(9)
    -- Lets the greeting in the title bar breathe before the first section
    -- starts, rather than the stats rule sitting right under it.
    local top_gap = px(10)
    local section_gap = px(20)
    local compact_gap = px(SECTION_COMPACT_GAP)
    self.dash_inner_gap = inner_gap
    self.dash_used = 0
    self.dash_section_bands = {}

    local header_h = CatalogWidgets.buildDashboardSectionHeader("X", self.content_w):getSize().h
    local browse_row_h = px(42)
    local browse_cols = 3
    local browse_rows = 3
    -- A provisional height: once the shelves have settled their column width the
    -- hero is re-sized from their cover, below.
    local hero_h = math.min(px(HERO_MAX_HEIGHT), math.max(px(HERO_MIN_HEIGHT), math.floor(avail * 0.18)))

    local status_widget
    if context.stale and not context.loading and context.dashboard then
        status_widget = self:buildDashboardStatusLine(dashboard)
    end
    local status_h = status_widget and (status_widget:getSize().h + compact_gap) or 0

    local configs = {}
    local stats_widgets = {}
    local highlight_heights = {}
    local hidden = {}
    for index = 1, DashboardSections.SLOT_COUNT do
        configs[index] = DashboardSections.at(self.settings, index)
    end

    local function isShelf(config)
        return DashboardSections.isBookSource(config.type)
    end

    -- Slots with a native renderer take the height they need; the shelves share
    -- whatever is left of the page.
    local function measureFixed()
        local fixed = top_gap + status_h
        local shelf_count = 0
        local max_shelf_books = 0
        local visible = 0
        for index = 1, DashboardSections.SLOT_COUNT do
            if not hidden[index] then
                visible = visible + 1
                local config = configs[index]
                if config.type == "stats" then
                    stats_widgets[index] = stats_widgets[index] or self:buildDashboardStatsStrip(summary, dashboard)
                    local stats_widget = stats_widgets[index]
                    fixed = fixed + (stats_widget and stats_widget:getSize().h or px(STATS_MIN_BODY_HEIGHT)) + section_gap
                elseif config.type == "continue-reading" then
                    fixed = fixed + header_h + inner_gap + hero_h + section_gap
                elseif config.type == "browse" then
                    fixed = fixed + header_h + inner_gap + browse_rows * browse_row_h + section_gap
                elseif config.type == "highlight" then
                    highlight_heights[index] = highlight_heights[index]
                        or (highlight and CatalogWidgets.dashboardHighlightCardHeight(highlight, self.content_w) or px(48))
                    fixed = fixed + header_h + inner_gap + highlight_heights[index] + section_gap
                else
                    shelf_count = shelf_count + 1
                    max_shelf_books = math.max(max_shelf_books, #self.dashboardSlotBooks(dashboard, index))
                    fixed = fixed + header_h + inner_gap + section_gap
                end
            end
        end
        -- The gap separates sections, so the last one does not carry one: that
        -- space belongs to the page's bottom margin, not to the section.
        if visible > 0 then fixed = fixed - section_gap end
        return fixed, shelf_count, max_shelf_books
    end

    local fixed_h, shelf_count, max_shelf_books = measureFixed()
    local shelf_slots, shelf_card_w, shelf_row_h = 0, 0, 0

    local function pageFits()
        if shelf_count == 0 then
            shelf_slots, shelf_card_w, shelf_row_h = 0, 0, 0
            return fixed_h <= avail
        end
        shelf_slots, shelf_card_w, shelf_row_h = self:shelfRowMetrics(
            math.max(1, max_shelf_books), compact_gap,
            math.floor(math.max(0, avail - fixed_h) / shelf_count))
        return fixed_h + shelf_count * shelf_row_h <= avail
    end

    -- Too many slots for the page: the stats strip goes first, since it only
    -- summarises what the reader can reach elsewhere, then the highlight card,
    -- then shelves bottom-up.
    local function slotToDrop()
        for index = 1, DashboardSections.SLOT_COUNT do
            if not hidden[index] and configs[index].type == "stats" then return index end
        end
        for index = 1, DashboardSections.SLOT_COUNT do
            if not hidden[index] and configs[index].type == "highlight" then return index end
        end
        for index = DashboardSections.SLOT_COUNT, 1, -1 do
            if not hidden[index] and isShelf(configs[index]) then return index end
        end
    end

    local function fitPage()
        while not pageFits() do
            local drop = slotToDrop()
            if not drop then break end
            hidden[drop] = true
            fixed_h, shelf_count, max_shelf_books = measureFixed()
        end
    end

    fitPage()

    -- Now that the shelves have settled their column width, grow Continue
    -- reading so its cover is the same size as a shelf cover rather than the
    -- smallest cover on the page. Only taken when it costs nothing: a page too
    -- tight to absorb it keeps the shelf it already has, since a matching hero
    -- is not worth a denser row of covers or a dropped section. pageFits() only
    -- recomputes the shelf metrics, so trying it here changes nothing else.
    if shelf_card_w > 0 then
        local settled_slots = shelf_slots
        local matched = math.min(px(HERO_MAX_HEIGHT),
            math.max(px(HERO_MIN_HEIGHT), CatalogWidgets.dashboardHeroHeightForCoverCard(shelf_card_w)))
        if matched ~= hero_h then
            local provisional = hero_h
            hero_h = matched
            fixed_h, shelf_count, max_shelf_books = measureFixed()
            if not pageFits() or shelf_slots ~= settled_slots then
                hero_h = provisional
                fixed_h, shelf_count, max_shelf_books = measureFixed()
                pageFits()
            end
        end
    end

    self:addDashboardSpacer(top_gap)
    if status_widget then
        self:addDashboardInset(status_widget)
        self:addDashboardSpacer(compact_gap)
    end
    local function renderStats(index)
        self:addDashboardInset(stats_widgets[index])
    end

    local function renderContinueReading(index, config)
        local hero_slots = self:dashboardHeroSlots(#continue_books)
        local hero_pages = #continue_books > 0 and math.max(1, math.ceil(#continue_books / hero_slots)) or 0
        local page_id = "continue" .. tostring(index)
        local hero_page = hero_pages > 0 and self:dashboardPage(page_id, hero_pages) or 1
        local band_start = self.dash_used
        local controls, focus_controls
        if hero_pages > 1 then
            local prev_button, next_button, indicator = self:buildDashboardHeaderNav(page_id, hero_page, hero_pages)
            controls = { prev_button, indicator, next_button }
            focus_controls = { prev_button, next_button }
        end
        self:addDashboardHeader(DashboardSections.headerText(config), controls, focus_controls)
        self:addDashboardSpacer(inner_gap)
        if #continue_books > 0 then
            self:addDashboardHeroRow(continue_books, hero_h, hero_slots, hero_page)
        elseif context.loading then
            self:addDashboardEmptyState(_("Loading dashboard..."))
        elseif context.unavailable then
            self:addDashboardEmptyState(_("The dashboard could not be loaded."), _("Retry"), function() self:refreshCurrent() end)
        else
            self:addDashboardEmptyState(_("Nothing in progress yet."), _("Browse all books"), function()
                self:onMenuSelect({ text = _("All Books"), kind = "books", params = { sort = "title" } })
            end)
        end
        self.dash_section_bands[page_id] = { y = band_start, h = self.dash_used - band_start }
    end

    local function renderBrowse(config)
        self:addDashboardHeader(DashboardSections.headerText(config))
        self:addDashboardSpacer(inner_gap)
        self:addDashboardBrowseList(action_entries, browse_row_h, browse_cols, browse_rows)
    end

    local function renderHighlight(index, config)
        self:addDashboardHeader(DashboardSections.headerText(config))
        self:addDashboardSpacer(inner_gap)
        if highlight then
            local card_h = highlight_heights[index]
                or CatalogWidgets.dashboardHighlightCardHeight(highlight, self.content_w)
            self:addDashboardInset(BookOrbitDashboardHighlightCard:new{
                entry = { kind = "dashboard-highlight", book_id = highlight.bookId, highlight = highlight },
                dimen = Geom:new{ x = 0, y = 0, w = self.content_w, h = card_h },
                menu = self,
            }, highlight.bookId ~= nil)
        elseif context.loading then
            self:addDashboardEmptyState(_("Loading..."))
        else
            self:addDashboardEmptyState(_("No highlights yet."))
        end
    end

    local function renderShelf(index, config)
        local page_id = SECTION_PAGE_PREFIX .. tostring(index)
        local pending = stale_sections[index] == true
        local books = pending and {} or self.dashboardSlotBooks(dashboard, index)
        local slots = math.max(1, math.min(shelf_slots, #books))
        local pages = math.max(1, math.ceil(#books / slots))
        local page = self:dashboardPage(page_id, pages)
        local band_start = self.dash_used
        local controls = {}
        local focus_controls = {}
        if pages > 1 then
            local prev_button, next_button, indicator = self:buildDashboardHeaderNav(page_id, page, pages)
            table.insert(controls, prev_button)
            table.insert(controls, indicator)
            table.insert(controls, next_button)
            table.insert(focus_controls, prev_button)
            table.insert(focus_controls, next_button)
        end
        if not pending and self:dashboardSectionSupportsReroll(config) then
            local reroll_button = self:buildDashboardRerollButton(index)
            table.insert(controls, reroll_button)
            table.insert(focus_controls, reroll_button)
        end
        self:addDashboardHeader(DashboardSections.headerText(config), controls, focus_controls)
        self:addDashboardSpacer(inner_gap)
        if pending or context.loading then
            self:addDashboardEmptyState(_("Loading..."))
        elseif #books == 0 then
            self:addDashboardEmptyState(_("No books found."))
        else
            self:addDashboardCoverGrid(page_id, books, shelf_row_h, false, false, slots, shelf_card_w, page, 1)
        end
        self.dash_section_bands[page_id] = { y = band_start, h = self.dash_used - band_start }
    end

    local rendered = 0
    for index = 1, DashboardSections.SLOT_COUNT do
        if not hidden[index] then
            if rendered > 0 then
                self:addDashboardSpacer(section_gap)
            end
            local config = configs[index]
            if config.type == "stats" then
                renderStats(index)
            elseif config.type == "continue-reading" then
                renderContinueReading(index, config)
            elseif config.type == "browse" then
                renderBrowse(config)
            elseif config.type == "highlight" then
                renderHighlight(index, config)
            else
                renderShelf(index, config)
            end
            rendered = rendered + 1
        end
    end

    self:addDashboardSpacer(math.max(0, avail - self.dash_used))

    -- A page turn recorded which band changed; hand its rect to the refresh so
    -- the rest of the page keeps its e-ink state. Anything unexpected falls
    -- back to the full-region refresh.
    local refresh_section = self.dash_refresh_section
    self.dash_refresh_section = nil
    local band = refresh_section and self.dash_section_bands[refresh_section] or nil
    if band and band.h > 0 and self.dimen and self.menuChromeHeight then
        local top_height = self:menuChromeHeight()
        local pad = px(4)
        local band_y = self.dimen.y + top_height + math.max(0, band.y - pad)
        self.custom_refresh_region = Geom:new{
            x = self.dimen.x,
            y = band_y,
            w = self.dimen.w,
            h = band.h + 2 * pad,
        }
    end
    self:finishCustomUpdate(old_dimen, select_number)
end

-- Replaces one grid slot's books in place, leaving the rest of the dashboard
-- and its cache entry alone.
function CatalogDashboard:applyDashboardSectionBooks(context, books, index)
    index = index or 1
    local dashboard = context and context.dashboard
    if not dashboard then return end
    dashboard.dashboardSlots = dashboard.dashboardSlots or {}
    local slot = dashboard.dashboardSlots[index] or { type = DashboardSections.at(self.settings, index).type }
    slot.books = books
    dashboard.dashboardSlots[index] = slot
    context.dash_pages = context.dash_pages or {}
    context.dash_pages[SECTION_PAGE_PREFIX .. tostring(index)] = 1
    context.section_stale = type(context.section_stale) == "table" and context.section_stale or {}
    context.section_stale[index] = nil
    self:cacheDashboard(dashboard)
    self:scheduleThumbnailDownloads(self.dashboardBooks(dashboard))
    self:updateItems()
end

function CatalogDashboard:rerollDiscover(index)
    if not self:dashboardMode() then return end
    index = index or 1
    self:runConnected(function()
        local body, err = self:fetch(_("Finding books..."), function()
            return self.client:catalogDiscover()
        end)
        if body and body.discover then
            self:applyDashboardSectionBooks(self.current_context, body.discover, index)
        elseif err and err ~= "cancelled" then
            self:showServerError(err)
        end
    end)
end

-- Marks one slot as waiting for the refresh in flight, so books fetched for the
-- previous choice are never presented as the new one.
local function markSlotPending(context, index)
    context.section_stale = type(context.section_stale) == "table" and context.section_stale or {}
    context.section_stale[index] = true
    context.dash_pages = context.dash_pages or {}
    context.dash_pages[SECTION_PAGE_PREFIX .. tostring(index)] = 1
end

function CatalogDashboard:setDashboardSection(config, index)
    index = index or 1
    local normalized = DashboardSections.normalizeEntry(config)
    if DashboardSections.signature(normalized) == DashboardSections.signature(DashboardSections.at(self.settings, index)) then
        return
    end
    self:persistSetting(DashboardSections.SETTING_KEY, DashboardSections.storeAt(self.settings, index, normalized))
    if not self:dashboardMode() then return end
    local context = self.current_context
    if context then
        markSlotPending(context, index)
        self:updateItems()
    end
    self:refreshCurrent()
end

-- Applies a whole slot configuration at once (the settings menu's reset), so
-- the dashboard refreshes once rather than once per changed slot.
function CatalogDashboard:setDashboardSections(sections)
    local normalized = DashboardSections.normalize(sections)
    if DashboardSections.settingsSignature({ [DashboardSections.SETTING_KEY] = normalized })
        == DashboardSections.settingsSignature(self.settings) then
        return
    end
    self:persistSetting(DashboardSections.SETTING_KEY, normalized)
    if not self:dashboardMode() then return end
    local context = self.current_context
    if context then
        for index = 1, DashboardSections.SLOT_COUNT do
            markSlotPending(context, index)
        end
        self:updateItems()
    end
    self:refreshCurrent()
end

function CatalogDashboard.install(Catalog)
    for name, fn in pairs(CatalogDashboard) do
        if name ~= "install" then
            Catalog[name] = fn
        end
    end
end

return CatalogDashboard
