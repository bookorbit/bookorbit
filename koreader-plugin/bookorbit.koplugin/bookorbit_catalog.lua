--[[--
Native BookOrbit catalog browser.

Uses BookOrbit's KOReader-authenticated JSON catalog endpoints. Book result
pages render as KOReader-style menu pages with a cover mosaic and progressive
thumbnail loading.

The controller is split across mixin modules installed below:
bookorbit_catalog_util (constants and pure helpers), bookorbit_catalog_widgets
(cover and item widgets), bookorbit_catalog_download (single-file downloads),
bookorbit_catalog_bulk_download (bulk queues), bookorbit_catalog_dashboard
(the dashboard page), bookorbit_catalog_detail (the book detail page and book
actions) and bookorbit_catalog_thumbnails (the cover cache). This file keeps
navigation, search/sort/filter and the mosaic/list book views. Navigation
fetches run off the UI thread via Trapper so taps never freeze the reader.
]]

local ButtonDialog = require("ui/widget/buttondialog")
local CenterContainer = require("ui/widget/container/centercontainer")
local Device = require("device")
local Geom = require("ui/geometry")
local HorizontalGroup = require("ui/widget/horizontalgroup")
local HorizontalSpan = require("ui/widget/horizontalspan")
local IconButton = require("ui/widget/iconbutton")
local IconWidget = require("ui/widget/iconwidget")
local Menu = require("ui/widget/menu")
local NetworkMgr = require("ui/network/manager")
local OverlapGroup = require("ui/widget/overlapgroup")
local TextBoxWidget = require("ui/widget/textboxwidget")
local TitleBar = require("ui/widget/titlebar")
local Trapper = require("ui/trapper")
local UIManager = require("ui/uimanager")
local VerticalGroup = require("ui/widget/verticalgroup")
local VerticalSpan = require("ui/widget/verticalspan")
local lfs = require("libs/libkoreader-lfs")
local util = require("util")
local T = require("ffi/util").template
local _ = require("gettext")

local BookOrbitApi = require("bookorbit_api")
local BoardMetrics = require("bookorbit_board_metrics")
local BookOrbitStateManager = require("bookorbit_state_manager")
local CatalogUtil = require("bookorbit_catalog_util")
local Delivery = require("bookorbit_delivery")
local CatalogWidgets = require("bookorbit_catalog_widgets")
local CatalogDownload = require("bookorbit_catalog_download")
local CatalogBulkDownload = require("bookorbit_catalog_bulk_download")
local CatalogBoard = require("bookorbit_catalog_board")
local CatalogDashboard = require("bookorbit_catalog_dashboard")
local CatalogDetail = require("bookorbit_catalog_detail")
local CatalogFocus = require("bookorbit_catalog_focus")
local CatalogLists = require("bookorbit_catalog_lists")
local CatalogThumbnails = require("bookorbit_catalog_thumbnails")
-- Loaded on first use: specs load this module without KOReader's widgets.
local Toast = setmetatable({}, { __index = function(_t, key) return require("bookorbit_toast")[key] end })

local Screen = Device.screen
local px = BoardMetrics.px
local DGENERIC_ICON_SIZE = G_defaults:readSetting("DGENERIC_ICON_SIZE")

local DEFAULT_GRID_COLUMNS = CatalogUtil.DEFAULT_GRID_COLUMNS
local DEFAULT_GRID_ROWS = CatalogUtil.DEFAULT_GRID_ROWS
local MAX_RECENT_SEARCHES = CatalogUtil.MAX_RECENT_SEARCHES
local ON_DEVICE_MAX_IDS = CatalogUtil.ON_DEVICE_MAX_IDS
local NOT_ON_DEVICE_SCAN_SIZE = CatalogUtil.NOT_ON_DEVICE_SCAN_SIZE
local scanNotOnDeviceIds = CatalogUtil.scanNotOnDeviceIds
local SORTS = CatalogUtil.SORTS
local SORT_LABELS = CatalogUtil.SORT_LABELS
local NATURAL_ORDER = CatalogUtil.NATURAL_ORDER
local SORT_KIND = CatalogUtil.SORT_KIND
local DIRECTION_LABELS = CatalogUtil.DIRECTION_LABELS
local READ_STATUS_FILTERS = CatalogUtil.READ_STATUS_FILTERS
local READ_STATUS_LABELS = CatalogUtil.READ_STATUS_LABELS
local COMMON_FORMATS = CatalogUtil.COMMON_FORMATS
local GRID_PRESETS = CatalogUtil.GRID_PRESETS

local isAuthError = CatalogUtil.isAuthError
local cloneParams = CatalogUtil.cloneParams
local formatProgress = CatalogUtil.formatProgress
local isSupportedFormat = CatalogUtil.isSupportedFormat
local shortText = CatalogUtil.shortText
local formatSeries = CatalogUtil.formatSeries
local firstAuthor = CatalogUtil.firstAuthor
local coverLabel = CatalogUtil.coverLabel
local BookOrbitMosaicItem = CatalogWidgets.MosaicItem
local BookOrbitListItem = CatalogWidgets.ListItem

local DOWNLOAD_ICON = "appbar.filebrowser"
local DOWNLOAD_ICON_FILE = "bookorbit.download.svg"

local function showError(err)
    local text
    if isAuthError(err) then
        text = _("BookOrbit login failed. Check your KOReader credentials.")
    elseif err then
        text = T(_("Could not reach the BookOrbit server: %1"), tostring(err))
    else
        text = _("Could not reach the BookOrbit server.")
    end
    Toast.error(text)
end

local BookOrbitIconButton = IconButton:extend{ file = nil }

function BookOrbitIconButton:init()
    if not self.file then
        return IconButton.init(self)
    end

    self.image = IconWidget:new{
        file = self.file,
        rotation_angle = self.icon_rotation_angle,
        width = self.width,
        height = self.height,
    }
    self.show_parent = self.show_parent or self

    self.horizontal_group = HorizontalGroup:new{}
    table.insert(self.horizontal_group, HorizontalSpan:new{})
    table.insert(self.horizontal_group, self.image)
    table.insert(self.horizontal_group, HorizontalSpan:new{})

    self.button = VerticalGroup:new{}
    table.insert(self.button, VerticalSpan:new{})
    table.insert(self.button, self.horizontal_group)
    table.insert(self.button, VerticalSpan:new{})

    self[1] = self.button
    self:update()
end

local BookOrbitTitleBar = TitleBar:extend{
    search_icon = nil,
    search_icon_file = nil,
    search_icon_tap_callback = nil,
    search_icon_hold_callback = nil,
    search_icon_allow_flash = true,
    search_icon_enabled = true,
    refresh_icon = nil,
    refresh_icon_tap_callback = nil,
    refresh_icon_hold_callback = nil,
    refresh_icon_allow_flash = true,
    refresh_icon_enabled = true,
}

-- Drops any previously appended buttons from the OverlapGroup, so init can
-- rebuild them without leaving a stale copy behind.
function BookOrbitTitleBar:_clearExtraButtons()
    for index = #self, 1, -1 do
        if self[index] == self.search_button or self[index] == self.refresh_button then
            table.remove(self, index)
        end
    end
    self.search_button = nil
    self.refresh_button = nil
end

function BookOrbitTitleBar:init()
    TitleBar.init(self)
    -- These are appended after TitleBar has built its own children, so they only
    -- survive as long as that child list does. TitleBar:setTitle re-inits the
    -- whole bar when the title can shrink to fit - which this catalog asks for -
    -- and clears the group on the way, taking the appended buttons with it.
    -- Rebuilding them on every init is what keeps them on screen; skipping the
    -- rebuild left the *fields* pointing at buttons that were no longer drawn,
    -- so the D-Pad walked onto controls that were not there.
    self:_clearExtraButtons()

    local icon_size = px(DGENERIC_ICON_SIZE)
    local button_padding = self.button_padding or 0
    if self.left_button then
        self.left_button.padding_right = button_padding
        self.left_button:update()
    end
    if self.right_button then
        self.right_button.padding_left = button_padding
        self.right_button:update()
    end

    if self.search_icon then
        self.search_button = BookOrbitIconButton:new{
            icon = self.search_icon,
            file = self.search_icon_file,
            width = icon_size,
            height = icon_size,
            padding = button_padding,
            padding_bottom = icon_size,
            overlap_offset = { self.left_button and self.left_button:getSize().w or 0, 0 },
            callback = self.search_icon_tap_callback,
            hold_callback = self.search_icon_hold_callback,
            allow_flash = self.search_icon_allow_flash,
            enabled = self.search_icon_enabled ~= false,
            show_parent = self.show_parent,
        }
        table.insert(self, self.search_button)
    end
    if self.refresh_icon then
        local right_width = self.right_button and self.right_button:getSize().w or 0
        local refresh_width = icon_size + button_padding * 2
        self.refresh_button = IconButton:new{
            icon = self.refresh_icon,
            width = icon_size,
            height = icon_size,
            padding = button_padding,
            padding_bottom = icon_size,
            overlap_offset = { self.width - right_width - refresh_width, 0 },
            callback = self.refresh_icon_tap_callback,
            hold_callback = self.refresh_icon_hold_callback,
            allow_flash = self.refresh_icon_allow_flash,
            enabled = self.refresh_icon_enabled ~= false,
            show_parent = self.show_parent,
        }
        table.insert(self, self.refresh_button)
    end
    self._size = nil
    OverlapGroup.init(self)
end

local TITLE_BAR_BUTTONS = { "left_button", "search_button", "refresh_button", "right_button" }
-- The two this plugin appends itself, and so the two that can go missing.
local TITLE_BAR_APPENDED = { search_button = true, refresh_button = true }

function BookOrbitTitleBar:_drawnButtons()
    return CatalogFocus.drawnTitleBarButtons(self, TITLE_BAR_BUTTONS, TITLE_BAR_APPENDED)
end

function BookOrbitTitleBar:generateHorizontalLayout()
    local row = self:_drawnButtons()
    return #row > 0 and { row } or {}
end

function BookOrbitTitleBar:generateVerticalLayout()
    local layout = {}
    for _, button in ipairs(self:_drawnButtons()) do
        table.insert(layout, { button })
    end
    return layout
end

local BookOrbitCatalog = Menu:extend{
    title = _("BookOrbit"),
    title_shrink_font_to_fit = true,
    title_bar_left_icon = "appbar.menu",
}

CatalogDownload.install(BookOrbitCatalog)
CatalogBulkDownload.install(BookOrbitCatalog)
CatalogDashboard.install(BookOrbitCatalog)
-- The widget board draws the dashboard view; installed after the dashboard
-- mixin so it replaces that view's renderer and keeps its data plumbing.
CatalogBoard.install(BookOrbitCatalog)
CatalogDetail.install(BookOrbitCatalog)
CatalogFocus.install(BookOrbitCatalog)
CatalogThumbnails.install(BookOrbitCatalog)
-- The list pages (books, authors, series, shelves, search) draw themselves.
CatalogLists.install(BookOrbitCatalog)

