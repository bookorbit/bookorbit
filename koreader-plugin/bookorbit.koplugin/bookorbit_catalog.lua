--[[--
Native BookOrbit catalog browser.

Uses BookOrbit's KOReader-authenticated JSON catalog endpoints. Book result
pages render as KOReader-style menu pages with a cover mosaic and progressive
thumbnail loading.

The controller is split across modules: bookorbit_catalog_util (constants and
pure helpers), bookorbit_catalog_widgets (cover and item widgets) and
bookorbit_catalog_download (download manager mixin). Navigation fetches run off
the UI thread via Trapper so taps never freeze the reader.
]]

local BD = require("ui/bidi")
local Button = require("ui/widget/button")
local ButtonDialog = require("ui/widget/buttondialog")
local CenterContainer = require("ui/widget/container/centercontainer")
local DataStorage = require("datastorage")
local Device = require("device")
local Font = require("ui/font")
local FrameContainer = require("ui/widget/container/framecontainer")
local Geom = require("ui/geometry")
local HorizontalGroup = require("ui/widget/horizontalgroup")
local HorizontalSpan = require("ui/widget/horizontalspan")
local InfoMessage = require("ui/widget/infomessage")
local InputDialog = require("ui/widget/inputdialog")
local Menu = require("ui/widget/menu")
local NetworkMgr = require("ui/network/manager")
local Size = require("ui/size")
local TextBoxWidget = require("ui/widget/textboxwidget")
local TextViewer = require("ui/widget/textviewer")
local Trapper = require("ui/trapper")
local UIManager = require("ui/uimanager")
local VerticalGroup = require("ui/widget/verticalgroup")
local VerticalSpan = require("ui/widget/verticalspan")
local lfs = require("libs/libkoreader-lfs")
local logger = require("logger")
local util = require("util")
local T = require("ffi/util").template
local _ = require("gettext")

local BookOrbitApi = require("bookorbit_api")
local BookOrbitState = require("bookorbit_state")
local CatalogUtil = require("bookorbit_catalog_util")
local CatalogWidgets = require("bookorbit_catalog_widgets")
local CatalogDownload = require("bookorbit_catalog_download")

local Screen = Device.screen

local DEFAULT_GRID_COLUMNS = CatalogUtil.DEFAULT_GRID_COLUMNS
local DEFAULT_GRID_ROWS = CatalogUtil.DEFAULT_GRID_ROWS
local THUMBNAIL_BATCH_SIZE = CatalogUtil.THUMBNAIL_BATCH_SIZE
local MAX_RECENT_SEARCHES = CatalogUtil.MAX_RECENT_SEARCHES
local ON_DEVICE_MAX_IDS = CatalogUtil.ON_DEVICE_MAX_IDS
local SORTS = CatalogUtil.SORTS
local SORT_LABELS = CatalogUtil.SORT_LABELS
local NATURAL_ORDER = CatalogUtil.NATURAL_ORDER
local SORT_KIND = CatalogUtil.SORT_KIND
local DIRECTION_LABELS = CatalogUtil.DIRECTION_LABELS
local READ_STATUS_FILTERS = CatalogUtil.READ_STATUS_FILTERS
local READ_STATUS_LABELS = CatalogUtil.READ_STATUS_LABELS
local SETTABLE_READ_STATUSES = CatalogUtil.SETTABLE_READ_STATUSES
local COMMON_FORMATS = CatalogUtil.COMMON_FORMATS
local GRID_PRESETS = CatalogUtil.GRID_PRESETS

local isAuthError = CatalogUtil.isAuthError
local cloneParams = CatalogUtil.cloneParams
local formatBytes = CatalogUtil.formatBytes
local formatDuration = CatalogUtil.formatDuration
local formatProgress = CatalogUtil.formatProgress
local formatRating = CatalogUtil.formatRating
local isSupportedFormat = CatalogUtil.isSupportedFormat
local shortText = CatalogUtil.shortText
local joinNames = CatalogUtil.joinNames
local cleanInlineText = CatalogUtil.cleanInlineText
local cleanDescriptionText = CatalogUtil.cleanDescriptionText
local formatSeries = CatalogUtil.formatSeries
local firstAuthor = CatalogUtil.firstAuthor
local coverLabel = CatalogUtil.coverLabel
local buildCoverWidget = CatalogWidgets.buildCoverWidget
local BookOrbitMosaicItem = CatalogWidgets.MosaicItem
local BookOrbitListItem = CatalogWidgets.ListItem

-- Max genres/tags shown inline on the detail page before a "+N more" expander.
local DETAIL_TAGS_INLINE = 6
-- Soft cap on the catalog thumbnail cache (cache/bookorbit). Oldest covers are
-- evicted past this many files so the cache cannot grow without bound.
local THUMBNAIL_CACHE_MAX_FILES = 600

local function showError(err)
    local text
    if isAuthError(err) then
        text = _("BookOrbit login failed. Check your KOReader credentials.")
    elseif err then
        text = T(_("Could not reach the BookOrbit server: %1"), tostring(err))
    else
        text = _("Could not reach the BookOrbit server.")
    end
    UIManager:show(InfoMessage:new{ text = text, timeout = 4 })
end

local BookOrbitCatalog = Menu:extend{
    title = _("BookOrbit"),
    title_shrink_font_to_fit = true,
    title_bar_left_icon = "appbar.menu",
}

CatalogDownload.install(BookOrbitCatalog)

local Menu_recalculateDimen = Menu._recalculateDimen
local Menu_updateItems = Menu.updateItems
local Menu_onGotoPage = Menu.onGotoPage
local Menu_onNextPage = Menu.onNextPage
local Menu_onPrevPage = Menu.onPrevPage
local Menu_onFirstPage = Menu.onFirstPage
local Menu_onLastPage = Menu.onLastPage

