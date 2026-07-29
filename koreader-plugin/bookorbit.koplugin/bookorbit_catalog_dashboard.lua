--[[--
Dashboard mixin for the BookOrbit catalog browser.

Builds and renders the single-page dashboard: a summary stats band, a
Continue-reading hero row (two hero cards side by side, chevron-paged through
all in-progress books), one configurable book row and a compact Browse list,
including the offline cache and the Discover reroll. Installed onto the catalog
controller as regular methods.

The configurable row defaults to Discover and can be pointed at another source
through bookorbit_dashboard_sections. Every source renders identically, so the
layout budget does not depend on which one is chosen.

Layout is budget-driven: fixed blocks are measured first. When the page gets
too tight, the stats strip is dropped first, then the configurable row itself.
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
local readingStreakDays = CatalogUtil.readingStreakDays

local BookOrbitDashboardCoverCard = CatalogWidgets.DashboardCoverCard
local BookOrbitDashboardHeroCard = CatalogWidgets.DashboardHeroCard
local BookOrbitDashboardBrowseRow = CatalogWidgets.DashboardBrowseRow
local BookOrbitDashboardIconButton = CatalogWidgets.DashboardIconButton

-- How long the local reading-stats summary is reused before re-querying
-- statistics.sqlite3 (the dashboard re-renders on every row page turn).
local STATS_CACHE_TTL = 120
local SECTION_TARGET_SLOTS = 5
local SECTION_COMPACT_GAP = 6
local DASHBOARD_TALL_ASPECT_RATIO = 1.55
local SECTION_MAX_ROWS = 2
local STATS_MIN_BODY_HEIGHT = 56
local SECTION_PAGE_ID = "section"

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
    self:persistSetting("catalog_dashboard_cache_section",
        DashboardSections.signature(self:dashboardBodySection(body)))
end

-- True when the cached body holds books for the section the user currently has
-- configured. A mismatch leaves everything else in the cache usable; only the
-- configurable row has to wait for the refresh.
function CatalogDashboard:dashboardCacheMatchesSection()
    return self.settings.catalog_dashboard_cache_section
        == DashboardSections.signature(DashboardSections.primary(self.settings))
end

function CatalogDashboard:dashboardConfiguredSection()
    return DashboardSections.primary(self.settings)
end

-- What a response body actually contains, which is not always what is
-- configured: a server without the capability answers with the legacy Discover
-- row no matter what the user picked, and the header must not claim otherwise.
function CatalogDashboard:dashboardBodySection(body)
    local section = type(body) == "table" and body.section or nil
    if type(section) ~= "table" or not DashboardSections.isValid(section.type) then
        return DashboardSections.defaultConfig()
    end
    local configured = self:dashboardConfiguredSection()
    local scope_name
    if configured.type == "smart-scope" and configured.smartScopeId == section.smartScopeId then
        scope_name = configured.smartScopeName
    end
    return DashboardSections.normalizeEntry({
        type = section.type,
        smartScopeId = section.smartScopeId,
        smartScopeName = scope_name,
    })
end

function CatalogDashboard.dashboardSectionBooks(body)
    if type(body) ~= "table" then return {} end
    if type(body.section) == "table" then return body.section.books or {} end
    return body.discover or {}
end

function CatalogDashboard.dashboardItems()
    return {
        {
            text = _("Dashboard"),
            kind = "dashboard",
        },
    }
end

function CatalogDashboard:dashboardSubtitle(dashboard)
    local username = dashboard and (dashboard.displayName or dashboard.name or dashboard.username)
        or (self.settings and self.settings.username)
    if type(username) == "string" and username ~= "" then
        return T(_("Hi, %1"), username)
    end
    return _("Hi")
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
        section_stale = opts.section_stale == true,
    }
end

-- A cached body is served whole, but its configurable row is only trusted when
-- it was fetched for the section that is configured now.
function CatalogDashboard:cachedDashboardContext(cached, opts)
    opts = opts or {}
    opts.stale = true
    opts.section_stale = not self:dashboardCacheMatchesSection()
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

-- Discover needs no parameter at all. A non-default choice is sent directly;
-- older servers safely fall back to the legacy dashboard in dashboardRoot.
function CatalogDashboard:dashboardSectionRequest()
    local config = self:dashboardConfiguredSection()
    if config.type == DashboardSections.DEFAULT_TYPE then return nil end
    return config
end

function CatalogDashboard:dashboardRoot(opts)
    local function requestIsCurrent()
        return not opts or not opts.is_current or opts.is_current()
    end
    local cached = self:dashboardCache()
    if self.prefer_cached_dashboard and cached and not NetworkMgr:isConnected() then
        return self:cachedDashboardContext(cached)
    end

    local section = self:dashboardSectionRequest()
    local body, err = self:fetch(_("Loading dashboard..."), function()
        return self.client:catalogDashboard(section)
    end, opts)
    -- A server that advertised the capability but rejects the parameter is
    -- answering definitively, so drop back to the legacy shape for the session
    -- rather than leaving the dashboard empty.
    if not body and section and (err == 400 or err == 404) then
        Capabilities.markUnsupported(self.client, DashboardSections.CAPABILITY)
        section = nil
        body, err = self:fetch(_("Loading dashboard..."), function()
            return self.client:catalogDashboard()
        end, opts)
    end
    if body and body.continueReading then
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

-- All books rendered on the dashboard (continue reading + the configurable
-- row), used for thumbnail prefetching and cover-cache eviction.
function CatalogDashboard.dashboardBooks(dashboard)
    dashboard = dashboard or {}
    local books = {}
    for _, book in ipairs(dashboard.continueReading or {}) do
        table.insert(books, book)
    end
    for _, book in ipairs(CatalogDashboard.dashboardSectionBooks(dashboard)) do
        table.insert(books, book)
    end
    return books
end

function CatalogDashboard:dashboardActionEntries()
    return {
        {
            text = _("In progress"),
            icon = "dogear.reading",
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
            kind = "section",
            section = "collections",
        },
        {
            text = _("SmartScopes"),
            icon = "cre.render.working",
            kind = "section",
            section = "smart-scopes",
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
function CatalogDashboard:addDashboardHeader(text, controls)
    local right
    if controls and #controls > 0 then
        right = HorizontalGroup:new{ align = "center" }
        for index, control in ipairs(controls) do
            if index > 1 then
                table.insert(right, HorizontalSpan:new{ width = Size.span.horizontal_default })
            end
            table.insert(right, control)
        end
    end
    self:addDashboardInset(CatalogWidgets.buildDashboardSectionHeader(text, self.content_w, right))
    if controls and #controls > 0 then
        table.insert(self.layout, controls)
    end
end

-- Reshuffling only means something for a random row; every other source has a
-- defined order the server chose.
function CatalogDashboard:dashboardSectionSupportsReroll(config)
    return (config or {}).type == DashboardSections.DEFAULT_TYPE
end

function CatalogDashboard:buildDashboardRerollButton()
    local size = Screen:scaleBySize(24)
    return BookOrbitDashboardIconButton:new{
        entry = { kind = "dashboard-reroll", icon = "cre.render.reload" },
        dimen = Geom:new{ x = 0, y = 0, w = size, h = size },
        menu = self,
    }
end

-- A pair of small borderless paging chevrons for a section header.
function CatalogDashboard:buildDashboardHeaderNav(section_id, page, page_count)
    local size = Screen:scaleBySize(24)
    local function navButton(icon, enabled, delta)
        return Button:new{
            icon = icon,
            icon_width = Screen:scaleBySize(12),
            icon_height = Screen:scaleBySize(12),
            width = size,
            height = size,
            bordersize = 0,
            show_border = false,
            enabled = enabled,
            callback = function()
                self:turnDashboardPage(section_id, delta)
            end,
        }
    end
    return navButton("chevron.left", page > 1, -1), navButton("chevron.right", page < page_count, 1)
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

function CatalogDashboard:dashboardTallLayout()
    return self.inner_dimen.h / math.max(1, self.inner_dimen.w) >= DASHBOARD_TALL_ASPECT_RATIO
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
    local min_card_w = Screen:scaleBySize(72)
    while slots > 1
        and math.floor((self.content_w - (slots - 1) * gap) / slots) < min_card_w do
        slots = slots - 1
    end
    local card_w = math.max(min_card_w, math.floor((self.content_w - (slots - 1) * gap) / slots))
    return slots, card_w, CatalogWidgets.coverCardHeight(card_w, false, false)
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

-- Three plain stat blocks separated by hairlines: no boxes, so the strip
-- reads as information rather than competing with the tappable cards.
function CatalogDashboard:buildDashboardStatsStrip(summary, dashboard, height)
    local sep_w = Size.line.thin
    local today_seconds = summary.today_seconds or 0
    local streak_days = readingStreakDays(dashboard, summary.streak_days)
    local blocks = {
        { value = today_seconds > 0 and formatDuration(today_seconds) or _("Not yet"), label = _("Today") },
        { value = formatDuration(summary.week_seconds or 0), label = _("Past 7 days") },
        { value = tostring(streak_days), label = _("Day streak") },
    }
    local total = dashboard and tonumber(dashboard.totalBooks or dashboard.bookCount)
    if total then
        table.insert(blocks, { value = tostring(total), label = _("Library") })
    end
    table.insert(blocks, { value = tostring(self:onDeviceCount()), label = _("On device") })

    local block_w = math.floor((self.content_w - (#blocks - 1) * sep_w) / #blocks)
    local row = HorizontalGroup:new{ align = "center" }
    for index, block in ipairs(blocks) do
        if index > 1 then
            table.insert(row, LineWidget:new{
                background = Blitbuffer.COLOR_LIGHT_GRAY,
                dimen = Geom:new{ w = sep_w, h = Screen:scaleBySize(18) },
            })
        end
        table.insert(row, CatalogWidgets.buildDashboardStat(block.value, block.label, block_w))
    end
    local line_h = Size.line.thin
    local body_h = height and math.max(row:getSize().h, height - 2 * line_h)
        or math.max(row:getSize().h, Screen:scaleBySize(STATS_MIN_BODY_HEIGHT))
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
    local dashboard = context.dashboard
    local continue_books = dashboard and dashboard.continueReading or {}
    -- A cached body fetched for a different section is not rendered as this
    -- one's content; the row waits for the refresh already in flight.
    local section_pending = context.section_stale == true
    local section_config = section_pending and self:dashboardConfiguredSection()
        or self:dashboardBodySection(dashboard)
    local section_books = section_pending and {} or self.dashboardSectionBooks(dashboard)
    local action_entries = self:dashboardActionEntries()
    local summary = self:dashboardStatsSummary() or { today_seconds = 0, week_seconds = 0, streak_days = 0 }

    local function px(n) return Screen:scaleBySize(n) end
    local avail = self.available_height
    local inner_gap = px(9)
    local top_gap = px(4)
    local stats_gap = px(12)
    local section_gap = px(18)
    self.dash_inner_gap = inner_gap
    self.dash_used = 0

    local has_continue = #continue_books > 0

    local header_h = CatalogWidgets.buildDashboardSectionHeader("X", self.content_w):getSize().h
    local browse_row_h = px(42)
    local browse_cols = 3
    local browse_rows = 3
    local hero_h = has_continue and math.min(px(150), math.max(px(100), math.floor(avail * 0.20))) or 0
    local empty_h = px(72)
    local stats_widget = summary and self:buildDashboardStatsStrip(summary, dashboard) or nil
    local stats_h = stats_widget and stats_widget:getSize().h or 0

    local show_stats = stats_widget ~= nil
    local show_section = #section_books > 0 or section_pending
    local section_row_gap = inner_gap
    local section_slots = 0
    local section_card_w = 0
    local section_row_h = 0
    local section_rows = 1

    local function updateSectionMetrics()
        if show_section and #section_books > 0 then
            section_slots, section_card_w, section_row_h = self:sectionRowMetrics(#section_books, section_row_gap)
        else
            section_slots, section_card_w, section_row_h = 0, 0, 0
        end
    end
    updateSectionMetrics()

    local function sectionGridHeight()
        if not show_section then return 0 end
        if section_pending then return empty_h end
        return section_rows * section_row_h + math.max(0, section_rows - 1) * inner_gap
    end

    -- Fixed blocks are measured up front. If the dashboard gets too tight, the
    -- stats strip drops first, then the configurable row.
    local function fixedHeight()
        local fixed = top_gap
            + (show_stats and (stats_h + stats_gap) or 0)
            + header_h + inner_gap
            + (has_continue and hero_h or empty_h)
            + section_gap
            + (show_section and (header_h + inner_gap + sectionGridHeight() + section_gap) or 0)
            + header_h + inner_gap + browse_rows * browse_row_h
            + inner_gap
        return fixed
    end
    if show_stats and fixedHeight() > avail then
        show_stats = false
    end
    if show_section and fixedHeight() > avail then
        show_section = false
        updateSectionMetrics()
    end
    if show_section and not section_pending then
        local compact_gap = px(SECTION_COMPACT_GAP)
        if compact_gap < section_row_gap then
            local previous_gap = section_row_gap
            local previous_slots, previous_card_w, previous_row_h = section_slots, section_card_w, section_row_h
            section_row_gap = compact_gap
            updateSectionMetrics()
            if fixedHeight() > avail then
                section_row_gap = previous_gap
                section_slots, section_card_w, section_row_h = previous_slots, previous_card_w, previous_row_h
            end
        end
    end
    if show_section and not section_pending and self:dashboardTallLayout() and section_slots > 0 then
        local full_rows = math.floor(#section_books / section_slots)
        local remainder = #section_books % section_slots
        local book_rows = full_rows
        if remainder >= math.ceil(section_slots * 0.5) then
            book_rows = book_rows + 1
        end
        local max_rows = math.min(SECTION_MAX_ROWS, math.max(1, book_rows))
        while section_rows < max_rows do
            section_rows = section_rows + 1
            if fixedHeight() > avail then
                section_rows = section_rows - 1
                break
            end
        end
    end
    if show_stats then
        local extra_stats_h = math.min(px(56), math.max(0, avail - fixedHeight()))
        if extra_stats_h > 0 then
            stats_widget = self:buildDashboardStatsStrip(summary, dashboard, stats_h + extra_stats_h)
            stats_h = stats_widget:getSize().h
        end
    end

    local hero_slots = self:dashboardHeroSlots(#continue_books)
    local hero_pages = has_continue and math.max(1, math.ceil(#continue_books / hero_slots)) or 0
    local hero_page = has_continue and self:dashboardPage("continue", hero_pages) or 1
    local continue_controls
    if hero_pages > 1 then
        local prev_button, next_button = self:buildDashboardHeaderNav("continue", hero_page, hero_pages)
        continue_controls = { prev_button, next_button }
    end

    self:addDashboardSpacer(top_gap)
    if show_stats then
        self:addDashboardInset(stats_widget)
        self:addDashboardSpacer(stats_gap)
    end

    self:addDashboardHeader(_("Continue reading"), continue_controls)
    self:addDashboardSpacer(inner_gap)
    if has_continue then
        self:addDashboardHeroRow(continue_books, hero_h, hero_slots, hero_page)
    elseif context.loading then
        self:addDashboardEmptyState(_("Loading dashboard..."))
    elseif context.unavailable then
        self:addDashboardEmptyState(
            _("The dashboard could not be loaded."),
            _("Retry"),
            function() self:refreshCurrent() end)
    else
        self:addDashboardEmptyState(
            _("Nothing in progress yet."),
            _("Browse all books"),
            function()
                self:onMenuSelect({ text = _("All Books"), kind = "books", params = { sort = "title" } })
            end)
    end
    self:addDashboardSpacer(section_gap)

    if show_section then
        local section_controls = {}
        local section_page = 1
        if not section_pending then
            section_slots = math.min(section_slots, #section_books)
            local section_page_size = math.max(1, section_slots * section_rows)
            local section_pages = math.max(1, math.ceil(#section_books / section_page_size))
            section_page = self:dashboardPage(SECTION_PAGE_ID, section_pages)
            if section_pages > 1 then
                local prev_button, next_button = self:buildDashboardHeaderNav(SECTION_PAGE_ID, section_page, section_pages)
                table.insert(section_controls, prev_button)
                table.insert(section_controls, next_button)
            end
            if self:dashboardSectionSupportsReroll(section_config) then
                table.insert(section_controls, self:buildDashboardRerollButton())
            end
        end

        self:addDashboardHeader(DashboardSections.headerText(section_config), section_controls)
        self:addDashboardSpacer(inner_gap)
        if section_pending then
            self:addDashboardEmptyState(_("Loading..."))
        else
            self:addDashboardCoverGrid(SECTION_PAGE_ID, section_books, section_row_h, false, false,
                section_slots, section_card_w, section_page, section_rows)
        end
        self:addDashboardSpacer(section_gap)
    end

    self:addDashboardHeader(_("Browse"))
    self:addDashboardSpacer(inner_gap)
    self:addDashboardBrowseList(action_entries, browse_row_h, browse_cols, browse_rows)

    self:addDashboardSpacer(math.max(0, avail - self.dash_used))

    self:finishCustomUpdate(old_dimen, select_number)
end

-- Replaces the configurable row's books in place, leaving the rest of the page
-- and its cache entry alone.
function CatalogDashboard:applyDashboardSectionBooks(context, books)
    local dashboard = context and context.dashboard
    if not dashboard then return end
    if type(dashboard.section) == "table" then
        dashboard.section.books = books
    else
        dashboard.discover = books
    end
    context.dash_pages = context.dash_pages or {}
    context.dash_pages[SECTION_PAGE_ID] = 1
    context.section_stale = false
    self:cacheDashboard(dashboard)
    self:scheduleThumbnailDownloads(self.dashboardBooks(dashboard))
    self:updateItems()
end

-- Fetches a fresh set of random Discover books and swaps them into the current
-- dashboard without reloading the rest of the page. Only reachable while the
-- configurable row is showing Discover.
function CatalogDashboard:rerollDiscover()
    if not self:dashboardMode() then return end
    self:runConnected(function()
        local body, err = self:fetch(_("Finding books..."), function()
            return self.client:catalogDiscover()
        end)
        if body and body.discover then
            self:applyDashboardSectionBooks(self.current_context, body.discover)
        elseif err and err ~= "cancelled" then
            self:showServerError(err)
        end
    end)
end

-- Persists a new choice for the configurable row and reloads the dashboard so
-- the row is fetched for it. Called from the picker.
function CatalogDashboard:setDashboardSection(config)
    local normalized = DashboardSections.normalizeEntry(config)
    if DashboardSections.signature(normalized) == DashboardSections.signature(self:dashboardConfiguredSection()) then
        return
    end
    self:persistSetting(DashboardSections.SETTING_KEY, DashboardSections.store(normalized))
    if not self:dashboardMode() then return end
    local context = self.current_context
    if context then
        context.section_stale = true
        context.dash_pages = context.dash_pages or {}
        context.dash_pages[SECTION_PAGE_ID] = 1
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