local Menu_recalculateDimen = Menu._recalculateDimen
local Menu_updateItems = Menu.updateItems
local Menu_onGotoPage = Menu.onGotoPage
local Menu_onNextPage = Menu.onNextPage
local Menu_onPrevPage = Menu.onPrevPage
local Menu_onFirstPage = Menu.onFirstPage
local Menu_onLastPage = Menu.onLastPage
local Menu_onClose = Menu.onClose

function BookOrbitCatalog:setApi(api)
    self.settings = self.settings or {}
    local identity = tostring(api.server_url) .. "|" .. tostring(api.username) .. "|" .. tostring(api.userkey ~= nil)
    local changed = self.settings.catalog_account_identity ~= identity
    BookOrbitStateManager.setAccount(api)
    if changed then
        self.download_generation = (self.download_generation or 0) + 1
        self.settings.catalog_account_identity = identity
        self.settings.catalog_dashboard_cache = nil
        self.settings.catalog_dashboard_cache_section = nil
        self.settings.catalog_recent_searches = nil
        self.list_libraries = nil
        self._list_keep_jump = nil
        if self.bulk_ctx then
            self.bulk_ctx.cancelled = true
            self:bulkReleaseStandby(self.bulk_ctx)
            if self.bulk_ctx.progress_dialog then UIManager:close(self.bulk_ctx.progress_dialog) end
            self.bulk_ctx = nil
            self.bulk_running = false
        end
        self.on_device = {}
        self.on_device_files = {}
        self.on_device_generation = nil
        self.on_device_hydration_generation = (self.on_device_hydration_generation or 0) + 1
        self.on_device_hydrating = false
        self.dashboard_request_generation = (self.dashboard_request_generation or 0) + 1
        self.bulk_selection_mode = false
        self.bulk_selection_scope_key = nil
        self.bulk_selected_books = {}
        self.bulk_select_all = false
    end
    self.api = api
    self.client = BookOrbitApi.new(api)
    if changed and self.current_context then
        self:goDashboard()
        self:hydrateOnDeviceMaps()
    end
end

function BookOrbitCatalog:init()
    self:setApi(self.api)
    self.stack = {}
    self.settings = self.settings or {}
    CatalogWidgets.setAssetIconFiles({
        on_device = self:pluginAssetFile("bookorbit.on-device.svg"),
        download = self:pluginAssetFile(DOWNLOAD_ICON_FILE),
    })
    self:initThumbnailCache()
    self:initBulkDownloadState()
    self.view_mode = self.settings.catalog_view_mode == "list" and "list" or "mosaic"
    self.grid_cols = self:sanitizeGridValue(self.settings.catalog_grid_cols, DEFAULT_GRID_COLUMNS)
    self.grid_rows = self:sanitizeGridValue(self.settings.catalog_grid_rows, DEFAULT_GRID_ROWS)
    self.mosaic_show_titles = self.settings.catalog_mosaic_show_titles == true
    self.default_sort = self.settings.catalog_sort or "recently_added"
    self.list_rows = self:computeListRows()
    self.on_device = {}
    self.on_device_files = {}
    self.on_device_generation = BookOrbitStateManager.generation()
    self.on_device_hydrating = false
    self.on_device_hydration_generation = 0
    self.on_device_hydration_failures = 0
    self.dashboard_request_generation = 0
    self.catalog_closed = false
    -- Construction stays local: the widget opens on the cached dashboard (or a
    -- placeholder) and the server refresh starts once it is interactive.
    self.item_table, self.current_context = self:initialDashboardContext()
    self.subtitle = self.current_context.subtitle
    self.is_borderless = true
    self.title_bar_fm_style = true
    self.custom_title_bar = self:buildTitleBar(self.current_context.title or self.title, self.current_context.subtitle or "")
    Menu.init(self)
    local zone = G_defaults:readSetting("DTAP_ZONE_MENU") or { x = 1/8, y = 0, w = 6/8, h = 1/8 }
    self:registerTouchZones({
        {
            id = "bookorbit_menu_swipe",
            ges = "swipe",
            screen_zone = { ratio_x = zone.x, ratio_y = zone.y, ratio_w = zone.w, ratio_h = zone.h },
            handler = function(ges) return self:onTopEdgeSwipe(ges) end,
        },
    })
    self:updateLeftIcon()
    if self:dashboardMode() then
        self:scheduleThumbnailDownloads(self.dashboardBooks(self.current_context.dashboard))
    end
    self.paths = self.stack
    UIManager:nextTick(function()
        self:hydrateOnDeviceMaps()
        self:refreshDashboardOnOpen()
        -- One-off cache migration, queued behind the refresh so its directory
        -- walk cannot delay the first dashboard request.
        UIManager:scheduleIn(1.0, function()
            self:cleanLegacyThumbnails()
        end)
    end)
end

function BookOrbitCatalog:pluginAssetFile(name)
    local source_dir = self.path or (self._manager and self._manager.path)
    if not source_dir then return nil end
    local path = source_dir .. "/assets/" .. name
    if lfs.attributes(path, "mode") == "file" then return path end
end

function BookOrbitCatalog:downloadIconPath()
    return self:pluginAssetFile(DOWNLOAD_ICON_FILE)
end

function BookOrbitCatalog:isBulkSelectionActive()
    return self:bookMode() and self.bulk_selection_mode == true
end

function BookOrbitCatalog:titleBarSearchIcon()
    if self:detailMode() then return nil end
    return self:isBulkSelectionActive() and DOWNLOAD_ICON or "appbar.search"
end

function BookOrbitCatalog:titleBarSearchIconFile()
    if not self:isBulkSelectionActive() then return nil end
    return self:downloadIconPath()
end

function BookOrbitCatalog:titleBarSearchEnabled()
    return not self:isBulkSelectionActive() or self:bulkSelectedCount() > 0
end

function BookOrbitCatalog:titleBarRefreshIcon()
    if self:detailMode() then return "cre.render.reload" end
    return self:isBulkSelectionActive() and "close" or "cre.render.reload"
end

-- On the detail page the title bar keeps actions on the left and refresh on
-- the right; the footer owns back/adjacent-book navigation.
function BookOrbitCatalog:titleBarLeftIcon()
    if self:detailMode() then return "home" end
    return "appbar.menu"
end

function BookOrbitCatalog:titleBarRightIcon()
    return nil
end

function BookOrbitCatalog:buildTitleBar(title, subtitle)
    -- The dashboard and the detail page draw their own headers; KOReader's
    -- title bar would only take height from them.
    if self:dashboardMode() or self:detailMode() or self:listMode() then return self:boardTitleBar() end
    local bar_title = title or self.title
    local bar_subtitle = subtitle or ""
    local title_top_padding = px(6)
    local button_padding = px(5)
    local title_face = BoardMetrics.namedFace("smalltfont", 24)
    if self:dashboardMode() then
        title_top_padding = px(2)
        button_padding = px(4)
        title_face = BoardMetrics.namedFace("cfont", 26)
    end
    if self:detailMode() then
        bar_title = nil
        bar_subtitle = nil
        title_top_padding = 0
    end
    return BookOrbitTitleBar:new{
        width = Screen:getWidth(),
        fullscreen = "true",
        align = "center",
        title = bar_title,
        title_face = title_face,
        title_multilines = self.title_multilines,
        title_shrink_font_to_fit = self.title_shrink_font_to_fit,
        subtitle = bar_subtitle,
        subtitle_face = BoardMetrics.namedFace("xx_smallinfofont", 18),
        subtitle_truncate_left = self.show_path,
        subtitle_fullwidth = self.show_path,
        title_top_padding = title_top_padding,
        title_h_padding = px(10),
        title_subtitle_v_padding = px(3),
        bottom_v_padding = px(10),
        button_padding = button_padding,
        left_icon = self:titleBarLeftIcon(),
        left_icon_size_ratio = BoardMetrics.get().adj * BoardMetrics.get().scale,
        left_icon_tap_callback = function() self:onLeftButtonTap() end,
        left_icon_hold_callback = function() self:onLeftButtonHold() end,
        right_icon = self:titleBarRightIcon(),
        right_icon_size_ratio = BoardMetrics.get().adj * BoardMetrics.get().scale,
        right_icon_tap_callback = function() self:onRightButtonTap() end,
        search_icon = self:titleBarSearchIcon(),
        search_icon_file = self:titleBarSearchIconFile(),
        search_icon_tap_callback = function() self:onSearchButtonTap() end,
        search_icon_allow_flash = self:titleBarSearchEnabled(),
        search_icon_enabled = self:titleBarSearchEnabled(),
        refresh_icon = self:titleBarRefreshIcon(),
        refresh_icon_tap_callback = function() self:onRefreshButtonTap() end,
        show_parent = self.show_parent or self,
    }
end

function BookOrbitCatalog:resetTitleBar(title, subtitle)
    if self.bulkDecorateTitle then
        title, subtitle = self:bulkDecorateTitle(title, subtitle)
    end
    self.custom_title_bar = self:buildTitleBar(title, subtitle)
    self.title_bar = self.custom_title_bar
    if self.content_group then
        self.content_group[1] = self.title_bar
        self.content_group:resetLayout()
    end
    self:updateLeftIcon()
end

function BookOrbitCatalog:refreshCurrent()
    self.thumbnail_failures = {}
    local context = self.current_context or {}
    if context.kind == "books" then
        self:evictCachedCovers(context.books)
        local params = cloneParams(context.params or {})
        params.page = context.page or 1
        params.offset = context.offset
        self:loadBooks(params, context.title or _("Books"), false)
    elseif context.kind == "dashboard" then
        self:evictCachedCovers(self.dashboardBooks(context.dashboard))
        self:loadDashboardRoot(true)
    elseif context.kind == "section" then
        self:reloadSection(context.section, { page = context.page, offset = context.offset })
    elseif context.kind == "detail" and context.detail then
        self:evictCachedCovers(self:detailThumbnailBooks(context.detail))
        self:runConnected(function()
            local detail, err = self:fetchDeliveryBook(context.detail.id, nil, _("Refreshing..."))
            if not detail then
                local cached = self:cachedBookDetail(context.detail.id)
                if cached and err ~= "cancelled" then
                    context.detail = cached
                    context.supported_files = self:supportedFiles(cached)
                    context.stale = true
                    context.subtitle = _("Offline cache")
                    self:refreshOnDevice()
                    self:updateItems()
                    return
                end
                if err ~= "cancelled" then self:showWriteError(err) end
                return
            end
            self:cacheBookDetail(detail)
            self:cancelThumbnailJobs()
            context.detail = detail
            context.supported_files = self:supportedFiles(detail)
            context.stale = false
            context.subtitle = ""
            self:refreshOnDevice()
            self:updateItems()
            self:scheduleThumbnailDownloads(self:detailThumbnailBooks(detail))
        end)
    end
end

function BookOrbitCatalog:markStackDirty()
    for _, entry in ipairs(self.stack or {}) do
        if entry.context and (entry.context.kind == "books" or entry.context.kind == "dashboard" or entry.context.kind == "section") then
            entry.context.dirty = true
        end
    end