function BookOrbitCatalog:init()
    self.client = BookOrbitApi.new(self.api)
    self.stack = {}
    self.thumbnail_cache_dir = DataStorage:getDataDir() .. "/cache/bookorbit"
    self.thumbnail_generation = 0
    self.thumbnail_failures = {}
    self.settings = self.settings or {}
    self.view_mode = self.settings.catalog_view_mode == "list" and "list" or "mosaic"
    self.grid_cols = self:sanitizeGridValue(self.settings.catalog_grid_cols, DEFAULT_GRID_COLUMNS)
    self.grid_rows = self:sanitizeGridValue(self.settings.catalog_grid_rows, DEFAULT_GRID_ROWS)
    self.default_sort = self.settings.catalog_sort or "recently_added"
    self.list_rows = self:computeListRows()
    self.on_device = {}
    self.on_device_files = {}
    self:refreshOnDevice()
    self.current_context = { kind = "root", title = self.title }
    self.item_table = self:rootItems()
    self.is_borderless = true
    self.title_bar_fm_style = true
    Menu.init(self)
    self:updateLeftIcon()
    self.paths = self.stack
    UIManager:nextTick(function()
        self:cleanLegacyThumbnails()
        self:pruneThumbnailCache()
    end)
end

-- Removes pre-versioning cache files ("<id>.jpg"). They were keyed by book id
-- only, so after a library rescan reassigned ids they showed the wrong cover.
function BookOrbitCatalog:cleanLegacyThumbnails()
    local dir = self.thumbnail_cache_dir
    if not dir or lfs.attributes(dir, "mode") ~= "directory" then return end
    for name in lfs.dir(dir) do
        if name:match("^%d+%.jpg$") then
            os.remove(dir .. "/" .. name)
        end
    end
end

function BookOrbitCatalog:refreshCurrent()
    self.thumbnail_failures = {}
    local context = self.current_context or {}
    if context.kind == "books" then
        self:evictCachedCovers(context.books)
        local params = cloneParams(context.params or {})
        params.page = context.page or 1
        self:loadBooks(params, context.title or _("Books"), false)
    elseif context.kind == "section" then
        self:loadSection(context.section, { page = context.page, q = context.q, replace = true })
    elseif context.kind == "detail" and context.detail then
        self:evictCachedCovers({ context.detail })
        self:runConnected(function()
            local detail, err = self:fetch(_("Refreshing..."), function()
                return self.client:catalogBook(context.detail.id)
            end)
            if not detail then
                if err ~= "cancelled" then self:showWriteError(err) end
                return
            end
            self:cancelThumbnailJobs()
            context.detail = detail
            context.supported_files = self:supportedFiles(detail)
            self:refreshOnDevice()
            self:updateItems()
            self:scheduleThumbnailDownloads({ detail })
        end)
    end
end

-- Deletes cached covers for the given books so a refresh re-downloads them,
-- guaranteeing fresh covers even if the cover changed without a new version.
function BookOrbitCatalog:evictCachedCovers(books)
    for _, book in ipairs(books or {}) do
        local path = self:thumbnailPath(book)
        if path then os.remove(path) end
    end
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
    local row_h = Screen:scaleBySize(64)
    local usable = Screen:getHeight() * 0.82
    return math.max(5, math.floor(usable / row_h))
end

function BookOrbitCatalog:itemsPerPage()
    if self.view_mode == "list" then
        return self.list_rows or 8
    end
    return self.grid_cols * self.grid_rows
end

function BookOrbitCatalog:persistSetting(key, value)
    self.settings[key] = value
    if self.save_settings then
        self.save_settings()
    end
end

function BookOrbitCatalog:refreshOnDevice()
    local ok, state = pcall(function()
        return BookOrbitState.open()
    end)
    if ok and state then
        self.on_device = state:matchedByBookId()
        self.on_device_files = state:matchedByBookFileId()
    else
        self.on_device = {}
        self.on_device_files = {}
    end
end

function BookOrbitCatalog:isOnDevice(book)
    return book ~= nil and book.id ~= nil and self.on_device[book.id] ~= nil
end

function BookOrbitCatalog:onDeviceFilePath(file)
    return file ~= nil and file.id ~= nil and self.on_device_files and self.on_device_files[file.id] or nil
end

function BookOrbitCatalog:detailReadPath(detail)
    local fallback
    for _, file in ipairs(self:supportedFiles(detail)) do
        local path = self:onDeviceFilePath(file)
        if path then
            if string.lower(file.format or "") == "epub" then
                return path
            end
            fallback = fallback or path
        end
    end
    if fallback then return fallback end
    return detail ~= nil and detail.id ~= nil and self.on_device[detail.id] or nil
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
            -- Search is exposed through the title-bar magnifier on the root, not a list row.
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
        mandatory = on_device_count > 0 and tostring(on_device_count) or nil,
        kind = "on-device",
    })

    return items
end

function BookOrbitCatalog:updateReturnPath()
    self.paths = self.stack
end

function BookOrbitCatalog:cancelThumbnailJobs()
    self.thumbnail_generation = self.thumbnail_generation + 1
end

function BookOrbitCatalog:switchTo(title, item_table, context, push)
    self:cancelThumbnailJobs()
    if push and self.current_context then
        table.insert(self.stack, {
            title = self.current_context.title,
            subtitle = self.current_context.subtitle,
            item_table = self.item_table,
            context = self.current_context,
        })
    end
    self:updateReturnPath()
    self.current_context = context
    self:switchItemTable(title, item_table, nil, nil, context.subtitle or "")
    self:updateLeftIcon()
    if context.kind == "books" then
        self:scheduleThumbnailDownloads(context.books or {})
    elseif context.kind == "detail" then
        self:scheduleThumbnailDownloads({ context.detail })
    end
end

-- Runs the blocking request fn() off the UI thread when possible, so the
-- reader stays responsive and the loading message can be tapped to cancel.
-- fn must return (body, err, errbody); they are marshalled back through the
-- subprocess. Returns nil, "cancelled" when the user dismisses the request.
function BookOrbitCatalog:fetch(text, fn)
    if not Trapper:isWrapped() then
        local info = InfoMessage:new{ text = text or _("Loading...") }
        UIManager:show(info)
        UIManager:forceRePaint()
        local body, err, errbody = fn()
        UIManager:close(info)
        return body, err, errbody
    end
    local completed, result = Trapper:dismissableRunInSubprocess(function()
        local ok, body, err, errbody = pcall(fn)
        if not ok then
            return { err = tostring(body) }
        end
        return { body = body, err = err, errbody = errbody }
    end, text or _("Loading..."))
    if not completed then
        return nil, "cancelled"
    end
    result = result or {}
    return result.body, result.err, result.errbody
