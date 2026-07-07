--[[--
Dashboard mixin for the BookOrbit catalog browser.

Builds and renders the single-page dashboard: a summary stats band, a
Continue-reading hero row (two hero cards side by side, chevron-paged through
all in-progress books), the Discover rows and a compact Browse list, including
the offline cache and the Discover reroll. Installed onto the catalog
controller as regular methods.

Layout is budget-driven: fixed blocks are measured first. When the page gets
too tight, the stats strip is dropped first, then Discover itself.
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

local CatalogUtil = require("bookorbit_catalog_util")
local CatalogWidgets = require("bookorbit_catalog_widgets")
local BookOrbitStatsReader = require("bookorbit_stats_reader")

local formatDuration = CatalogUtil.formatDuration
local formatProgress = CatalogUtil.formatProgress

local BookOrbitDashboardCoverCard = CatalogWidgets.DashboardCoverCard
local BookOrbitDashboardHeroCard = CatalogWidgets.DashboardHeroCard
local BookOrbitDashboardBrowseRow = CatalogWidgets.DashboardBrowseRow
local BookOrbitDashboardIconButton = CatalogWidgets.DashboardIconButton

-- How long the local reading-stats summary is reused before re-querying
-- statistics.sqlite3 (the dashboard re-renders on every row page turn).
local STATS_CACHE_TTL = 120
local DISCOVER_TARGET_SLOTS = 5
local DISCOVER_COMPACT_GAP = 6
local DASHBOARD_TALL_ASPECT_RATIO = 1.55
local DISCOVER_MAX_ROWS = 2
local STATS_MIN_BODY_HEIGHT = 56

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
    }
end

function CatalogDashboard:dashboardRoot()
    local cached = self:dashboardCache()
    if self.prefer_cached_dashboard and cached and not NetworkMgr:isConnected() then
        return self:dashboardContext(cached, { stale = true })
    end

    local body, err = self:fetch(_("Loading dashboard..."), function()
        return self.client:catalogDashboard()
    end)
    if body and body.continueReading then
        self:cacheDashboard(body)
        return self:dashboardContext(body)
    end

    if isDashboardUnsupported(err) then
        UIManager:show(InfoMessage:new{
            text = _("BookOrbit dashboard needs a newer server. Showing the catalog instead."),
            timeout = 4,
        })
        return self:rootItems(), { kind = "root", title = self.title }
    end

    if cached then
        return self:dashboardContext(cached, { stale = true })
    end

    if err ~= "cancelled" then
        self:showServerError(err)
    end
    return self:dashboardContext(nil, { stale = true, unavailable = true })
end

function CatalogDashboard:loadDashboardRoot(replace)
    self:runConnected(function()
        local items, context = self:dashboardRoot()
        self:switchTo(context.title or self.title, items, context, not replace)
    end)
end

-- All books rendered on the dashboard (continue reading + discover), used for
-- thumbnail prefetching and cover-cache eviction.
function CatalogDashboard.dashboardBooks(dashboard)
    dashboard = dashboard or {}
    local books = {}
    for _, book in ipairs(dashboard.continueReading or {}) do
        table.insert(books, book)
    end
    for _, book in ipairs(dashboard.discover or {}) do
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

function CatalogDashboard:discoverRowMetrics(count, gap)
    local slots = math.min(DISCOVER_TARGET_SLOTS, count)
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
-- centered message with a borderless action button underneath.
function CatalogDashboard:addDashboardEmptyState(text, button_text, callback)
    local col = VerticalGroup:new{ align = "center" }
    table.insert(col, TextBoxWidget:new{
        text = text,
        width = self.content_w,
        alignment = "center",
        fgcolor = Blitbuffer.COLOR_DARK_GRAY,
        face = Font:getFace("cfont", 14),
    })
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
-- turns do not reopen the database. Returns nil when there is nothing to
-- show (no stats database, or no recorded reading at all).
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
    local blocks = {
        { value = today_seconds > 0 and formatDuration(today_seconds) or _("Not yet"), label = _("Today") },
        { value = formatDuration(summary.week_seconds or 0), label = _("Past 7 days") },
        { value = tostring(summary.streak_days or 0), label = _("Day streak") },
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
    self:refreshOnDevice()
    local context = self.current_context or {}
    local dashboard = context.dashboard
    local continue_books = dashboard and dashboard.continueReading or {}
    local discover_books = dashboard and dashboard.discover or {}
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
    local show_discover = #discover_books > 0
    local discover_gap = inner_gap
    local discover_slots = 0
    local discover_card_w = 0
    local discover_row_h = 0
    local discover_rows = 1

    local function updateDiscoverMetrics()
        if show_discover then
            discover_slots, discover_card_w, discover_row_h = self:discoverRowMetrics(#discover_books, discover_gap)
        else
            discover_slots, discover_card_w, discover_row_h = 0, 0, 0
        end
    end
    updateDiscoverMetrics()

    local function discoverGridHeight()
        if not show_discover then return 0 end
        return discover_rows * discover_row_h + math.max(0, discover_rows - 1) * inner_gap
    end

    -- Fixed blocks are measured up front. If the dashboard gets too tight, the
    -- stats strip drops first, then Discover.
    local function fixedHeight()
        local fixed = top_gap
            + (show_stats and (stats_h + stats_gap) or 0)
            + header_h + inner_gap
            + (has_continue and hero_h or empty_h)
            + section_gap
            + (show_discover and (header_h + inner_gap + discoverGridHeight() + section_gap) or 0)
            + header_h + inner_gap + browse_rows * browse_row_h
            + inner_gap
        return fixed
    end
    if show_stats and fixedHeight() > avail then
        show_stats = false
    end
    if show_discover and fixedHeight() > avail then
        show_discover = false
        updateDiscoverMetrics()
    end
    if show_discover then
        local compact_gap = px(DISCOVER_COMPACT_GAP)
        if compact_gap < discover_gap then
            local previous_gap = discover_gap
            local previous_slots, previous_card_w, previous_row_h = discover_slots, discover_card_w, discover_row_h
            discover_gap = compact_gap
            updateDiscoverMetrics()
            if fixedHeight() > avail then
                discover_gap = previous_gap
                discover_slots, discover_card_w, discover_row_h = previous_slots, previous_card_w, previous_row_h
            end
        end
    end
    if show_discover and self:dashboardTallLayout() and discover_slots > 0 then
        local full_rows = math.floor(#discover_books / discover_slots)
        local remainder = #discover_books % discover_slots
        local book_rows = full_rows
        if remainder >= math.ceil(discover_slots * 0.5) then
            book_rows = book_rows + 1
        end
        local max_rows = math.min(DISCOVER_MAX_ROWS, math.max(1, book_rows))
        while discover_rows < max_rows do
            discover_rows = discover_rows + 1
            if fixedHeight() > avail then
                discover_rows = discover_rows - 1
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

    if show_discover then
        discover_slots = math.min(discover_slots, #discover_books)
        local discover_page_size = math.max(1, discover_slots * discover_rows)
        local discover_pages = math.max(1, math.ceil(#discover_books / discover_page_size))
        local discover_page = self:dashboardPage("discover", discover_pages)
        local discover_controls = {}
        if discover_pages > 1 then
            local prev_button, next_button = self:buildDashboardHeaderNav("discover", discover_page, discover_pages)
            table.insert(discover_controls, prev_button)
            table.insert(discover_controls, next_button)
        end
        table.insert(discover_controls, self:buildDashboardRerollButton())

        self:addDashboardHeader(_("Discover"), discover_controls)
        self:addDashboardSpacer(inner_gap)
        self:addDashboardCoverGrid("discover", discover_books, discover_row_h, false, false,
            discover_slots, discover_card_w, discover_page, discover_rows)
        self:addDashboardSpacer(section_gap)
    end

    self:addDashboardHeader(_("Browse"))
    self:addDashboardSpacer(inner_gap)
    self:addDashboardBrowseList(action_entries, browse_row_h, browse_cols, browse_rows)

    self:addDashboardSpacer(math.max(0, avail - self.dash_used))

    self:finishCustomUpdate(old_dimen, select_number)
end

-- Fetches a fresh set of random Discover books and swaps them into the current
-- dashboard without reloading the rest of the page.
function CatalogDashboard:rerollDiscover()
    if not self:dashboardMode() then return end
    self:runConnected(function()
        local body, err = self:fetch(_("Finding books..."), function()
            return self.client:catalogDiscover()
        end)
        if body and body.discover then
            local context = self.current_context
            if context and context.dashboard then
                context.dashboard.discover = body.discover
                context.dash_pages = context.dash_pages or {}
                context.dash_pages.discover = 1
                self:cacheDashboard(context.dashboard)
                self:scheduleThumbnailDownloads(self.dashboardBooks(context.dashboard))
                self:updateItems()
            end
        elseif err and err ~= "cancelled" then
            self:showServerError(err)
        end
    end)
end

function CatalogDashboard.install(Catalog)
    for name, fn in pairs(CatalogDashboard) do
        if name ~= "install" then
            Catalog[name] = fn
        end
    end
end

return CatalogDashboard