end

-- Going home shows the cached dashboard at once and refreshes it behind the
-- redraw, like opening the catalog does, so it never waits on a connection.
function BookOrbitCatalog:goDashboard()
    self.stack = {}
    local items, context = self:initialDashboardContext()
    self:switchTo(context.title or self.title, items, context, false)
    UIManager:nextTick(function()
        self:refreshDashboardOnOpen()
    end)
end

function BookOrbitCatalog:sectionSubtitle(page, q, has_next)
    local parts = {}
    if q and q ~= "" then
        table.insert(parts, T(_("Filter: %1"), q))
    end
    if page and (page > 1 or has_next) then
        table.insert(parts, T(_("Results page %1"), page))
    end
    return #parts > 0 and table.concat(parts, " - ") or ""
end

function BookOrbitCatalog:sanitizeGridValue(value, fallback)
    value = tonumber(value)
    if not value then return fallback end
    value = math.floor(value)
    if value < 1 then return 1 end
    if value > 6 then return 6 end
    return value
end

function BookOrbitCatalog:computeListRows()
    local row_h = px(64)
    local usable = Screen:getHeight() * 0.82
    return math.max(5, math.floor(usable / row_h))
end

function BookOrbitCatalog:effectiveGridDimensions()
    local scale = BoardMetrics.get().scale
    local cols = math.max(1, math.floor(self.grid_cols / scale + 0.5))
    local rows = math.max(1, math.floor(self.grid_rows / scale + 0.5))
    return cols, rows
end

function BookOrbitCatalog:itemsPerPage()
    if self.view_mode == "list" then
        return self.list_rows or 8
    end
    local cols, rows = self:effectiveGridDimensions()
    return cols * rows
end

function BookOrbitCatalog:interfaceScaleChanged()
    self.list_rows = self:computeListRows()
    self:updateItems()
end

function BookOrbitCatalog:persistSetting(key, value)
    self.settings[key] = value
    if self.save_settings then
        self.save_settings()
    end
end

function BookOrbitCatalog:refreshOnDevice()
    local cached_ok, cached = pcall(BookOrbitStateManager.hasOnDeviceMaps)
    if not cached_ok or not cached then
        self:hydrateOnDeviceMaps()
        return false
    end
    local ok, maps = pcall(BookOrbitStateManager.onDeviceMaps)
    if ok and maps then
        self.on_device = maps.byBookId
        self.on_device_files = maps.byFileId
        self.on_device_generation = maps.generation
    else
        self.on_device = {}
        self.on_device_files = {}
        self.on_device_generation = nil
    end
    return ok and maps ~= nil
end

-- Scans large matched libraries in a child process. The parent adopts only a
-- generation-current result and keeps rendering the previous bounded snapshot
-- while a refresh is in flight.
function BookOrbitCatalog:hydrateOnDeviceMaps()
    if self.catalog_closed or self.on_device_hydrating then return end
    local expected_generation = BookOrbitStateManager.generation()
    if BookOrbitStateManager.hasOnDeviceMaps() then
        self:refreshOnDevice()
        return
    end

    self.on_device_hydrating = true
    self.on_device_hydration_generation = self.on_device_hydration_generation + 1
    local hydration_generation = self.on_device_hydration_generation
    Trapper:wrap(function()
        local completed, result = self.client:runInSubprocess(function()
            return BookOrbitStateManager.computeOnDeviceMaps()
        end)
        if self.catalog_closed or hydration_generation ~= self.on_device_hydration_generation then
            return
        end
        self.on_device_hydrating = false
        local computed = completed and result and result.body or nil
        if not computed then
            self.on_device_hydration_failures = self.on_device_hydration_failures + 1
            local retry_delay = math.min(5, 0.25 * (2 ^ math.min(self.on_device_hydration_failures, 4)))
            UIManager:scheduleIn(retry_delay, function()
                self:hydrateOnDeviceMaps()
            end)
            return
        end
        if computed.generation ~= expected_generation
                or BookOrbitStateManager.generation() ~= expected_generation then
            UIManager:nextTick(function()
                self:hydrateOnDeviceMaps()
            end)
            return
        end
        local adopted = BookOrbitStateManager.adoptOnDeviceMaps(computed)
        if not adopted then return end
        self.on_device_hydration_failures = 0
        self:refreshOnDevice()
        if self.current_context and self.updateItems then
            self:updateItems(nil, true)
        end
    end)
end

-- Render-path guard: a generation change starts one asynchronous refresh
-- instead of rescanning the matched library inside widget construction.
function BookOrbitCatalog:ensureOnDeviceCurrent()
    local ok, generation = pcall(BookOrbitStateManager.generation)
    if ok and generation == self.on_device_generation then return end
    if ok and BookOrbitStateManager.hasOnDeviceMaps() then
        self:refreshOnDevice()
        return
    end
    self:hydrateOnDeviceMaps()
end

function BookOrbitCatalog:onDeviceBookPath(book)
    local path = book and book.id and self.on_device and self.on_device[book.id]
    if type(path) ~= "string" then return nil end
    if lfs.attributes(path, "mode") == "file" then return path end
    if self.on_device_generation ~= nil and self.on_device_generation == BookOrbitStateManager.generation() then
        BookOrbitStateManager.invalidate()
        self:hydrateOnDeviceMaps()
    end
    return nil
end

function BookOrbitCatalog:isOnDevice(book)
    return self:onDeviceBookPath(book) ~= nil
end

-- The local file a Continue-reading tap should resume: only when the
-- tap-to-resume setting is on and the book is already on the device. Nil sends
-- the tap to the detail page instead.
function BookOrbitCatalog:dashboardResumePath(book)
    if self.settings.catalog_dashboard_tap_resumes == false then return nil end
    return self:onDeviceBookPath(book)
end

function BookOrbitCatalog:onDeviceFilePath(file)
    if file and file.selection then
        local Delivery = require("bookorbit_delivery")
        local variants = self.settings.catalog_downloaded_variants or {}
        local marker = variants[Delivery.key(self.client) .. "|" .. tostring(file.id) .. "|" .. file.downloadVariant]
        if type(marker) ~= "table" or marker.selection ~= file.selection then return nil end
        local path = marker.path
        return path and lfs.attributes(path, "mode") == "file" and path or nil
    end
    local path = file and file.id and self.on_device_files and self.on_device_files[file.id]
    return type(path) == "string" and lfs.attributes(path, "mode") == "file" and path or nil
end

function BookOrbitCatalog:readStatusLabel(book)
    return book and book.readStatus and READ_STATUS_LABELS[book.readStatus] or nil
end

function BookOrbitCatalog:bookMetaLine(book)
    local meta = {}
    local progress = formatProgress(book.progressPercentage)
    if progress then table.insert(meta, progress) end
    local status = self:readStatusLabel(book)
    if status then table.insert(meta, status) end
    if self:isOnDevice(book) then table.insert(meta, _("On device")) end
    if #meta == 0 and book.formats and book.formats[1] then
        table.insert(meta, table.concat(book.formats, ", "))
    end
    return #meta > 0 and table.concat(meta, " - ") or nil
end

function BookOrbitCatalog:cellLabel(book)
    local parts = { shortText(book.title or _("Untitled"), 30) }
    local author = firstAuthor(book)
    if author then
        table.insert(parts, shortText(author, 24))
    end
    local meta = self:bookMetaLine(book)
    if meta then table.insert(parts, meta) end
    return table.concat(parts, "\n")
end

function BookOrbitCatalog:listText(book)
    local lines = { shortText(book.title or _("Untitled"), 48) }
    local author = firstAuthor(book)
    if author then
        table.insert(lines, shortText(author, 44))
    end
    local series = formatSeries(book)
    if series then
        table.insert(lines, shortText(series, 44))
    end
    local meta = self:bookMetaLine(book)
    if meta then table.insert(lines, meta) end
    return table.concat(lines, "\n")
end

function BookOrbitCatalog:listSubtitleLine(book)
    local parts = {}
    local author = firstAuthor(book)
    if author then table.insert(parts, author) end
    local series = formatSeries(book)
    if series then table.insert(parts, series) end
    return #parts > 0 and shortText(table.concat(parts, " - "), 72) or nil
end

function BookOrbitCatalog:listSideMetaText(book)
    local lines = {}
    if book and book.formats and book.formats[1] then
        table.insert(lines, shortText(table.concat(book.formats, ", "), 20))
    end
    local meta = {}
    local progress = book and formatProgress(book.progressPercentage) or nil
    if progress then table.insert(meta, progress) end
    local status = self:readStatusLabel(book)
    if status then table.insert(meta, status) end
    if self:isOnDevice(book) then table.insert(meta, _("On device")) end
    if #meta > 0 then
        table.insert(lines, shortText(table.concat(meta, " - "), 28))
    end
    return table.concat(lines, "\n")
end

function BookOrbitCatalog:onDeviceCount()
    local count = 0
    for _ in pairs(self.on_device or {}) do
        count = count + 1
    end
    return count
end

function BookOrbitCatalog:rootItems()
    local body, err = self:fetch(_("Loading..."), function()
        return self.client:catalogRoot()
    end)
    if not body then
        if err ~= "cancelled" then
            showError(err)
        end
        return {}
    end

    local items = {}
    for _, section in ipairs(body.sections or {}) do
        if section.section == "search" then
            -- Search is exposed through the catalog action menu, not a list row.
        elseif section.section == "recent" then
            table.insert(items, {
                text = section.title,
                kind = "books",
                params = { sort = "recently_added" },
            })
        elseif section.section == "continue-reading" then
            table.insert(items, {
                text = section.title,
                kind = "books",
                params = { sort = "recently_read", readStatus = "reading" },
            })
        elseif section.section == "all-books" then
            table.insert(items, {
                text = section.title,
                kind = "books",
                params = { sort = "title" },
            })
        else
            table.insert(items, {
                text = section.title,
                kind = "section",
                section = section.section,
            })
        end
    end

    local on_device_count = 0
    for _ in pairs(self.on_device or {}) do
        on_device_count = on_device_count + 1
    end
    table.insert(items, {
        text = _("On device"),
        mandatory = on_device_count > 0 and CatalogUtil.formatCount(on_device_count) or nil,
        kind = "on-device",
    })
    table.insert(items, {
        text = _("Not on device"),
        kind = "not-on-device",
    })

    return items
end

function BookOrbitCatalog:updateReturnPath()
    self.paths = self.stack
end