end

-- Wraps a connected job in a Trapper coroutine so self:fetch can run network
-- calls in a dismissable subprocess.
function BookOrbitCatalog:runConnected(fn)
    NetworkMgr:runWhenConnected(function()
        Trapper:wrap(fn)
    end)
end

function BookOrbitCatalog:errorText(err)
    if isAuthError(err) then
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
    local dialog
    dialog = ButtonDialog:new{
        title = self:errorText(err),
        buttons = {
            {
                {
                    text = _("Retry"),
                    callback = function()
                        UIManager:close(dialog)
                        retry_fn()
                    end,
                },
            },
            {
                {
                    text = _("Cancel"),
                    callback = function()
                        UIManager:close(dialog)
                    end,
                },
            },
        },
    }
    UIManager:show(dialog)
end

function BookOrbitCatalog:loadSection(section, opts)
    opts = opts or {}
    local paged = (section == "authors" or section == "series")
    self:runConnected(function()
        local params
        if paged then
            params = {}
            if opts.page and opts.page > 1 then params.page = opts.page end
            if opts.q and opts.q ~= "" then params.q = opts.q end
        end
        local body, err = self:fetch(_("Loading..."), function()
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

        if paged then
            table.insert(item_table, {
                text = q and T(_("Filter: %1"), q) or _("Filter..."),
                kind = "section-filter",
                section = section,
                q = q,
            })
            if page > 1 then
                table.insert(item_table, {
                    text = T(_("< Previous page (%1)"), page - 1),
                    kind = "section-page",
                    section = section,
                    section_page = page - 1,
                    q = q,
                })
            end
            if body.hasNext then
                table.insert(item_table, {
                    text = T(_("Next page (%1) >"), page + 1),
                    kind = "section-page",
                    section = section,
                    section_page = page + 1,
                    q = q,
                })
            end
        end

        for _, entry in ipairs(body.items or {}) do
            local entry_params = self:paramsForEntry(section, entry)
            table.insert(item_table, {
                text = entry.title,
                mandatory = entry.count and tostring(entry.count) or nil,
                kind = "books",
                params = entry_params,
            })
        end

        if #item_table == 0 then
            table.insert(item_table, { text = self:emptyEntriesText(section), enabled = false })
        end
        local title = self:titleForSection(section)
        local push = not opts.replace
        self:switchTo(title, item_table, { kind = "section", title = title, section = section, page = page, q = q }, push)
    end)
end

function BookOrbitCatalog:promptSectionFilter(section, current_q)
    local dialog
    dialog = InputDialog:new{
        title = _("Filter"),
        input = current_q or "",
        input_hint = _("Type to filter"),
        buttons = {
            {
                {
                    text = _("Cancel"),
                    id = "close",
                    callback = function()
                        UIManager:close(dialog)
                    end,
                },
                {
                    text = _("Clear"),
                    callback = function()
                        UIManager:close(dialog)
                        self:loadSection(section, { page = 1, q = nil, replace = true })
                    end,
                },
                {
                    text = _("Filter"),
                    is_enter_default = true,
                    callback = function()
                        local value = util.trim(dialog:getInputText() or "")
                        UIManager:close(dialog)
                        self:loadSection(section, { page = 1, q = value ~= "" and value or nil, replace = true })
                    end,
                },
            },
        },
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
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
    local params = { sort = "title" }
    if section == "libraries" then
        params.libraryId = tonumber(entry.id)
    elseif section == "collections" then
        params.collectionId = tonumber(entry.id)
    elseif section == "smart-scopes" then
        params.smartScopeId = tonumber(entry.id)
    elseif section == "authors" then
        params.author = entry.id
    elseif section == "series" then
        params.series = entry.id
        params.sort = "series"
    end
    return params
end

function BookOrbitCatalog:loadBooks(params, title, push)
    self:runConnected(function()
        local query = cloneParams(params)
        query.page = query.page or 1
        query.size = self:itemsPerPage()
        query.sort = query.sort or self.default_sort or "recently_added"
        query.order = self:effectiveOrder(query)

        local body, err = self:fetch(_("Loading books..."), function()
            return self.client:catalogBooks(query)
        end)
        if not body then
            if err ~= "cancelled" then
                self:showRetry(err, function()
                    self:loadBooks(params, title, push)
                end)
            end
            return
        end

        self:showBookPage(body, query, title or _("Books"), push ~= false)
    end)
end

function BookOrbitCatalog:loadOnDevice()
    self:refreshOnDevice()
    local ids = {}
    for book_id in pairs(self.on_device) do
        table.insert(ids, book_id)
    end
    if #ids == 0 then
        UIManager:show(InfoMessage:new{ text = _("No downloaded books are linked on this device yet."), timeout = 3 })
        return
    end
    table.sort(ids)
    local capped = {}
    for i = 1, math.min(#ids, ON_DEVICE_MAX_IDS) do
        capped[i] = ids[i]
    end
    self:loadBooks({ ids = table.concat(capped, ","), sort = "title" }, _("On device"), true)
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

function BookOrbitCatalog:runSearch(params, q)
    q = util.trim(q or "")
    if q == "" then return end
    self:recordRecentSearch(q)
    local query = cloneParams(params)
    query.q = q
    query.page = 1
    query.sort = query.sort or "title"
    self:loadBooks(query, T(_("Search: %1"), q), true)
end

function BookOrbitCatalog:showRecentSearches(params)
    local recents = self.settings.catalog_recent_searches or {}
    if #recents == 0 then
        UIManager:show(InfoMessage:new{ text = _("No recent searches yet."), timeout = 2 })
        return
    end
    local dialog
    local buttons = {}
    for _, q in ipairs(recents) do
        table.insert(buttons, {
            {
                text = q,
                callback = function()
                    UIManager:close(dialog)
                    self:runSearch(params, q)
                end,
            },
        })
    end
    dialog = ButtonDialog:new{
        title = _("Recent searches"),
        buttons = buttons,
    }
    UIManager:show(dialog)
end

function BookOrbitCatalog:promptSearch(params)
    local has_recents = #(self.settings.catalog_recent_searches or {}) > 0
    local dialog
    dialog = InputDialog:new{
        title = _("Search BookOrbit"),
        input_hint = _("Title, author, series, ISBN"),
        buttons = {
            {
                {
                    text = _("Cancel"),
                    id = "close",
                    callback = function()
                        UIManager:close(dialog)
                    end,
                },
                {
                    text = _("Recent"),
                    enabled = has_recents,
                    callback = function()
                        UIManager:close(dialog)
                        self:showRecentSearches(params)
                    end,
                },
                {
                    text = _("Search"),
                    is_enter_default = true,
                    callback = function()
                        local q = util.trim(dialog:getInputText() or "")
                        if q == "" then return end
                        UIManager:close(dialog)
                        self:runSearch(params, q)
                    end,
                },
            },
        },
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

function BookOrbitCatalog:filterSummary(query)
    local parts = {}
    if query.readStatus then
        for _, f in ipairs(READ_STATUS_FILTERS) do
            if f.id == query.readStatus then
                table.insert(parts, f.text)
                break
            end
        end
    end
    if query.format then
        table.insert(parts, string.upper(query.format))
    end
    return #parts > 0 and table.concat(parts, ", ") or nil
end

function BookOrbitCatalog:showBookPage(body, query, title, push)
    local items = body.items or {}
    local page = body.page or query.page or 1
    local size = body.size or query.size or self:itemsPerPage()
    local total = body.total or 0
    local page_count = math.max(1, math.ceil(total / size))
    local filters = self:filterSummary(query)
    local sort_label = T(_("%1 (%2)"), self:sortLabel(query.sort), self:directionLabel(query))
    local subtitle
    if total > 0 then
        subtitle = T(_("%1 books - Sort: %2"), total, sort_label)
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

    self:switchTo(title, item_table, {
        kind = "books",
        title = title,
        subtitle = subtitle,
        params = query,
        books = items,
        page = page,
        page_count = page_count,
        total = total,
    }, push)

    if page < page_count then
        self:prefetchNextPage(query, page + 1)
    end
end

-- Cover cache files are versioned by the book's updatedAt so a server-side
-- cover change or a library rescan (which reassigns book ids) invalidates the
-- cached image instead of showing the previous book's cover.
local function coverToken(book)
    local value = book and book.updatedAt
    if not value then return "0" end
    local token = tostring(value):gsub("%D", "")
    return token ~= "" and token or "0"
end

function BookOrbitCatalog:thumbnailPath(book)
    if not book or not book.hasCover then return nil end
    if not util.makePath(self.thumbnail_cache_dir) then return nil end
    return self.thumbnail_cache_dir .. "/" .. tostring(book.id) .. "_" .. coverToken(book) .. ".jpg"
end

function BookOrbitCatalog:cachedThumbnailPath(book)
    local path = self:thumbnailPath(book)
    if path and lfs.attributes(path, "mode") == "file" then
        return path
    end
    return nil
end

function BookOrbitCatalog:thumbnailState(book)
    if not book or not book.hasCover then return "missing" end
    if self:cachedThumbnailPath(book) then return "ready" end
    if self.thumbnail_failures[tostring(book.id)] then return "failed" end
    return "loading"
end

function BookOrbitCatalog:scheduleThumbnailDownloads(items)
    local queue = {}
    for _, book in ipairs(items or {}) do
        if book.hasCover and not self:cachedThumbnailPath(book) and not self.thumbnail_failures[tostring(book.id)] then
            table.insert(queue, book)
        end
    end
    if #queue == 0 then return end

    local generation = self.thumbnail_generation
    local function step()
        if generation ~= self.thumbnail_generation then return end

        for _ = 1, THUMBNAIL_BATCH_SIZE do
            local book = table.remove(queue, 1)
            if not book then break end

            local path = self:thumbnailPath(book)
            if path then
                local ok, err = self.client:downloadCatalogThumbnail(book.id, path)
                if ok then
                    self.thumbnail_failures[tostring(book.id)] = nil
                else
                    self.thumbnail_failures[tostring(book.id)] = true
                    logger.dbg("BookOrbit: thumbnail download failed", book.id, err)
                end
            end
        end

        if generation == self.thumbnail_generation then
            self:updateItems(nil, true)
            if #queue > 0 then
                UIManager:scheduleIn(0.05, step)
            else
                self:pruneThumbnailCache()
            end
        end
    end

    UIManager:scheduleIn(0.15, step)
end

-- Downloads covers for a future page into the disk cache without repainting the
-- current view, so paging forward shows covers immediately.
function BookOrbitCatalog:prefetchThumbnails(items, generation)
    local queue = {}
    for _, book in ipairs(items or {}) do
        if book.hasCover and not self:cachedThumbnailPath(book) and not self.thumbnail_failures[tostring(book.id)] then
            table.insert(queue, book)
        end
    end
    if #queue == 0 then return end

    local function step()
        if generation ~= self.thumbnail_generation then return end
        local book = table.remove(queue, 1)
        if not book then
            self:pruneThumbnailCache()
            return
        end
        local path = self:thumbnailPath(book)
        if path then
            local ok = self.client:downloadCatalogThumbnail(book.id, path)
            if not ok then
                self.thumbnail_failures[tostring(book.id)] = true
            end
        end
        UIManager:scheduleIn(0.08, step)
    end
    UIManager:scheduleIn(0.08, step)
end

-- Fetches the next page's book list off the UI thread and warms its covers.
function BookOrbitCatalog:prefetchNextPage(query, next_page)
    if not next_page then return end
    local generation = self.thumbnail_generation
    UIManager:scheduleIn(1.0, function()
        if generation ~= self.thumbnail_generation then return end
        NetworkMgr:runWhenConnected(function()
            if generation ~= self.thumbnail_generation then return end
            Trapper:wrap(function()
                local q = cloneParams(query)
                q.page = next_page
                local completed, result = Trapper:dismissableRunInSubprocess(function()
                    local ok, body = pcall(function()
                        return self.client:catalogBooks(q)
                    end)
                    return { body = ok and body or nil }
                end, true)
                if not completed or generation ~= self.thumbnail_generation then return end
                local body = result and result.body
                if body and body.items then
                    self:prefetchThumbnails(body.items, generation)
                end
            end)
        end)
    end)
end

-- Evicts the oldest cached covers once the cache exceeds its soft file cap.
function BookOrbitCatalog:pruneThumbnailCache()
    local dir = self.thumbnail_cache_dir
    if not dir or lfs.attributes(dir, "mode") ~= "directory" then return end
    local files = {}
    for name in lfs.dir(dir) do
        if name:match("%.jpg$") then
            local path = dir .. "/" .. name
            local mtime = lfs.attributes(path, "modification")
            if mtime then
                table.insert(files, { path = path, mtime = mtime })
            end
        end
    end
    if #files <= THUMBNAIL_CACHE_MAX_FILES then return end
    table.sort(files, function(a, b) return a.mtime < b.mtime end)
    for i = 1, #files - THUMBNAIL_CACHE_MAX_FILES do
        os.remove(files[i].path)
    end
end

function BookOrbitCatalog:showSortDialog(item)
    local dialog
    local buttons = {}
    for _, sort in ipairs(SORTS) do
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

function BookOrbitCatalog:showBookActions()
    local context = self.current_context or {}
    local in_books = context.kind == "books"
    local params = in_books and self:scopeParams(context.params or {}) or {}
    local view_label = self.view_mode == "list" and _("View: List") or _("View: Mosaic")
    local dialog
    dialog = ButtonDialog:new{
        title = _("BookOrbit"),
        buttons = {
            {
                {
                    text = _("Search in this scope"),
                    callback = function()
                        UIManager:close(dialog)
                        self:promptSearch(params)
                    end,
                },
                {
                    text = _("Refresh"),
                    callback = function()
                        UIManager:close(dialog)
                        self:refreshCurrent()
                    end,
                },
            },
            {
                {
                    text = in_books
                        and T(_("Sort: %1 (%2)"), self:sortLabel((context.params or {}).sort), self:directionLabel(context.params or {}))
                        or _("Sort books"),
                    enabled = in_books,
                    callback = function()
                        UIManager:close(dialog)
                        self:showSortDialog({
                            params = params,
                            current_sort = (context.params or {}).sort,
                            title = context.title,
                        })
                    end,
                },
                {
                    text = _("Reverse"),
                    enabled = in_books,
                    callback = function()
                        UIManager:close(dialog)
                        self:reverseOrder()
                    end,
                },
            },
            {
                {
                    text = _("Read status"),
                    enabled = in_books,
                    callback = function()
                        UIManager:close(dialog)
                        self:showReadStatusDialog()
                    end,
                },
                {
                    text = _("Format"),
                    enabled = in_books,
                    callback = function()
                        UIManager:close(dialog)
                        self:showFormatDialog()
                    end,
                },
            },
            {
                {
                    text = view_label,
                    callback = function()
                        UIManager:close(dialog)
                        self:setViewMode(self.view_mode == "list" and "mosaic" or "list")
                    end,
                },
                {
                    text = _("Grid size"),
                    enabled = self.view_mode == "mosaic",
                    callback = function()
                        UIManager:close(dialog)
                        self:showGridDialog()
                    end,
                },
            },
        },
    }
    UIManager:show(dialog)
end

function BookOrbitCatalog:showDetailActions()
    local detail = (self.current_context or {}).detail
    if not detail then return end
    local has_genres = detail.genres and #detail.genres > 0
    local has_tags = detail.tags and #detail.tags > 0
    local dialog
    dialog = ButtonDialog:new{
        title = detail.title or _("Book"),
        buttons = {
            {
                {
                    text = _("Set read status"),
                    callback = function()
                        UIManager:close(dialog)
                        self:showSetStatusDialog(detail)
                    end,
                },
                {
                    text = _("Set rating"),
                    callback = function()
                        UIManager:close(dialog)
                        self:showSetRatingDialog(detail)
                    end,
                },
            },
            {
                {
                    text = _("Full description"),
                    enabled = cleanDescriptionText(detail.description) ~= nil,
                    callback = function()
                        UIManager:close(dialog)
                        self:showFullText(_("Description"), detail.description)
                    end,
                },
            },
            {
                {
                    text = _("All genres"),
                    enabled = has_genres,
                    callback = function()
                        UIManager:close(dialog)
                        self:showFullList(_("Genres"), detail.genres)
                    end,
                },
                {
                    text = _("All tags"),
                    enabled = has_tags,
                    callback = function()
                        UIManager:close(dialog)
                        self:showFullList(_("Tags"), detail.tags)
                    end,
                },
            },
            {
                {
                    text = _("Refresh"),
                    callback = function()
                        UIManager:close(dialog)
                        self:refreshCurrent()
                    end,
                },
            },
        },
    }
    UIManager:show(dialog)
end

function BookOrbitCatalog:showSetStatusDialog(detail)
    local dialog
    local buttons = {}
    for _, status in ipairs(SETTABLE_READ_STATUSES) do
        table.insert(buttons, {
            {
                text = status.text .. (detail.readStatus == status.id and " *" or ""),
                callback = function()
                    UIManager:close(dialog)
                    self:applyReadStatus(detail, status.id)
                end,
            },
        })
    end
    dialog = ButtonDialog:new{ title = _("Set read status"), buttons = buttons }
    UIManager:show(dialog)
end

function BookOrbitCatalog:showSetRatingDialog(detail)
    local dialog
    local buttons = {
        {
            {
                text = _("Clear rating") .. (detail.rating == nil and " *" or ""),
                callback = function()
                    UIManager:close(dialog)
                    self:applyRating(detail, nil)
                end,
            },
        },
    }
    for star = 1, 5 do
        table.insert(buttons, {
            {
                text = formatRating(star) .. (detail.rating == star and " *" or ""),
                callback = function()
                    UIManager:close(dialog)
                    self:applyRating(detail, star)
                end,
            },
        })
    end
    dialog = ButtonDialog:new{ title = _("Set rating"), buttons = buttons }
    UIManager:show(dialog)
end

function BookOrbitCatalog:refreshDetailView()
    if self:detailMode() then
        self:updateItems()
    end
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
    UIManager:show(InfoMessage:new{ text = text, timeout = 3 })
end

function BookOrbitCatalog:applyReadStatus(detail, status)
    self:runConnected(function()
        local body, err = self:fetch(_("Saving..."), function()
            return self.client:catalogSetReadStatus(detail.id, status)
        end)
        if not body then
            if err ~= "cancelled" then self:showWriteError(err) end
            return
        end
        detail.readStatus = body.readStatus or status
        self:refreshDetailView()
        UIManager:show(InfoMessage:new{ text = _("Read status updated"), timeout = 1 })
    end)
end

function BookOrbitCatalog:applyRating(detail, rating)
    self:runConnected(function()
        local body, err = self:fetch(_("Saving..."), function()
            return self.client:catalogSetRating(detail.id, rating)
        end)
        if not body then
            if err ~= "cancelled" then self:showWriteError(err) end
            return
        end
        detail.rating = body.rating
        self:refreshDetailView()
        UIManager:show(InfoMessage:new{ text = _("Rating updated"), timeout = 1 })
    end)
end

function BookOrbitCatalog:contextUsesActions()
    local kind = self.current_context and self.current_context.kind
    return kind == "books" or kind == "detail"
end

function BookOrbitCatalog:updateLeftIcon()
    if not self.title_bar then return end
    self.title_bar:setLeftIcon(self:contextUsesActions() and "appbar.menu" or "appbar.search")
end

function BookOrbitCatalog:onLeftButtonTap()
    if self:detailMode() then
        self:showDetailActions()
    elseif self:contextUsesActions() then
        self:showBookActions()
    else
        self:promptSearch({})
    end
    return true
end

function BookOrbitCatalog:loadBookDetail(book_id)
    self:runConnected(function()
        local detail, err = self:fetch(_("Loading book..."), function()
            return self.client:catalogBook(book_id)
        end)
        if not detail then
            if err ~= "cancelled" then
                self:showRetry(err, function()
                    self:loadBookDetail(book_id)
                end)
            end
            return
        end
        self:showBookDetail(detail)
    end)
end

function BookOrbitCatalog:supportedFiles(detail)
    local files = {}
    for _, file in ipairs(detail.files or {}) do
        if isSupportedFormat(file.format) then
            table.insert(files, file)
        end
    end
    return files
end

function BookOrbitCatalog:fileLabel(file, show_support)
    local label = string.upper(file.format or "file")
    local extras = {}
    local size = formatBytes(file.sizeBytes)
    if size ~= "" then table.insert(extras, size) end
    local duration = formatDuration(file.durationSeconds)
    if duration then table.insert(extras, duration) end
    if show_support and not isSupportedFormat(file.format) then
        table.insert(extras, _("unsupported"))
    end
    if #extras > 0 then
        label = label .. " - " .. table.concat(extras, ", ")
    end
    return label
end

function BookOrbitCatalog:fileMetadataValue(detail)
    local files = detail.files or {}
    if #files == 0 then return nil end

    local labels = {}
    for index, file in ipairs(files) do
        if index > 3 then break end
        table.insert(labels, self:fileLabel(file, true))
    end
    if #files > 3 then
        table.insert(labels, "...")
    end
    return table.concat(labels, "; ")
end

function BookOrbitCatalog:cappedListText(items)
    if not items or #items == 0 then return nil end
    local shown = {}
    for i = 1, math.min(#items, DETAIL_TAGS_INLINE) do
        table.insert(shown, items[i])
    end
    local text = table.concat(shown, ", ")
    if #items > DETAIL_TAGS_INLINE then
        text = text .. T(_(" +%1 more"), #items - DETAIL_TAGS_INLINE)
    end
    return text
end

function BookOrbitCatalog:detailFactLines(detail)
    local lines = {}
    local function add(label, value)
        value = cleanInlineText(value)
        if value then
            table.insert(lines, T(_("%1: %2"), label, value))
        end
    end

    add(_("Series"), formatSeries(detail))
    add(_("Year"), detail.publishedYear and tostring(detail.publishedYear) or nil)
    add(_("Publisher"), detail.publisher)
    add(_("Pages"), detail.pageCount and tostring(detail.pageCount) or nil)
    add(_("Rating"), formatRating(detail.rating))
    add(_("ISBN"), detail.isbn13 or detail.isbn10)
    add(_("Progress"), formatProgress(detail.progressPercentage))
    add(_("Status"), self:readStatusLabel(detail) or detail.readStatus)
    add(_("Library"), detail.libraryName)
    add(_("Genres"), self:cappedListText(detail.genres))
    add(_("Tags"), self:cappedListText(detail.tags))
    add(#(detail.files or {}) == 1 and _("File") or _("Files"), self:fileMetadataValue(detail))
    return lines
end

function BookOrbitCatalog:detailOverviewLines(detail)
    local lines = {}
    local description = cleanDescriptionText(detail.description)
    if description then
        table.insert(lines, _("Description"))
        table.insert(lines, shortText(description, 360))
        if #description > 360 then
            table.insert(lines, _("(tap the menu for the full description)"))
        end
    end

    if #lines == 0 then
        table.insert(lines, _("No description available."))
    end
    return lines
end

function BookOrbitCatalog:showFullText(title, text)
    text = cleanDescriptionText(text) or _("Nothing to show.")
    UIManager:show(TextViewer:new{
        title = title,
        text = text,
    })
end

function BookOrbitCatalog:showFullList(title, items)
    if not items or #items == 0 then
        UIManager:show(InfoMessage:new{ text = _("None."), timeout = 2 })
        return
    end
    UIManager:show(TextViewer:new{
        title = title,
        text = table.concat(items, "\n"),
    })
end

function BookOrbitCatalog:showBookDetail(detail)
    self:refreshOnDevice()
    local supported_files = self:supportedFiles(detail)
    self:switchTo(detail.title or _("Book details"), {
        {
            text = detail.title or _("Book details"),
            kind = "detail",
            detail = detail,
        },
    }, {
        kind = "detail",
        title = detail.title or _("Book details"),
        subtitle = "",
        detail = detail,
        supported_files = supported_files,
    }, true)
end

function BookOrbitCatalog:bookMode()
    return self.current_context and self.current_context.kind == "books"
end

function BookOrbitCatalog:detailMode()
    return self.current_context and self.current_context.kind == "detail"
end

function BookOrbitCatalog:_recalculateDimen(no_recalculate_dimen)
    if self:bookMode() then
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
    if self.page_return_arrow and self.page_info_text then
        bottom_height = math.max(self.page_return_arrow:getSize().h, self.page_info_text:getSize().h)
            + Size.padding.button
    end
    return top_height, bottom_height
end

function BookOrbitCatalog:recalculateMosaicDimen()
    self.perpage = self.grid_cols * self.grid_rows
    self.page = self.current_context.page or 1
    self.page_num = self.current_context.page_count or 1
    local top_height, bottom_height = self:menuChromeHeight()
    self.available_height = self.inner_dimen.h - top_height - bottom_height
    self.item_margin = Screen:scaleBySize(10)
    self.item_height = math.floor((self.available_height - (self.grid_rows + 1) * self.item_margin) / self.grid_rows)
    self.item_width = math.floor((self.inner_dimen.w - (self.grid_cols + 1) * self.item_margin) / self.grid_cols)
    self.item_dimen = Geom:new{
        x = 0,
        y = 0,
        w = self.item_width,
        h = self.item_height,
    }
end

function BookOrbitCatalog:recalculateDetailDimen()
    self.perpage = 1
    self.page = 1
    self.page_num = 1
    local top_height, bottom_height = self:menuChromeHeight()
    self.available_height = self.inner_dimen.h - top_height - bottom_height
    self.item_dimen = Geom:new{
        x = 0,
        y = 0,
        w = self.inner_dimen.w,
        h = self.available_height,
    }
end

function BookOrbitCatalog:updateItems(select_number, no_recalculate_dimen)
    if self:bookMode() then
        if self.view_mode == "list" then
            return self:updateListItems(select_number, no_recalculate_dimen)
        end
        return self:updateMosaicItems(select_number, no_recalculate_dimen)
    elseif self:detailMode() then
        return self:updateDetailItems(select_number, no_recalculate_dimen)
    end
    return Menu_updateItems(self, select_number, no_recalculate_dimen)
end

function BookOrbitCatalog:prepareCustomUpdate(no_recalculate_dimen)
    local old_dimen = self.dimen and self.dimen:copy()
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
    Menu.mergeTitleBarIntoLayout(self)
    UIManager:setDirty(self.show_parent, function()
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
            dimen = Geom:new{ w = self.inner_dimen.w, h = Screen:scaleBySize(80) },
            TextBoxWidget:new{
                text = self:emptyBooksText(),
                width = self.inner_dimen.w - 2 * Size.padding.large,
                alignment = "center",
                face = Font:getFace("infofont"),
            },
        })
        self:finishCustomUpdate(old_dimen, selected_number)
        return
    end

    for row = 1, self.grid_rows do
        local line_layout = {}
        table.insert(self.item_group, VerticalSpan:new{ width = self.item_margin })
        local row_group = HorizontalGroup:new{}
        table.insert(row_group, HorizontalSpan:new{ width = self.item_margin })
        for col = 1, self.grid_cols do
            local slot = (row - 1) * self.grid_cols + col
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
    self.item_margin = Screen:scaleBySize(4)
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
            dimen = Geom:new{ w = self.inner_dimen.w, h = Screen:scaleBySize(80) },
            TextBoxWidget:new{
                text = self:emptyBooksText(),
                width = self.inner_dimen.w - 2 * Size.padding.large,
                alignment = "center",
                face = Font:getFace("infofont"),
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

function BookOrbitCatalog:detailCoverDimensions(header_h)
    local max_cover_h = math.max(1, header_h - 2 * Size.padding.tiny)
    local min_cover_h = math.min(Screen:scaleBySize(120), max_cover_h)
    local cover_h = math.max(min_cover_h, math.min(max_cover_h, Screen:scaleBySize(340)))
    local cover_w = math.floor(cover_h * 0.68)
    local max_cover_w = math.floor(self.inner_dimen.w * 0.42)
    if cover_w > max_cover_w then
        cover_w = max_cover_w
        cover_h = math.floor(cover_w / 0.68)
    end
    return cover_w, cover_h
end

function BookOrbitCatalog:buildDetailHeader(detail, width, height)
    local supported_files = self.current_context.supported_files or {}
    local cover_w, cover_h = self:detailCoverDimensions(height)
    local frame_padding = Size.padding.default
    local gap = Size.span.horizontal_default
    local text_w = math.max(1, width - 2 * frame_padding - cover_w - gap)
    local inner_h = math.max(1, height - 2 * frame_padding)
    local row_gap = Size.span.vertical_large
    local button_h = math.min(Screen:scaleBySize(44), math.max(Screen:scaleBySize(34), math.floor(inner_h * 0.16)))
    local author_h = math.min(Screen:scaleBySize(56), math.max(Screen:scaleBySize(34), math.floor(inner_h * 0.20)))
    local facts_h = math.min(Screen:scaleBySize(170),
        math.max(Screen:scaleBySize(68), inner_h - author_h - button_h - 2 * row_gap))
    local button_w = text_w
    local path = self:cachedThumbnailPath(detail)
    local state = self:thumbnailState(detail)

    local read_path = self:detailReadPath(detail)
    local undownloaded = 0
    for _, file in ipairs(supported_files) do
        if not self:onDeviceFilePath(file) then
            undownloaded = undownloaded + 1
        end
    end
    local show_read = read_path ~= nil
    local show_download = (not show_read) or undownloaded > 0
    local both = show_read and show_download
    local half_w = math.floor((button_w - gap) / 2)

    self.detail_read_button = nil
    self.detail_download_button = nil
    local buttons_row = HorizontalGroup:new{}

    if show_read then
        self.detail_read_button = Button:new{
            text = _("Read"),
            width = both and half_w or button_w,
            height = button_h,
            text_font_size = 16,
            callback = function()
                self:openDownloadedFile(read_path)
            end,
        }
        table.insert(buttons_row, self.detail_read_button)
    end
    if both then
        table.insert(buttons_row, HorizontalSpan:new{ width = gap })
    end
    if show_download then
        self.detail_download_button = Button:new{
            text = _("Download"),
            width = both and (button_w - half_w - gap) or button_w,
            height = button_h,
            enabled = #supported_files > 0,
            text_font_size = 16,
            callback = function()
                self:showFileChoices(detail)
            end,
        }
        table.insert(buttons_row, self.detail_download_button)
    end

    local facts = self:detailFactLines(detail)
    local author = joinNames(detail.authors) or _("Unknown author")

    local right = VerticalGroup:new{ align = "left" }
    table.insert(right, TextBoxWidget:new{
        text = BD.auto(author),
        width = text_w,
        height = author_h,
        face = Font:getFace("smallinfofont"),
        height_overflow_show_ellipsis = true,
    })
    table.insert(right, VerticalSpan:new{ width = row_gap })
    table.insert(right, TextBoxWidget:new{
        text = table.concat(facts, "\n"),
        width = text_w,
        height = facts_h,
        face = Font:getFace("x_smallinfofont"),
        height_overflow_show_ellipsis = true,
    })
    table.insert(right, VerticalSpan:new{ width = row_gap })
    table.insert(right, buttons_row)

    return FrameContainer:new{
        width = width,
        height = height,
        margin = 0,
        padding = frame_padding,
        bordersize = 0,
        HorizontalGroup:new{
            buildCoverWidget(detail, cover_w, cover_h, path, state),
            HorizontalSpan:new{ width = gap },
            right,
        },
    }
end

function BookOrbitCatalog:updateDetailItems(select_number, no_recalculate_dimen)
    local old_dimen = self:prepareCustomUpdate(no_recalculate_dimen)
    local detail = self.current_context.detail
    local header_h = math.min(Screen:scaleBySize(360), math.floor(self.available_height * 0.48))
    local info_h = math.max(Screen:scaleBySize(80), self.available_height - header_h - Size.span.vertical_large)

    table.insert(self.item_group, self:buildDetailHeader(detail, self.inner_dimen.w, header_h))
    table.insert(self.item_group, VerticalSpan:new{ width = Size.span.vertical_large })
    table.insert(self.item_group, FrameContainer:new{
        width = self.inner_dimen.w,
        height = info_h,
        margin = 0,
        padding = Size.padding.large,
        bordersize = 0,
        TextBoxWidget:new{
            text = table.concat(self:detailOverviewLines(detail), "\n"),
            width = self.inner_dimen.w - 2 * Size.padding.large,
            height = math.max(Screen:scaleBySize(40), info_h - 2 * Size.padding.large),
            face = Font:getFace("x_smallinfofont"),
            height_overflow_show_ellipsis = true,
        },
    })
    local focus_row = {}
    if self.detail_read_button then table.insert(focus_row, self.detail_read_button) end
    if self.detail_download_button then table.insert(focus_row, self.detail_download_button) end
    self.layout = { focus_row }
    self:finishCustomUpdate(old_dimen, select_number)
end

function BookOrbitCatalog:onGotoPage(page)
    if self:bookMode() then
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
    if self:bookMode() then
        local context = self.current_context
        if context.page < context.page_count then
            return self:onGotoPage(context.page + 1)
        end
        return true
    elseif self:detailMode() then
        return true
    end
    return Menu_onNextPage(self)
end

function BookOrbitCatalog:onPrevPage()
    if self:bookMode() then
        local context = self.current_context
        if context.page > 1 then
            return self:onGotoPage(context.page - 1)
        end
        return true
    elseif self:detailMode() then
        return true
    end
    return Menu_onPrevPage(self)
end

function BookOrbitCatalog:onFirstPage()
    if self:bookMode() then
        return self:onGotoPage(1)
    elseif self:detailMode() then
        return true
    end
    return Menu_onFirstPage(self)
end

function BookOrbitCatalog:onLastPage()
    if self:bookMode() then
        return self:onGotoPage(self.current_context.page_count or 1)
    elseif self:detailMode() then
        return true
    end
    return Menu_onLastPage(self)
end

function BookOrbitCatalog:onMenuSelect(item)
    if item.kind == "section" then
        self:loadSection(item.section)
    elseif item.kind == "section-filter" then
        self:promptSectionFilter(item.section, item.q)
    elseif item.kind == "section-page" then
        self:loadSection(item.section, { page = item.section_page, q = item.q, replace = true })
    elseif item.kind == "on-device" then
        self:loadOnDevice()
    elseif item.kind == "books" then
        self:loadBooks(item.params or {}, item.list_title or item.text)
    elseif item.kind == "book" then
        self:loadBookDetail(item.book_id)
    elseif item.kind == "sort" then
        self:showSortDialog(item)
    end
    return true
end

function BookOrbitCatalog:onReturn()
    self:cancelThumbnailJobs()
    local previous = table.remove(self.stack)
    if previous then
        self.current_context = previous.context
        self:updateReturnPath()
        self:switchItemTable(previous.title, previous.item_table, nil, nil, previous.subtitle or "")
        if self.current_context.kind == "books" then
            self:scheduleThumbnailDownloads(self.current_context.books or {})
        elseif self.current_context.kind == "detail" then
            self:scheduleThumbnailDownloads({ self.current_context.detail })
        end
    else
        self.item_table = self:rootItems()
        self.current_context = { kind = "root", title = self.title }
        self:updateReturnPath()
        self:switchItemTable(self.title, self.item_table, nil, nil, "")
    end
    self:updateLeftIcon()
    return true
end

function BookOrbitCatalog:onHoldReturn()
    self:cancelThumbnailJobs()
    self.stack = {}
    self:updateReturnPath()
    self.item_table = self:rootItems()
    self.current_context = { kind = "root", title = self.title }
    self:switchItemTable(self.title, self.item_table, nil, nil, "")
    self:updateLeftIcon()
    return true
end

function BookOrbitCatalog:onCloseWidget()
    self:cancelThumbnailJobs()
    return Menu.onCloseWidget(self)
end

return BookOrbitCatalog