function BookOrbitCatalog:switchTo(title, item_table, context, push)
    self:cancelThumbnailJobs()
    if push and self.current_context then
        table.insert(self.stack, {
            title = self.current_context.title,
            subtitle = self.current_context.subtitle,
            item_table = self.item_table,
            context = self.current_context,
            -- Where the cursor was when this page was left, so returning to it
            -- lands back on the row the reader was working in.
            focus = self:captureFocus(),
        })
    end
    self:updateReturnPath()
    self.current_context = context
    if self.bulkHandleContextChange then
        self:bulkHandleContextChange(context)
    end
    self:resetTitleBar(title, context.subtitle or "")
    self:switchItemTable(title, item_table, nil, nil, context.subtitle or "")
    if context.kind == "books" then
        self:scheduleThumbnailDownloads(context.books or {})
    elseif context.kind == "detail" then
        self:scheduleThumbnailDownloads(self:detailThumbnailBooks(context.detail))
    elseif context.kind == "dashboard" then
        self:scheduleThumbnailDownloads(self.dashboardBooks(context.dashboard))
    end
end

-- Runs the blocking request fn() off the UI thread, so the reader stays
-- responsive and the loading message can be tapped to cancel. The API client
-- owns the subprocess, so calls fn makes back into it never fork again.
-- fn must return (body, err, errbody); they are marshalled back through the
-- subprocess. Returns nil, "cancelled" when the user dismisses the request.
function BookOrbitCatalog:fetch(text, fn, opts)
    opts = opts or {}
    local label = text or _("Loading…")
    if not Trapper:isWrapped() then
        local pill = not opts.invisible and (self.held_loading or Toast.loading(label, { dismissable = false })) or nil
        local body, err, errbody = fn()
        if pill and pill ~= self.held_loading then pill:close() end
        return body, err, errbody
    end
    local trap_widget
    if not opts.invisible then
        trap_widget = self.held_loading and not self.held_loading.closed and self.held_loading or Toast.loading(label)
    end
    local completed, result = self.client:runInSubprocess(fn, trap_widget)
    if trap_widget and trap_widget ~= self.held_loading then trap_widget:close() end
    if not completed then
        return nil, "cancelled"
    end
    return result.body, result.err, result.errbody
end

-- Keeps one loading pill up across several fetches (a search asks three
-- times), so it does not blink between them. fn runs inside it.
function BookOrbitCatalog:withLoading(text, fn)
    self.held_loading = Toast.loading(text)
    local ok, err = pcall(fn)
    local pill = self.held_loading
    self.held_loading = nil
    if pill then pill:close() end
    if not ok then error(err, 0) end
end

-- Wraps work that calls the API outside fetch() (bulk paging, per-book detail
-- and match checks) so it gets the same non-blocking execution contract.
function BookOrbitCatalog:runOffThread(fn)
    if Trapper:isWrapped() then
        return fn()
    end
    Trapper:wrap(fn)
end

-- Wraps a connected job in a Trapper coroutine so self:fetch can run network
-- calls in a dismissable subprocess.
function BookOrbitCatalog:runConnected(fn)
    NetworkMgr:runWhenConnected(function()
        Trapper:wrap(fn)
    end)
end

function BookOrbitCatalog:showServerError(err)
    showError(err)
end

function BookOrbitCatalog:errorText(err)
    local delivery_error = Delivery.errorText(err)
    local transfer_error = CatalogUtil.transferErrorText(err)
    if delivery_error then
        return delivery_error
    elseif transfer_error then
        return transfer_error
    elseif isAuthError(err) then
        return _("BookOrbit login failed. Check your KOReader credentials.")
    elseif type(err) == "number" then
        return T(_("BookOrbit server error (%1)."), err)
    end
    return _("Could not reach the BookOrbit server. Check your connection.")
end

function BookOrbitCatalog:emptyEntriesText(section)
    if section == "libraries" then return _("No libraries you can access.") end
    if section == "collections" then return _("No collections yet.") end
    if section == "smart-scopes" then return _("No SmartScopes yet.") end
    if section == "authors" then return _("No authors found.") end
    if section == "series" then return _("No series found.") end
    return _("Nothing here yet.")
end

function BookOrbitCatalog:emptyBooksText()
    local context = self.current_context or {}
    local params = context.params or {}
    if params.q then
        return T(_("No books match \"%1\"."), tostring(params.q))
    end
    if params.readStatus or params.format then
        return _("No books match these filters.")
    end
    return _("No books here yet.")
end

function BookOrbitCatalog:showRetry(err, retry_fn)
    Toast.error(self:errorText(err), retry_fn)
end

function BookOrbitCatalog:loadSection(section, opts)
    opts = opts or {}
    -- Libraries, collections and scopes share one Shelves page, unless a home
    -- shelf is being picked from one of them.
    if (section == "libraries" or section == "collections" or section == "smart-scopes" or section == "shelves") and not opts.dashboard_source_index then
        return self:loadShelves(opts)
    end
    local paged = (section == "authors" or section == "series")
    self:runConnected(function()
        local params
        if paged then
            self:listEnsureCapabilities()
            params = self:listSectionParams(section, opts)
        end
        local body, err = self:fetch(T(_("Opening %1…"), self:titleForSection(section)), function()
            return self.client:catalogSection(section, params)
        end)
        if not body then
            if err ~= "cancelled" then
                self:showRetry(err, function()
                    self:loadSection(section, opts)
                end)
            end
            return
        end

        local page = body.page or opts.page or 1
        local q = body.query or opts.q
        local item_table = {}

        for _, entry in ipairs(body.items or {}) do
            local entry_params = self:paramsForEntry(section, entry)
            table.insert(item_table, {
                text = entry.title,
                mandatory = entry.count and tostring(entry.count) or nil,
                kind = opts.dashboard_source_index and "dashboard-source" or "books",
                params = entry_params,
                dashboard_source_index = opts.dashboard_source_index,
                dashboard_source = opts.dashboard_source_index and {
                    type = section,
                    sourceName = entry.title,
                    params = entry_params,
                } or nil,
            })
        end

        if #item_table == 0 then
            table.insert(item_table, { text = self:emptyEntriesText(section), enabled = false })
        end
        local title = self:titleForSection(section)
        local push = not opts.replace
        self:switchTo(title, item_table, {
            kind = "section",
            title = title,
            subtitle = paged and self:sectionSubtitle(page, q, body.hasNext) or "",
            section = section,
            page = page,
            offset = body.offset,
            q = q,
            paged = paged,
            has_next = body.hasNext == true,
            has_previous = body.hasPrevious == true or page > 1,
            dashboard_source_index = opts.dashboard_source_index,
            entries = body.items or {},
            total = body.total,
            page_size = body.size or (params and params.size),
            buckets = body.buckets,
            sort = body.sort or opts.sort,
            filter = body.filter or opts.filter or nil,
        }, push)
    end)
end

function BookOrbitCatalog:reloadSection(section, overrides)
    local context = self.current_context or {}
    local opts = {
        q = context.q,
        replace = true,
        dashboard_source_index = context.dashboard_source_index,
    }
    opts.sort = context.sort
    opts.filter = context.filter
    for key, value in pairs(overrides or {}) do
        if key ~= "clear_q" then opts[key] = value end
    end
    if opts.filter == false then opts.filter = nil end
    if overrides and overrides.clear_q then opts.q = nil end
    return self:loadSection(section or context.section, opts)
end

-- The filter for an author, series or other list, in the BookOrbit text
-- panel. An empty field shows the whole list again.
function BookOrbitCatalog:promptSectionFilter(section, current_q, dashboard_source_index)
    local TextEntry = require("bookorbit_text_entry")
    local MenuUI = require("bookorbit_menu_ui")
    local filtered = current_q and current_q ~= ""
    TextEntry.open{
        title = _("Filter this list"),
        value = current_q or "",
        hint = _("Part of a name"),
        icon = "list-filter",
        allow_empty = true,
        below = function(_page, w, _max_h, has_text)
            local iw = MenuUI.rowsIn(w)
            if has_text then
                return { MenuUI.group(w, {
                    MenuUI.row(iw, { icon = "list-filter", label = _("Filter"), sub = _("Or press Enter on the keyboard"), chevron = true, bold = true, action = { kind = "submit" } }),
                }) }
            end
            if filtered then
                return { MenuUI.group(w, {
                    MenuUI.row(iw, { icon = "x", label = _("Show the whole list"), sub = T(_("Filtered by: %1"), current_q), sub_data = true, chevron = true, bold = true, action = { kind = "submit" } }),
                }) }
            end
            return {}
        end,
        on_submit = function(value)
            if value == "" and not filtered then return end
            self:reloadSection(section, {
                page = 1,
                q = value ~= "" and value or nil,
                clear_q = value == "" or nil,
                dashboard_source_index = dashboard_source_index,
            })
        end,
    }
end

function BookOrbitCatalog:titleForSection(section)
    if section == "libraries" then return _("Libraries") end
    if section == "collections" then return _("Collections") end
    if section == "smart-scopes" then return _("SmartScopes") end
    if section == "authors" then return _("Authors") end
    if section == "series" then return _("Series") end
    return _("BookOrbit")
end

function BookOrbitCatalog:paramsForEntry(section, entry)
    local params = { sort = section == "series" and "series" or "title" }
    if section == "libraries" then
        params.libraryId = tonumber(entry.id)
    elseif section == "collections" then
        params.collectionId = tonumber(entry.id)
    elseif section == "smart-scopes" then
        params.smartScopeId = tonumber(entry.id)
    elseif section == "authors" then
        params.author = entry.id
    elseif section == "series" then
        if entry.seriesId then
            params.seriesId = tonumber(entry.seriesId)
        else
            params.series = entry.id
        end
    end
    return params
end

-- Assumes an already-wrapped Trapper coroutine, so a caller that has its own
-- requests to make first can reuse it without nesting another wrap.
function BookOrbitCatalog:fetchBookPage(params, title, push)
    local query = cloneParams(params)
    query.page = query.page or 1
    query.sort = query.sort or self.default_sort or "recently_added"
    query.order = self:effectiveOrder(query)
    self:listEnsureCapabilities()
    query.size = query.size or self:listBookPageSize(query)
    self:listDecorateBookQuery(query)

    local body, err = self:fetch(title and T(_("Opening %1…"), title) or _("Opening books…"), function()
        return self.client:catalogBooks(query)
    end)
    local offline_saved_at
    if not body then
        if err ~= "cancelled" then
            -- Unreachable: the page this device saved for the same request.
            local saved = self:listSavedPage(query, err)
            if saved then
                body = saved.body
                offline_saved_at = saved.saved_at or 0
            else
                self:showRetry(err, function()
                    self:loadBooks(params, title, push)
                end)
            end
        end
        if not body then return end
    else
        self:listSavePage(query, body)
    end

    local complete, complete_err, tail_saved_at = self:listFetchCompleteSeries(query, body, title)
    if not complete then
        if complete_err ~= "cancelled" then
            self:showRetry(complete_err, function()
                self:loadBooks(params, title, push)
            end)
        end
        return
    end
    if tail_saved_at then
        offline_saved_at = offline_saved_at and math.min(offline_saved_at, tail_saved_at) or tail_saved_at
    end
    local complete_series = query.seriesId ~= nil or query.series ~= nil
    self:showBookPage(complete, query, title or _("Books"), push ~= false,
        offline_saved_at and { offline_saved_at = offline_saved_at } or { complete = complete_series })
end

function BookOrbitCatalog:loadBooks(params, title, push)
    self:runConnected(function()
        self:fetchBookPage(params, title, push)
    end)
end

function BookOrbitCatalog:loadOnDevice()
    self:refreshOnDevice()
    local ids = {}
    for book_id in pairs(self.on_device) do
        table.insert(ids, book_id)
    end
    if #ids == 0 then
        Toast.show(_("No downloaded books are linked on this device yet"), { icon = "info", timeout = 3 })
        return
    end
    table.sort(ids)
    local capped = {}
    for i = 1, math.min(#ids, ON_DEVICE_MAX_IDS) do
        if self:isOnDevice({ id = ids[i] }) then table.insert(capped, ids[i]) end
    end
    if #capped == 0 then
        Toast.show(_("No downloaded books are linked on this device yet"), { icon = "info", timeout = 3 })
        return
    end
    self:loadBooks({ ids = table.concat(capped, ","), sort = "title", on_device_filter = true }, _("On device"), true)
end

function BookOrbitCatalog:collectNotOnDeviceIds()
    return scanNotOnDeviceIds(function(page)
        return self:fetch(_("Finding books not on this device…"), function()
            return self.client:catalogBooks({
                page = page,
                size = NOT_ON_DEVICE_SCAN_SIZE,
                sort = "recently_added",
                order = "desc",
            })
        end)
    end, function(book)
        return self:isOnDevice(book)
    end)
end

function BookOrbitCatalog:loadNotOnDevice()
    self:runConnected(function()
        -- Without the maps every book reads as absent, which would list books
        -- that are already here. refreshOnDevice starts the scan; the list is
        -- worth waiting for rather than showing wrong.
        if not self:refreshOnDevice() then
            Toast.show(_("Still checking which books are on this device"), { icon = "hourglass", timeout = 3 })
            return
        end
        local ids, err = self:collectNotOnDeviceIds()
        if not ids then
            if err ~= "cancelled" then
                self:showRetry(err, function()
                    self:loadNotOnDevice()
                end)
            end
            return
        end
        if #ids == 0 then
            Toast.show(_("The newest books are already on this device"), { icon = "info", timeout = 3 })
            return
        end
        -- The tile says "Not on device"; the list says what it actually holds,
        -- since the walk covers recent additions rather than the whole library.
        self:fetchBookPage({ ids = table.concat(ids, ","), sort = "recently_added" }, _("Not on device (recent)"), true)
    end)
end

function BookOrbitCatalog:scopeParams(query)
    local params = cloneParams(query)
    params.page = nil
    params.size = nil
    params.q = nil
    return params
end

function BookOrbitCatalog:recordRecentSearch(q)
    local recents = self.settings.catalog_recent_searches or {}
    local next_list = { q }
    for _, prev in ipairs(recents) do
        if prev ~= q and #next_list < MAX_RECENT_SEARCHES then
            table.insert(next_list, prev)
        end
    end
    self:persistSetting("catalog_recent_searches", next_list)
end

function BookOrbitCatalog:runSearch(params, q, scope_title, books_only)
    q = util.trim(q or "")
    if q == "" then return end
    -- A search of the whole library finds authors and series too.
    if not books_only and not scope_title and next(params or {}) == nil then
        return self:listSearch(q)
    end
    self:recordRecentSearch(q)
    local query = cloneParams(params)
    query.q = q
    query.page = 1
    query.sort = query.sort or "title"
    local title = scope_title and scope_title ~= "" and T(_("%1 search: %2"), scope_title, q) or T(_("Search: %1"), q)
    self:loadBooks(query, title, true)
end

-- Recent searches live in the search panel itself.
function BookOrbitCatalog:showRecentSearches(params, scope_title)
    return self:promptSearch(params, scope_title)
end

-- The search panel: the field, then recent searches, over the page.
function BookOrbitCatalog:promptSearch(params, scope_title, initial)
    local TextEntry = require("bookorbit_text_entry")
    local recents = self.settings.catalog_recent_searches or {}
    local scoped = scope_title and scope_title ~= ""
    TextEntry.open{
        title = scoped and T(_("Search in %1"), scope_title) or _("Search BookOrbit"),
        value = initial or "",
        hint = _("Title, author, series or ISBN"),
        icon = "search",
        below = TextEntry.searchBelow(recents),
        on_submit = function(q)
            self:runSearch(params, q, scope_title)
        end,
        on_action = function(page, action)
            if action.kind == "recent" then
                local q = recents[action.index]
                if not q then return end
                page:close()
                UIManager:tickAfterNext(function() self:runSearch(params, q, scope_title) end)
            elseif action.kind == "clear-recents" then
                recents = {}
                self:persistSetting("catalog_recent_searches", recents)
                page.opts.below = TextEntry.searchBelow(recents)
                page:refresh()
            end
        end,
    }
end

function BookOrbitCatalog:filterSummary(query)
    local parts = {}
    if query.readStatus then
        table.insert(parts, self:readStatusFilterLabel(query.readStatus))
    end
    if query.format then
        table.insert(parts, string.upper(query.format))
    end
    return #parts > 0 and table.concat(parts, ", ") or nil
end

function BookOrbitCatalog:readStatusFilterLabel(read_status)
    for _, f in ipairs(READ_STATUS_FILTERS) do
        if f.id == read_status then
            return f.text
        end
    end
    return _("All")
end

function BookOrbitCatalog:formatFilterLabel(format)
    return format and string.upper(format) or _("All")
end

function BookOrbitCatalog:orderActionLabel(query)
    return T(_("Order: %1"), self:directionLabel(query or {}))
end

function BookOrbitCatalog:showBookPage(body, query, title, push, opts)
    opts = opts or {}
    local items = body.items or {}
    local page = body.page or query.page or 1
    local size = body.size or query.size or self:itemsPerPage()
    local total = body.total or 0
    local page_count = math.max(1, math.ceil(total / size))
    local filters = self:filterSummary(query)
    local sort_label = T(_("%1 (%2)"), self:sortLabel(query.sort), self:directionLabel(query))
    local subtitle
    if total > 0 then
        subtitle = T(_.ngettext("%1 book - Sort: %2", "%1 books - Sort: %2", total), total, sort_label)
    else
        subtitle = T(_("Sort: %1"), sort_label)
    end
    if filters then
        subtitle = subtitle .. T(_(" - Filter: %1"), filters)
    end
    if body.seriesSummary then
        subtitle = T(_("Read %1/%2 - %3"), body.seriesSummary.finished or 0, body.seriesSummary.total or total, subtitle)
    end
    local item_table = {}

    for _, book in ipairs(items) do
        table.insert(item_table, {
            text = coverLabel(book),
            kind = "book",
            book_id = book.id,
            book = book,
        })
    end

    -- The page's first entry lives on the context, not in params: every reload
    -- built from params (a new sort, a filter, a refresh) starts afresh.
    local offset = body.offset or query.offset
    local stored = cloneParams(query)
    stored.offset = nil
    self:switchTo(title, item_table, {
        kind = "books",
        title = title,
        subtitle = subtitle,
        params = stored,
        offset = offset,
        books = items,
        page = page,
        page_count = page_count,
        total = total,
        page_size = size,
        buckets = body.buckets,
        author_summary = body.authorSummary,
        series_summary = body.seriesSummary,
        on_device_filter = query.on_device_filter,
        list_offline = opts.offline_saved_at ~= nil or nil,
        list_saved_at = opts.offline_saved_at,
    }, push)

    if not opts.offline_saved_at and not opts.complete then
        if offset then
            if offset + size < total then self:prefetchNextPage(stored, nil, offset + size) end
        elseif page < page_count then
            self:prefetchNextPage(query, page + 1)
        end
    end
end

function BookOrbitCatalog:showSortDialog(item)
    local dialog
    local buttons = {}
    for _i, sort in ipairs(SORTS) do
        table.insert(buttons, {
            {
                text = sort.text .. (item.current_sort == sort.id and " *" or ""),
                callback = function()
                    UIManager:close(dialog)
                    local params = cloneParams(item.params)
                    params.sort = sort.id
                    params.order = nil
                    params.page = 1
                    self.default_sort = sort.id
                    self:persistSetting("catalog_sort", sort.id)
                    self:loadBooks(params, item.title or _("Books"), false)
                end,
            },
        })
    end
    dialog = ButtonDialog:new{
        title = _("Sort books"),
        buttons = buttons,
    }
    UIManager:show(dialog)
end

function BookOrbitCatalog:reverseOrder()
    self:applyToCurrentBooks(function(params)
        local current = self:effectiveOrder(params)
        params.order = current == "asc" and "desc" or "asc"
    end)
end

function BookOrbitCatalog:sortLabel(sort_id)
    return SORT_LABELS[sort_id] or _("Recently added")
end

function BookOrbitCatalog:effectiveOrder(query)
    local sort = query.sort or "recently_added"
    return query.order or NATURAL_ORDER[sort] or "asc"
end

function BookOrbitCatalog:directionLabel(query)
    local sort = query.sort or "recently_added"
    local kind = SORT_KIND[sort] or "alpha"
    local order = self:effectiveOrder(query)
    return DIRECTION_LABELS[kind][order]
end

function BookOrbitCatalog:applyToCurrentBooks(mutator)
    local context = self.current_context or {}
    if context.kind ~= "books" then return false end
    local params = cloneParams(context.params or {})
    if mutator then mutator(params) end
    params.page = 1
    self:loadBooks(params, context.title or _("Books"), false)
    return true
end

function BookOrbitCatalog:reloadCurrentBooks()
    return self:applyToCurrentBooks(nil)
end

function BookOrbitCatalog:setViewMode(mode)
    if mode ~= "list" and mode ~= "mosaic" then return end
    if self.view_mode == mode then return end
    self.view_mode = mode
    self:persistSetting("catalog_view_mode", mode)
    if self:bookMode() then
        self:reloadCurrentBooks()
    end
end

function BookOrbitCatalog:setGrid(cols, rows)
    self.grid_cols = self:sanitizeGridValue(cols, DEFAULT_GRID_COLUMNS)
    self.grid_rows = self:sanitizeGridValue(rows, DEFAULT_GRID_ROWS)
    self:persistSetting("catalog_grid_cols", self.grid_cols)
    self:persistSetting("catalog_grid_rows", self.grid_rows)
    if self:bookMode() and self.view_mode == "mosaic" then
        self:reloadCurrentBooks()
    end
end

function BookOrbitCatalog:setMosaicShowTitles(show_titles)
    show_titles = show_titles == true
    if self.mosaic_show_titles == show_titles then return end
    self.mosaic_show_titles = show_titles
    self:persistSetting("catalog_mosaic_show_titles", show_titles)
    if self:bookMode() and self.view_mode == "mosaic" then
        self:updateItems()
    end
end

function BookOrbitCatalog:toggleMosaicTitles()
    self:setMosaicShowTitles(not self.mosaic_show_titles)
end

function BookOrbitCatalog:showGridDialog()
    local dialog
    local grid_label = _("%1 x %2")
    local buttons = {}
    for _, preset in ipairs(GRID_PRESETS) do
        local cols, rows = preset[1], preset[2]
        local is_current = cols == self.grid_cols and rows == self.grid_rows
        table.insert(buttons, {
            {
                text = T(grid_label, cols, rows) .. (is_current and " *" or ""),
                callback = function()
                    UIManager:close(dialog)
                    self:setGrid(cols, rows)
                end,
            },
        })
    end
    dialog = ButtonDialog:new{
        title = _("Grid (columns x rows)"),
        buttons = buttons,
    }
    UIManager:show(dialog)
end

function BookOrbitCatalog:showReadStatusDialog()
    local context = self.current_context or {}
    local current = (context.params or {}).readStatus
    local dialog
    local buttons = {}
    for _, filter in ipairs(READ_STATUS_FILTERS) do
        table.insert(buttons, {
            {
                text = filter.text .. (current == filter.id and " *" or ""),
                callback = function()
                    UIManager:close(dialog)
                    self:applyToCurrentBooks(function(params)
                        params.readStatus = filter.id
                    end)
                end,
            },
        })
    end
    dialog = ButtonDialog:new{
        title = _("Read status"),
        buttons = buttons,
    }
    UIManager:show(dialog)
end

function BookOrbitCatalog:showFormatDialog()
    local context = self.current_context or {}
    local current = (context.params or {}).format
    local dialog
    local buttons = {
        {
            {
                text = _("All") .. (current == nil and " *" or ""),
                callback = function()
                    UIManager:close(dialog)
                    self:applyToCurrentBooks(function(params)
                        params.format = nil
                    end)
                end,
            },
        },
    }
    for _, fmt in ipairs(COMMON_FORMATS) do
        if isSupportedFormat(fmt) then
            table.insert(buttons, {
                {
                    text = string.upper(fmt) .. (current == fmt and " *" or ""),
                    callback = function()
                        UIManager:close(dialog)
                        self:applyToCurrentBooks(function(params)
                            params.format = fmt
                        end)
                    end,
                },
            })
        end
    end
    dialog = ButtonDialog:new{
        title = _("Format"),
        buttons = buttons,
    }
    UIManager:show(dialog)
end

-- Downloading from the list on screen: the plan sheet offers what applies
-- (the selection, this page, everything in the list) and how.
function BookOrbitCatalog:showDownloadActions()
    local context = self.current_context or {}
    local scopes = {}
    local count = function(n) return T(_.ngettext("%1 book", "%1 books", n), n) end
    local selected = self:isBulkSelectionActive() and not self.bulk_select_all and self:bulkSelectedCount() > 0
    if selected then
        local books = self:bulkSelectedBooks()
        self:refreshOnDevice()
        table.insert(scopes, { label = _("The books you selected"), sub = count(#books), source = {
            kind = "ids", label = _("Selected books"), total = #books, ids = (function()
                local ids = {}
                for _i, b in ipairs(books) do table.insert(ids, b.id) end
                return ids
            end)(), books = books, known_skips = self:bulkCountKnownSkips(books), clear_selection = true,
        } })
    end
    if self:bookMode() and #(self.item_table or {}) > 0 then
        local books = self:bulkCurrentPageBooks()
        local ids = {}
        for _i, b in ipairs(books) do table.insert(ids, b.id) end
        table.insert(scopes, { label = _("This page"), sub = count(#books), source = {
            kind = "ids", label = _("Current page"), total = #books, ids = ids, books = books, known_skips = self:bulkCountKnownSkips(books),
        } })
    end
    if self:bookMode() and (context.total or 0) > 0 then
        table.insert(scopes, { label = _("Everything in this list"), sub = count(context.total), source = {
            kind = "filter", label = context.title or _("Current list"), total = context.total, params = self:bulkListParams(context),
        } })
    end
    if #scopes == 0 then return self:showBulkDownloadSettings() end
    require("bookorbit_bulk_sheet").openPlan(self, {
        sub = context.title,
        scopes = scopes,
        -- What the reader was picking, or else the whole list.
        scope = selected and 1 or #scopes,
        on_download = function(source) self:bulkStart(source) end,
    })
end

function BookOrbitCatalog:showBookActions()
    local context = self.current_context or {}
    local in_books = context.kind == "books"
    local in_section = context.kind == "section"
    local params = in_books and self:scopeParams(context.params or {}) or {}
    local query = context.params or {}
    local view_label = self.view_mode == "list" and _("View: List") or _("View: Mosaic")
    local grid_label = T(_("%1 x %2"), self.grid_cols, self.grid_rows)
    local titles_label = self.mosaic_show_titles and _("Titles: Shown") or _("Titles: Hidden")
    local dialog
    local buttons = {
        {
            {
                text = _("Refresh"),
                callback = function()
                    UIManager:close(dialog)
                    self:refreshCurrent()
                end,
            },
        },
    }

    if in_section and context.paged then
        table.insert(buttons, {
            {
                text = context.q and T(_("Filter: %1"), context.q) or _("Filter..."),
                callback = function()
                    UIManager:close(dialog)
                    self:promptSectionFilter(context.section, context.q, context.dashboard_source_index)
                end,
            },
            {
                text = _("Clear filter"),
                enabled = context.q ~= nil,
                callback = function()
                    UIManager:close(dialog)
                    self:reloadSection(context.section, { page = 1, clear_q = true })
                end,
            },
        })
    end

    if in_books then
        table.insert(buttons, {
            {
                text = _("Select books"),
                callback = function()
                    UIManager:close(dialog)
                    self:bulkEnterSelectionMode()
                end,
            },
            {
                text = _("Download..."),
                callback = function()
                    UIManager:close(dialog)
                    self:showDownloadActions()
                end,
            },
        })
        table.insert(buttons, {
            {
                text = T(_("Sort: %1"), self:sortLabel(query.sort)),
                callback = function()
                    UIManager:close(dialog)
                    self:showSortDialog({
                        params = params,
                        current_sort = query.sort,
                        title = context.title,
                    })
                end,
            },
            {
                text = self:orderActionLabel(query),
                callback = function()
                    UIManager:close(dialog)
                    self:reverseOrder()
                end,
            },
        })
        table.insert(buttons, {
            {
                text = T(_("Status: %1"), self:readStatusFilterLabel(query.readStatus)),
                callback = function()
                    UIManager:close(dialog)
                    self:showReadStatusDialog()
                end,
            },
            {
                text = T(_("Format: %1"), self:formatFilterLabel(query.format)),
                callback = function()
                    UIManager:close(dialog)
                    self:showFormatDialog()
                end,
            },
        })
        table.insert(buttons, {
            {
                text = view_label,
                callback = function()
                    UIManager:close(dialog)
                    self:setViewMode(self.view_mode == "list" and "mosaic" or "list")
                end,
            },
            {
                text = T(_("Grid: %1"), grid_label),
                enabled = self.view_mode == "mosaic",
                callback = function()
                    UIManager:close(dialog)
                    self:showGridDialog()
                end,
            },
        })
        table.insert(buttons, {
            {
                text = titles_label,
                enabled = self.view_mode == "mosaic",
                callback = function()
                    UIManager:close(dialog)
                    self:toggleMosaicTitles()
                end,
            },
        })
    end

    if not self:dashboardMode() then
        table.insert(buttons, {
            {
                text = _("Dashboard"),
                callback = function()
                    UIManager:close(dialog)
                    self:goDashboard()
                end,
            },
        })
    end

    table.insert(buttons, {
        {
            text = _("Close BookOrbit"),
            callback = function()
                UIManager:close(dialog)
                self:onCloseAllMenus()
            end,
        },
    })

    dialog = ButtonDialog:new{
        title = _("BookOrbit"),
        buttons = buttons,
    }
    UIManager:show(dialog)
end

function BookOrbitCatalog:showWriteError(err)
    local text
    if err == 404 or err == 405 then
        text = _("This BookOrbit server does not support catalog edits.")
    elseif isAuthError(err) then
        text = _("BookOrbit login failed. Check your KOReader credentials.")
    else
        text = self:errorText(err)
    end
    Toast.error(text)
end

function BookOrbitCatalog:contextUsesActions()
    return true
end

function BookOrbitCatalog:updateLeftIcon()
    if not self.title_bar then return end
    self.title_bar:setLeftIcon(self:titleBarLeftIcon())
end

function BookOrbitCatalog:onLeftButtonTap()
    if self:isBulkSelectionActive() then
        self:showBulkSelectionActions()
    elseif self:detailMode() then
        self:goDashboard()
    elseif self.show_dashboard_menu then
        -- The BookOrbit menu on every page; a list's sort and filter options
        -- are its first row there.
        self.show_dashboard_menu(self)
    else
        self:showBookActions()
    end
    return true
end

-- KOReader's menu gesture, a swipe down from the top edge, opens the
-- BookOrbit menu here as it opens KOReader's own menu everywhere else.
function BookOrbitCatalog:onTopEdgeSwipe(ges)
    if not ges or ges.direction ~= "south" or not self.show_dashboard_menu then return false end
    if self:isBulkSelectionActive() then return false end
    self.show_dashboard_menu(self)
    return true
end

function BookOrbitCatalog:onLeftButtonHold()
    return true
end

function BookOrbitCatalog:onRightButtonTap()
    return true
end

function BookOrbitCatalog:onSearchButtonTap()
    if self:isBulkSelectionActive() then
        if self:bulkSelectedCount() > 0 then
            self:confirmBulkBooks(self:bulkSelectedBooks(), _("Selected books"), { clear_selection = true })
        end
        return true
    end

    local context = self.current_context or {}
    if context.kind == "books" then
        self:promptSearch(self:scopeParams(context.params or {}), context.title)
    else
        self:promptSearch({}, nil)
    end
    return true
end

function BookOrbitCatalog:onRefreshButtonTap()
    if self:isBulkSelectionActive() then
        self:bulkExitSelectionMode()
        return true
    end

    self:refreshCurrent()
    return true
end

function BookOrbitCatalog:dashboardMode()
    return self.current_context and self.current_context.kind == "dashboard"
end

function BookOrbitCatalog:bookMode()
    return self.current_context and self.current_context.kind == "books"
end

function BookOrbitCatalog:detailMode()
    return self.current_context and self.current_context.kind == "detail"
end

function BookOrbitCatalog:pagedSectionMode()
    return self.current_context and self.current_context.kind == "section" and self.current_context.paged
end

function BookOrbitCatalog:_recalculateDimen(no_recalculate_dimen)
    if self:listMode() then
        return self:recalculateListPageDimen()
    elseif self:dashboardMode() then
        return self:recalculateDashboardDimen()
    elseif self:bookMode() then
        if self.view_mode == "list" then
            return self:recalculateListDimen()
        end
        return self:recalculateMosaicDimen()
    elseif self:detailMode() then
        return self:recalculateDetailDimen()
    end
    return Menu_recalculateDimen(self, no_recalculate_dimen)
end

function BookOrbitCatalog:menuChromeHeight()
    local top_height = 0
    if self.title_bar and not self.no_title then
        top_height = self.title_bar:getHeight()
    end
    local bottom_height = 0
    if self:dashboardMode() or self:detailMode() or self:listMode() then
        -- The board, the detail page and the lists draw their own footers.
        bottom_height = 0
    elseif self.page_return_arrow and self.page_info_text then
        bottom_height = math.max(self.page_return_arrow:getSize().h, self.page_info_text:getSize().h)
            + px(2)
    end
    return top_height, bottom_height
end

function BookOrbitCatalog:getAdjacentDetailBooks()
    local detail = self.current_context and self.current_context.detail
    if not detail then return nil, nil, nil, nil end

    local parent = self.stack[#self.stack]
    local parent_context = parent and parent.context
    -- A home widget hands over the list it showed (Continue reading, a shelf).
    local list = self.current_context.list
    local books = list and list.books or (parent_context and parent_context.books)
    if not books or #books == 0 then return nil, nil, nil, nil end

    local current_idx
    for idx, book in ipairs(books) do
        if book.id == detail.id then
            current_idx = idx
            break
        end
    end

    if not current_idx then return nil, nil, nil, nil end
    return books[current_idx - 1], books[current_idx + 1], current_idx, #books
end

function BookOrbitCatalog:loadAdjacentPageBook(page, select_first)
    local parent = self.stack[#self.stack]
    local parent_context = parent and parent.context
    if not parent_context or not parent_context.params then return end

    local query = cloneParams(parent_context.params)
    query.page = page
    query.size = parent_context.params.size or self:itemsPerPage()

    self:runConnected(function()
        local body, err = self:fetch(_("Loading the next page…"), function()
            return self.client:catalogBooks(query)
        end)
        if not body then
            if err ~= "cancelled" then
                self:showRetry(err, function()
                    self:loadAdjacentPageBook(page, select_first)
                end)
            end
            return
        end

        local new_items = body.items or {}
        if #new_items == 0 then return end

        parent_context.page = page
        parent_context.books = new_items

        local item_table = {}
        for _, book in ipairs(new_items) do
            table.insert(item_table, {
                text = coverLabel(book),
                kind = "book",
                book_id = book.id,
                book = book,
            })
        end
        parent.item_table = item_table

        local page_count = math.max(1, math.ceil((body.total or 0) / (body.size or query.size)))
        parent_context.page_count = page_count
        parent_context.total = body.total or 0

        local target_book = select_first and new_items[1] or new_items[#new_items]
        self:loadBookDetail(target_book.id)
    end)
end

-- Dashboard/detail pages are custom single-page views that draw their own
-- header and footer (the detail page's footer is its book pager), so the
-- inherited pagination controls are hidden there.
function BookOrbitCatalog:updatePageInfo(select_number)
    Menu.updatePageInfo(self, select_number)
    if self:dashboardMode() or self:detailMode() or self:listMode() then
        self.page_info_text:setText("")
        self.page_info_left_chev:hide()
        self.page_info_right_chev:hide()
        self.page_info_first_chev:hide()
        self.page_info_last_chev:hide()
        self.page_return_arrow:hide()
    elseif self:pagedSectionMode() then
        local context = self.current_context
        local api_page = context.page or 1
        self.page_info_left_chev:show()
        self.page_info_right_chev:show()
        self.page_info_first_chev:show()
        self.page_info_last_chev:show()
        self.page_info_left_chev:enableDisable(self.page > 1 or api_page > 1)
        self.page_info_right_chev:enableDisable(self.page < self.page_num or context.has_next == true)
        self.page_info_first_chev:enableDisable(self.page > 1 or api_page > 1)
        self.page_info_last_chev:enableDisable(self.page < self.page_num)
        self.page_return_arrow:showHide(self.onReturn ~= nil)
        self.page_return_arrow:enableDisable(#self.paths > 0)
    end
    -- An empty page-number button still paints its white background, right
    -- over the board's own footer. Button:hide only applies to icon buttons,
    -- so the background is lifted here and put back for the other views.
    local frame = self.page_info_text and self.page_info_text.frame
    if frame then
        if self:dashboardMode() or self:detailMode() or self:listMode() then
            if frame.background then
                self._page_info_background = frame.background
                frame.background = nil
            end
        elseif self._page_info_background then
            frame.background = self._page_info_background
            self._page_info_background = nil
        end
    end
end

function BookOrbitCatalog:recalculateMosaicDimen()
    local cols, rows = self:effectiveGridDimensions()
    self.layout_grid_cols, self.layout_grid_rows = cols, rows
    self.perpage = cols * rows
    self.page = self.current_context.page or 1
    self.page_num = self.current_context.page_count or 1
    local top_height, bottom_height = self:menuChromeHeight()
    self.available_height = self.inner_dimen.h - top_height - bottom_height
    self.item_margin = px(10)
    self.item_height = math.floor((self.available_height - (rows + 1) * self.item_margin) / rows)
    self.item_width = math.floor((self.inner_dimen.w - (cols + 1) * self.item_margin) / cols)
    self.item_dimen = Geom:new{
        x = 0,
        y = 0,
        w = self.item_width,
        h = self.item_height,
    }
end

function BookOrbitCatalog:updateItems(select_number, no_recalculate_dimen)
    if self:listMode() then
        return self:updateListPage(select_number, no_recalculate_dimen)
    elseif self:dashboardMode() then
        return self:updateDashboardItems(select_number, no_recalculate_dimen)
    elseif self:bookMode() then
        if self.view_mode == "list" then
            return self:updateListItems(select_number, no_recalculate_dimen)
        end
        return self:updateMosaicItems(select_number, no_recalculate_dimen)
    elseif self:detailMode() then
        return self:updateDetailItems(select_number, no_recalculate_dimen)
    end
    -- A plain Menu page does not go through prepareCustomUpdate, so drop the
    -- remembered cursor here: coming back to the dashboard later must not
    -- restore coordinates that belong to this list.
    -- Menu builds its own layout and merges the title bar; the footer, and
    -- putting the cursor back on it, are ours. saveCustomFocus also clears the
    -- remembered page key, so returning to the dashboard later cannot restore
    -- coordinates that belong to this list.
    self:saveCustomFocus()
    local result = Menu_updateItems(self, select_number, no_recalculate_dimen)
    self:makeMenuItemsFocusable()
    local footer_row = self:footerFocusRow()
    if footer_row then table.insert(self.layout, footer_row) end
    self:restoreCustomFocus()
    self:refocusCurrentRow()
    return result
end

function BookOrbitCatalog:prepareCustomUpdate(no_recalculate_dimen)
    local old_dimen = self.dimen and self.dimen:copy()
    local context = self.current_context or {}
    self:resetTitleBar(context.title or self.title, context.subtitle or "")
    self:saveCustomFocus()
    self.layout = {}
    self.item_group:clear()
    self.page_info:resetLayout()
    self.return_button:resetLayout()
    self.content_group:resetLayout()
    self:_recalculateDimen(no_recalculate_dimen)
    return old_dimen
end

function BookOrbitCatalog:finishCustomUpdate(old_dimen, select_number)
    self:updatePageInfo(select_number)
    self:mergeTitleBarIntoLayout()
    -- After the title bar, so the footer stays the last row the cursor reaches.
    local footer_row = self:footerFocusRow()
    if footer_row then table.insert(self.layout, footer_row) end
    self:restoreCustomFocus()
    -- A view may narrow the e-ink refresh to the region it actually changed
    -- (the dashboard does for row page turns); everything else refreshes the
    -- whole menu as before.
    local refresh_region = self.custom_refresh_region
    self.custom_refresh_region = nil
    UIManager:setDirty(self.show_parent, function()
        if refresh_region then
            return "ui", refresh_region
        end
        local refresh_dimen = old_dimen and old_dimen:combine(self.dimen) or self.dimen
        return "ui", refresh_dimen
    end)
end

function BookOrbitCatalog:updateMosaicItems(select_number, no_recalculate_dimen)
    local old_dimen = self:prepareCustomUpdate(no_recalculate_dimen)
    local items = self.item_table or {}
    local selected_number = select_number

    if #items == 0 then
        table.insert(self.item_group, VerticalSpan:new{ width = math.floor(self.available_height * 0.38) })
        table.insert(self.item_group, CenterContainer:new{
            dimen = Geom:new{ w = self.inner_dimen.w, h = px(80) },
            TextBoxWidget:new{
                text = self:emptyBooksText(),
                width = self.inner_dimen.w - 2 * px(10),
                alignment = "center",
                face = BoardMetrics.namedFace("infofont", 24),
            },
        })
        self:finishCustomUpdate(old_dimen, selected_number)
        return
    end

    local cols, rows = self.layout_grid_cols, self.layout_grid_rows
    for row = 1, rows do
        local line_layout = {}
        table.insert(self.item_group, VerticalSpan:new{ width = self.item_margin })
        local row_group = HorizontalGroup:new{}
        table.insert(row_group, HorizontalSpan:new{ width = self.item_margin })
        for col = 1, cols do
            local slot = (row - 1) * cols + col
            local entry = items[slot]
            if entry then
                entry.idx = slot
                local item = BookOrbitMosaicItem:new{
                    entry = entry,
                    text = entry.text,
                    dimen = self.item_dimen:copy(),
                    menu = self,
                }
                if entry.idx == self.itemnumber then
                    selected_number = slot
                end
                table.insert(row_group, item)
                table.insert(line_layout, item)
            else
                table.insert(row_group, CenterContainer:new{
                    dimen = Geom:new{ w = self.item_width, h = self.item_height },
                    HorizontalSpan:new{ width = 0 },
                })
            end
            table.insert(row_group, HorizontalSpan:new{ width = self.item_margin })
        end
        table.insert(self.item_group, CenterContainer:new{
            dimen = Geom:new{ w = self.inner_dimen.w, h = self.item_height },
            row_group,
        })
        if #line_layout > 0 then
            table.insert(self.layout, line_layout)
        end
    end
    table.insert(self.item_group, VerticalSpan:new{ width = self.item_margin })
    self:finishCustomUpdate(old_dimen, selected_number)
end

function BookOrbitCatalog:recalculateListDimen()
    self.perpage = self.list_rows
    self.page = self.current_context.page or 1
    self.page_num = self.current_context.page_count or 1
    local top_height, bottom_height = self:menuChromeHeight()
    self.available_height = self.inner_dimen.h - top_height - bottom_height
    self.item_margin = px(4)
    self.item_height = math.floor((self.available_height - (self.list_rows + 1) * self.item_margin) / self.list_rows)
    self.item_width = self.inner_dimen.w - 2 * self.item_margin
    self.item_dimen = Geom:new{
        x = 0,
        y = 0,
        w = self.item_width,
        h = self.item_height,
    }
end

function BookOrbitCatalog:updateListItems(select_number, no_recalculate_dimen)
    local old_dimen = self:prepareCustomUpdate(no_recalculate_dimen)
    local items = self.item_table or {}
    local selected_number = select_number

    if #items == 0 then
        table.insert(self.item_group, VerticalSpan:new{ width = math.floor(self.available_height * 0.38) })
        table.insert(self.item_group, CenterContainer:new{
            dimen = Geom:new{ w = self.inner_dimen.w, h = px(80) },
            TextBoxWidget:new{
                text = self:emptyBooksText(),
                width = self.inner_dimen.w - 2 * px(10),
                alignment = "center",
                face = BoardMetrics.namedFace("infofont", 24),
            },
        })
        self:finishCustomUpdate(old_dimen, selected_number)
        return
    end

    for idx = 1, self.list_rows do
        local entry = items[idx]
        table.insert(self.item_group, VerticalSpan:new{ width = self.item_margin })
        if entry then
            entry.idx = idx
            local item = BookOrbitListItem:new{
                entry = entry,
                dimen = self.item_dimen:copy(),
                menu = self,
            }
            if entry.idx == self.itemnumber then
                selected_number = idx
            end
            table.insert(self.item_group, CenterContainer:new{
                dimen = Geom:new{ w = self.inner_dimen.w, h = self.item_height },
                item,
            })
            table.insert(self.layout, { item })
        else
            table.insert(self.item_group, CenterContainer:new{
                dimen = Geom:new{ w = self.inner_dimen.w, h = self.item_height },
                HorizontalSpan:new{ width = 0 },
            })
        end
    end
    table.insert(self.item_group, VerticalSpan:new{ width = self.item_margin })
    self:finishCustomUpdate(old_dimen, selected_number)
end

function BookOrbitCatalog:onGotoPage(page)
    if self:listMode() then
        return self:listGoPage(page)
    elseif self:bookMode() then
        local context = self.current_context
        if page < 1 or page > (context.page_count or 1) or page == context.page then
            return true
        end
        local params = cloneParams(context.params)
        params.page = page
        self:loadBooks(params, context.title, false)
        return true
    elseif self:detailMode() then
        return true
    end
    return Menu_onGotoPage(self, page)
end

function BookOrbitCatalog:onNextPage()
    if self:listMode() then
        return self:listPage(1)
    elseif self:dashboardMode() then
        return self:boardFlip(1)
    elseif self:bookMode() then
        local context = self.current_context
        if context.page < context.page_count then
            return self:onGotoPage(context.page + 1)
        end
        return true
    elseif self:pagedSectionMode() then
        if self.page < self.page_num then
            return Menu_onNextPage(self)
        end
        local context = self.current_context
        if context.has_next then
            self:reloadSection(context.section, { page = (context.page or 1) + 1 })
        end
        return true
    elseif self:detailMode() then
        local prev_book, next_book = self:getAdjacentDetailBooks()
        if next_book then
            self:loadBookDetail(next_book.id, { list = self.current_context.list })
        elseif not self.current_context.list then
            local parent = self.stack[#self.stack]
            local parent_context = parent and parent.context
            if parent_context and parent_context.page and parent_context.page_count and parent_context.page < parent_context.page_count then
                self:loadAdjacentPageBook(parent_context.page + 1, true)
            end
        end
        return true
    end
    return Menu_onNextPage(self)
end

function BookOrbitCatalog:onPrevPage()
    if self:listMode() then
        return self:listPage(-1)
    elseif self:dashboardMode() then
        return self:boardFlip(-1)
    elseif self:bookMode() then
        local context = self.current_context
        if context.page > 1 then
            return self:onGotoPage(context.page - 1)
        end
        return true
    elseif self:pagedSectionMode() then
        if self.page > 1 then
            return Menu_onPrevPage(self)
        end
        local context = self.current_context
        if (context.page or 1) > 1 then
            self:reloadSection(context.section, { page = (context.page or 1) - 1 })
        end
        return true
    elseif self:detailMode() then
        local prev_book = self:getAdjacentDetailBooks()
        if prev_book then
            self:loadBookDetail(prev_book.id, { list = self.current_context.list })
        elseif not self.current_context.list then
            local parent = self.stack[#self.stack]
            local parent_context = parent and parent.context
            if parent_context and parent_context.page and parent_context.page > 1 then
                self:loadAdjacentPageBook(parent_context.page - 1, false)
            end
        end
        return true
    end
    return Menu_onPrevPage(self)
end

function BookOrbitCatalog:onFirstPage()
    if self:listMode() then
        return self:listGoPage(1)
    elseif self:bookMode() then
        return self:onGotoPage(1)
    elseif self:pagedSectionMode() then
        if self.page > 1 then
            return Menu_onFirstPage(self)
        end
        local context = self.current_context
        if (context.page or 1) > 1 then
            self:reloadSection(context.section, { page = 1 })
        end
        return true
    elseif self:detailMode() then
        local parent = self.stack[#self.stack]
        local parent_context = parent and parent.context
        if parent_context then
            if parent_context.page == 1 then
                if parent_context.books and parent_context.books[1] then
                    self:loadBookDetail(parent_context.books[1].id)
                end
            else
                self:loadAdjacentPageBook(1, true)
            end
        end
        return true
    end
    return Menu_onFirstPage(self)
end

function BookOrbitCatalog:onLastPage()
    if self:listMode() then
        local p = self:listPaging()
        return self:listGoPage(p.pages or p.page)
    elseif self:bookMode() then
        return self:onGotoPage(self.current_context.page_count or 1)
    elseif self:pagedSectionMode() then
        if self.page < self.page_num then
            return Menu_onLastPage(self)
        end
        return true
    elseif self:detailMode() then
        local parent = self.stack[#self.stack]
        local parent_context = parent and parent.context
        if parent_context and parent_context.page_count then
            if parent_context.page == parent_context.page_count then
                if parent_context.books and #parent_context.books > 0 then
                    self:loadBookDetail(parent_context.books[#parent_context.books].id)
                end
            else
                self:loadAdjacentPageBook(parent_context.page_count, false)
            end
        end
        return true
    end
    return Menu_onLastPage(self)
end

function BookOrbitCatalog:onMenuSelect(item)
    if item.kind == "section" then
        self:loadSection(item.section)
    elseif item.kind == "dashboard-book" then
        -- Continue-reading heroes resume the book directly when it is on the
        -- device; hold still opens the full action sheet.
        local resume_path = item.resume and self:dashboardResumePath(item.book) or nil
        if resume_path then
            self:openDownloadedFile(resume_path)
        else
            self:loadBookDetail(item.book_id, { list = item.list })
        end
    elseif item.kind == "section-filter" then
        local context = self.current_context or {}
        self:promptSectionFilter(item.section, item.q, context.dashboard_source_index)
    elseif item.kind == "section-page" then
        self:reloadSection(item.section, {
            page = item.section_page,
            q = item.q,
        })
    elseif item.kind == "dashboard-source" then
        local source = item.dashboard_source
        if source and type(source.sourceName) == "string" and source.sourceName ~= "" then
            self:boardAddPickedShelf(source)
        end
    elseif item.kind == "on-device" then
        self:loadOnDevice()
    elseif item.kind == "not-on-device" then
        self:loadNotOnDevice()
    elseif item.kind == "books" then
        self:loadBooks(item.params or {}, item.list_title or item.text)
    elseif item.kind == "book" then
        if self:isBulkSelectionActive() then
            self:bulkToggleEntry(item)
        else
            self:loadBookDetail(item.book_id)
        end
    elseif item.kind == "sort" then
        self:showSortDialog(item)
    end
    return true
end

function BookOrbitCatalog:onMenuHoldSelect(item)
    if item.kind == "book" or item.kind == "dashboard-book" then
        self:showBookActionSheetForEntry(item)
        return true
    end
    return self:onMenuSelect(item)
end

-- Back walks up the browsing stack on a device that cannot reach the footer's
-- return arrow; see CatalogFocus:shouldReturnOnBack for why.
function BookOrbitCatalog:onClose()
    -- On the detail page Back closes an open sheet, then More details,
    -- before it does anything else.
    local context = self.current_context
    if self:detailMode() and context and (context.detail_sheet or (context.detail_page or 1) == 2) then
        return self:detailBack()
    end
    if context and context.list_sheet then
        if context.list_sheet.kind == "sort" then return self:listApplySheet() end
        return self:listCloseSheet()
    end
    if self:shouldReturnOnBack() then
        return self:onReturn()
    end
    return Menu_onClose(self)
end

function BookOrbitCatalog:onReturn()
    self:cancelThumbnailJobs()
    local previous = table.remove(self.stack)
    local dirty = false
    if previous then
        self:restoreFocusOnNextUpdate(previous.focus)
        self.current_context = previous.context
        dirty = self.current_context.dirty == true
        self.current_context.dirty = nil
        self:updateReturnPath()
        if self.bulkHandleContextChange then
            self:bulkHandleContextChange(self.current_context)
        end
        self:resetTitleBar(previous.title, previous.subtitle or "")
        self:switchItemTable(previous.title, previous.item_table, nil, nil, previous.subtitle or "")
        if self.current_context.kind == "books" then
            self:scheduleThumbnailDownloads(self.current_context.books or {})
        elseif self.current_context.kind == "detail" then
            self:scheduleThumbnailDownloads({ self.current_context.detail })
        elseif self.current_context.kind == "dashboard" then
            self:scheduleThumbnailDownloads(self.dashboardBooks(self.current_context.dashboard))
        end
    else
        -- Returning past the root shows the cached dashboard immediately and
        -- refreshes it behind the redraw, like opening the catalog does.
        self.item_table, self.current_context = self:initialDashboardContext()
        self:updateReturnPath()
        if self.bulkHandleContextChange then
            self:bulkHandleContextChange(self.current_context)
        end
        self:resetTitleBar(
            self.current_context.title or self.title,
            self.current_context.subtitle or "")
        self:switchItemTable(
            self.current_context.title or self.title,
            self.item_table,
            nil,
            nil,
            self.current_context.subtitle or "")
        if self.current_context.kind == "dashboard" then
            self:scheduleThumbnailDownloads(self.dashboardBooks(self.current_context.dashboard))
        end
        UIManager:nextTick(function()
            self:refreshDashboardOnOpen()
        end)
    end
    self:updateLeftIcon()
    if dirty then
        self:refreshCurrent()
    end
    return true
end

function BookOrbitCatalog:onHoldReturn()
    self:cancelThumbnailJobs()
    self:goDashboard()
    return true
end

function BookOrbitCatalog:onCloseWidget()
    self.catalog_closed = true
    self.dashboard_request_generation = self.dashboard_request_generation + 1
    self.on_device_hydration_generation = self.on_device_hydration_generation + 1
    self:cancelThumbnailJobs()
    if self.bulk_ctx then
        local ctx = self.bulk_ctx
        self.bulk_running = false
        self.bulk_ctx = nil
        if ctx.progress_dialog then
            UIManager:close(ctx.progress_dialog)
            ctx.progress_dialog = nil
        end
    end
    return Menu.onCloseWidget(self)
end

return BookOrbitCatalog
