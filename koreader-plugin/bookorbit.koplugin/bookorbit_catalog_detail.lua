--[[--
Book detail mixin for the BookOrbit catalog browser.

Owns the book detail page (drawn by bookorbit_detail_view from the model in
bookorbit_detail_data), the offline detail cache, the book action sheet and
the read status / rating writes. Installed onto the catalog controller as
regular methods.

The page has two levels: the main page and More details. Back on More
details returns to the main page; page-turn keys and the footer pager step to
the neighbouring book of the list the page was opened from.
]]

local NetworkMgr = require("ui/network/manager")
local UIManager = require("ui/uimanager")
local Geom = require("ui/geometry")
local T = require("ffi/util").template
local _ = require("gettext")

local CatalogUtil = require("bookorbit_catalog_util")
local DetailData = require("bookorbit_detail_data")
local DetailView = require("bookorbit_detail_view")
-- Loaded on first use: specs load this module without KOReader's widgets.
local Toast = setmetatable({}, { __index = function(_t, key) return require("bookorbit_toast")[key] end })

local cleanInlineText = CatalogUtil.cleanInlineText
local formatBytes = CatalogUtil.formatBytes
local formatDuration = CatalogUtil.formatDuration
local isSupportedFormat = CatalogUtil.isSupportedFormat

local DETAIL_CACHE_MAX_BOOKS = 80

-- Development only: see CatalogDetail:detailDump.
local DUMP_DIR = os.getenv("BO_DETAIL_DUMP")

local Delivery = require("bookorbit_delivery")

local CatalogDetail = {}

-- A trailing ".0" is noise on a series index: #3, not #3.0.
function CatalogDetail.formatSeriesIndex(index)
    return DetailData.seriesIndexText(index)
end

-- Dates arrive as ISO-like strings but are display-only, so an unexpected
-- format falls back to the raw text instead of disappearing.
local function datePart(value)
    if type(value) ~= "string" then return nil end
    local date = value:match("^(%d%d%d%d%-%d%d%-%d%d)")
    if date then return date end
    return cleanInlineText(value)
end

function CatalogDetail.detailSeriesParams(detail)
    if not detail then return nil end
    if detail.seriesId then
        return { seriesId = tonumber(detail.seriesId), sort = "title" }
    end
    local name = cleanInlineText(detail.seriesName)
    if not name then return nil end
    return { series = name, sort = "title" }
end

function CatalogDetail.detailSeriesText(detail)
    local name = detail and cleanInlineText(detail.seriesName)
    if not name then return nil end
    local index = CatalogDetail.formatSeriesIndex(detail.seriesIndex)
    if not index then return name end
    return T(_("%1 #%2"), name, index)
end

-- A read-along EPUB delivered without its narration is named as such; a
-- plain EPUB is just an EPUB, whatever delivery it was asked for.
local function isTextOnlyReadAlong(file)
    return file.downloadVariant == "audioless_epub" and file.sourceMediaOverlayAvailable == true
end

local function fileFormatLabel(file)
    local label = string.upper(file.format or "file")
    if isTextOnlyReadAlong(file) then
        label = T(_("%1 (text only)"), label)
    end
    return label
end

-- The size to show: what the download will be, or for a plain EPUB built on
-- request, the stored file's size (the same book).
local function displaySize(file)
    if file.sizeBytes then return file.sizeBytes end
    if file.sourceMediaOverlayAvailable ~= true then return file.sourceSizeBytes end
    return nil
end

local function fileInfoLabel(file)
    local label = fileFormatLabel(file)
    local extras = {}
    local size = formatBytes(displaySize(file))
    if size ~= "" then table.insert(extras, size) end
    local duration = formatDuration(file.durationSeconds)
    if duration then table.insert(extras, duration) end
    if #extras == 0 then return label end
    return label .. " - " .. table.concat(extras, ", ")
end

function CatalogDetail:fileFormatLabel(file) return fileFormatLabel(file) end
function CatalogDetail:fileDisplaySize(file) return displaySize(file) end

--[[--
The book's long-tail metadata as key/value rows for the Book info sheet the
list action sheet opens. Pure: it reads the detail table it is given and
never fetches, so the offline cache renders the same rows.
]]
function CatalogDetail.bookInfoRows(detail)
    detail = detail or {}
    local rows = {}
    local function add(key, value, extra)
        value = cleanInlineText(value)
        if not value then return end
        local row = { key = key, value = value }
        for name, item in pairs(extra or {}) do row[name] = item end
        table.insert(rows, row)
    end

    add(_("Series"), CatalogDetail.detailSeriesText(detail), {
        series_params = CatalogDetail.detailSeriesParams(detail),
        series_title = cleanInlineText(detail.seriesName),
    })
    add(_("Publisher"), detail.publisher)
    add(_("Published"), datePart(detail.publishedDate)
        or (detail.publishedYear and tostring(detail.publishedYear) or nil))
    add(_("Language"), detail.language)
    add(_("ISBN-13"), detail.isbn13)
    add(_("ISBN-10"), detail.isbn10)
    add(_("Pages"), detail.pageCount and tostring(detail.pageCount) or nil)
    add(_("Library"), detail.libraryName)

    local collections = {}
    for _, collection in ipairs(detail.collections or {}) do
        local name = cleanInlineText(collection.name)
        if name then table.insert(collections, name) end
    end
    if #collections > 0 then
        add(_("Collections"), table.concat(collections, ", "))
    end

    -- Hoisted: the loop variable would shadow gettext inside the body.
    local file_key = _("File")
    for _, file in ipairs(detail.files or {}) do
        add(file_key, fileInfoLabel(file))
    end
    add(_("Added"), datePart(detail.addedAt))

    return rows
end

function CatalogDetail:openDetailSeries(detail)
    local params = CatalogDetail.detailSeriesParams(detail)
    if not params then return end
    self:loadBooks(params, cleanInlineText(detail.seriesName) or _("Series"), true)
end

function CatalogDetail:detailReadPath(detail)
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
    return self:onDeviceBookPath(detail)
end

function CatalogDetail:detailCache()
    local cache = self.settings.catalog_detail_cache
    if type(cache) ~= "table" then
        cache = {}
        self.settings.catalog_detail_cache = cache
    end
    return cache
end

function CatalogDetail:cachedBookDetail(book_id)
    local entry = self:detailCache()[Delivery.key(self.client) .. "|" .. Delivery.preference(self.settings, self.client) .. "|" .. tostring(book_id)]
    if type(entry) == "table" and type(entry.detail) == "table" then
        return entry.detail
    end
    return nil
end

function CatalogDetail:cacheBookDetail(detail)
    if type(detail) ~= "table" or detail.id == nil then return end
    local cache = self:detailCache()
    cache[Delivery.key(self.client) .. "|" .. Delivery.preference(self.settings, self.client) .. "|" .. tostring(detail.id)] = {
        detail = detail,
        cachedAt = os.time(),
    }
    local entries = {}
    for key, entry in pairs(cache) do
        table.insert(entries, {
            key = key,
            cachedAt = type(entry) == "table" and tonumber(entry.cachedAt) or 0,
        })
    end
    if #entries > DETAIL_CACHE_MAX_BOOKS then
        table.sort(entries, function(a, b) return a.cachedAt < b.cachedAt end)
        for i = 1, #entries - DETAIL_CACHE_MAX_BOOKS do
            cache[entries[i].key] = nil
        end
    end
    self:persistSetting("catalog_detail_cache", cache)
end

function CatalogDetail.detailRelatedSections(_unused, detail)
    return type(detail) == "table" and type(detail.relatedSections) == "table" and detail.relatedSections or {}
end

function CatalogDetail:detailRelatedBooks(detail)
    local books = {}
    for _, section in ipairs(self:detailRelatedSections(detail)) do
        if type(section.books) == "table" then
            for _, book in ipairs(section.books) do
                table.insert(books, book)
            end
        end
    end
    return books
end

function CatalogDetail:detailThumbnailBooks(detail)
    local books = { detail }
    for _, book in ipairs(self:detailRelatedBooks(detail)) do
        table.insert(books, book)
    end
    return books
end

function CatalogDetail:updateVisibleBookSummary(detail)
    if not detail or not detail.id then return end
    local changed = false
    local function update(book)
        if not book or book.id ~= detail.id then return end
        book.readStatus = detail.readStatus
        book.progressPercentage = detail.progressPercentage
        book.formats = detail.formats or book.formats
        changed = true
    end

    for _, entry in ipairs(self.item_table or {}) do
        update(entry.book)
    end
    local context = self.current_context or {}
    for _, book in ipairs(context.books or {}) do
        update(book)
    end
    local dashboard = context.dashboard or {}
    for _, book in ipairs(dashboard.continueReading or {}) do
        update(book)
    end
    for _, book in ipairs(dashboard.discover or {}) do
        update(book)
    end

    if changed and (self:bookMode() or self:dashboardMode()) then
        self:updateItems()
    end
end

-- The long-press sheet: the book, Read or Download, Details, and the rest.
function CatalogDetail:showBookActionSheet(detail, opts)
    if not detail then return end
    opts = opts or {}
    return require("bookorbit_book_peek").open(self, detail, { allow_select = opts.allow_select })
end

function CatalogDetail:showBookActionSheetForEntry(item)
    local book_id = item and (item.book_id or (item.book and item.book.id))
    if not book_id then return end
    local cached = self:cachedBookDetail(book_id)
    if cached and not NetworkMgr:isConnected() then
        self:showBookActionSheet(cached, {
            allow_select = item.kind == "book" and self:bookMode(),
        })
        return
    end
    local title = (item.book and item.book.title) or (cached and cached.title)
    self:runConnected(function()
        local detail, err = self:fetchDeliveryBook(book_id, nil, title and T(_("Opening %1…"), title) or _("Opening the book…"))
        if not detail then
            if cached and err ~= "cancelled" then
                self:showBookActionSheet(cached, {
                    allow_select = item.kind == "book" and self:bookMode(),
                })
                return
            end
            if err ~= "cancelled" then
                self:showRetry(err, function()
                    self:showBookActionSheetForEntry(item)
                end)
            end
            return
        end
        self:cacheBookDetail(detail)
        self:showBookActionSheet(detail, {
            allow_select = item.kind == "book" and self:bookMode(),
        })
    end)
end

function CatalogDetail:refreshDetailView()
    if self:detailMode() then
        self:updateItems()
    end
end

function CatalogDetail:applyReadStatus(detail, status)
    self:runConnected(function()
        local body, err = self:fetch(_("Saving the read status…"), function()
            return self.client:catalogSetReadStatus(detail.id, status)
        end)
        if not body then
            if err ~= "cancelled" then self:showWriteError(err) end
            return
        end
        detail.readStatus = body.readStatus or status
        self:markStackDirty()
        self:updateVisibleBookSummary(detail)
        self:refreshDetailView()
        Toast.show(T(_("Marked %1"), DetailData.statusLabel(detail.readStatus)))
    end)
end

function CatalogDetail:applyRating(detail, rating)
    self:runConnected(function()
        local body, err = self:fetch(_("Saving your rating…"), function()
            return self.client:catalogSetRating(detail.id, rating)
        end)
        if not body then
            if err ~= "cancelled" then self:showWriteError(err) end
            return
        end
        detail.rating = body.rating
        self:markStackDirty()
        self:updateVisibleBookSummary(detail)
        self:refreshDetailView()
        Toast.show(detail.rating and _("Rating saved") or _("Rating cleared"))
    end)
end

-- opts.push opens the book on top of this one (a related book), so Back
-- returns here; without it a detail page replaces the one shown (the pager).
function CatalogDetail:loadBookDetail(book_id, opts)
    opts = opts or {}
    local cached = self:cachedBookDetail(book_id)
    if cached and not NetworkMgr:isConnected() then
        self:showBookDetail(cached, { stale = true, push = opts.push, list = opts.list })
        return
    end
    local title = opts.title or (cached and cached.title)
    self:runConnected(function()
        local detail, err = self:fetchDeliveryBook(book_id, nil, title and T(_("Opening %1…"), title) or _("Opening the book…"))
        if not detail then
            if cached and err ~= "cancelled" then
                self:showBookDetail(cached, { stale = true, push = opts.push, list = opts.list })
                return
            end
            if err ~= "cancelled" then
                self:showRetry(err, function()
                    self:loadBookDetail(book_id, opts)
                end)
            end
            return
        end
        self:cacheBookDetail(detail)
        self:showBookDetail(detail, { push = opts.push, list = opts.list })
    end)
end

function CatalogDetail:supportedFiles(detail)
    local files = {}
    for _, file in ipairs(detail.files or {}) do
        if isSupportedFormat(file.format) then
            table.insert(files, file)
        end
    end
    return files
end

function CatalogDetail:nextDownloadFile(supported_files)
    for _, file in ipairs(supported_files or {}) do
        if file.role == "primary" and not self:onDeviceFilePath(file) then
            return file
        end
    end
    for _, file in ipairs(supported_files or {}) do
        if not self:onDeviceFilePath(file) then
            return file
        end
    end
    for _, file in ipairs(supported_files or {}) do
        if file.role == "primary" then
            return file
        end
    end
    return (supported_files or {})[1]
end

function CatalogDetail:downloadButtonLabel(supported_files)
    if #(supported_files or {}) == 0 then return _("No supported format") end
    local file = self:nextDownloadFile(supported_files)
    local format = cleanInlineText(file and file.format)
    if not format then return _("Download") end
    local format_label = fileFormatLabel(file)
    -- Size is what decides whether a download is worth starting over a slow
    -- connection, so it rides the button when the server knows it.
    local size = formatBytes(file and displaySize(file))
    if size ~= "" then
        return T(_("Download %1 - %2"), format_label, size)
    end
    return T(_("Download (%1)"), format_label)
end

function CatalogDetail:fileLabel(file, show_support)
    local label = fileFormatLabel(file)
    local extras = {}
    local size = formatBytes(displaySize(file))
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

-- About this book: the description on pages of its own.
function CatalogDetail:showFullText(_title, text, detail)
    detail = detail or (self.current_context and self.current_context.detail) or {}
    return require("bookorbit_text_pages").about(detail, text)
end

function CatalogDetail:showGenresAndTags(detail)
    return require("bookorbit_text_pages").tags(detail)
end

function CatalogDetail:showBookDetail(detail, opts)
    opts = opts or {}
    self:refreshOnDevice()
    local supported_files = self:supportedFiles(detail)
    local push = opts.push == true or not self:detailMode()
    -- The page names where Back goes: the list or page it was opened from.
    local parent_title
    if push then
        local current = self.current_context or {}
        parent_title = current.kind == "dashboard" and _("Home") or (current.title or self.title)
    else
        parent_title = self.current_context and self.current_context.back_label
    end
    self:switchTo(detail.title or _("Book details"), {
        {
            text = detail.title or _("Book details"),
            kind = "detail",
            detail = detail,
        },
    }, {
        kind = "detail",
        title = detail.title or _("Book details"),
        subtitle = opts.stale and _("Offline cache") or "",
        detail = detail,
        supported_files = supported_files,
        stale = opts.stale == true,
        back_label = parent_title,
        detail_page = 1,
        -- The list a home widget opened the book from, for the pager.
        list = type(opts.list) == "table" and type(opts.list.books) == "table" and opts.list or nil,
    }, push)
end

function CatalogDetail:recalculateDetailDimen()
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

-- Where this book sits in the list the page was opened from, for the pager:
-- its position across the whole list, and the neighbours on either side
-- (the next or previous server page counts too).
function CatalogDetail:detailListPosition()
    local prev_book, next_book, current_idx, count = self:getAdjacentDetailBooks()
    if not current_idx then return nil end
    local list = self.current_context and self.current_context.list
    if list then
        local titles = {}
        for _i, book in ipairs(list.books) do table.insert(titles, book.title) end
        return {
            label = list.label, index = current_idx, total = count, titles = titles,
            has_prev = prev_book ~= nil, has_next = next_book ~= nil,
            prev_title = prev_book and prev_book.title or nil, next_title = next_book and next_book.title or nil,
        }
    end
    local parent = self.stack[#self.stack]
    local parent_context = parent and parent.context or {}
    local books = parent_context.books or {}
    local page = tonumber(parent_context.page) or 1
    local size = parent_context.params and tonumber(parent_context.params.size) or #books
    local total = tonumber(parent_context.total) or #books
    local index = (page - 1) * size + current_idx
    local titles = {}
    for _i, book in ipairs(books) do table.insert(titles, book.title) end
    return {
        label = parent and parent.title or parent_context.title,
        index = index,
        total = total,
        titles = titles,
        has_prev = index > 1,
        has_next = index < total,
        prev_title = prev_book and prev_book.title or nil,
        next_title = next_book and next_book.title or nil,
    }
end

-- ------------------------------------------------------------- the page

function CatalogDetail:detailMenuItems(d, detail)
    local items = {}
    if d.status == "read" then
        table.insert(items, { icon = "rotate-ccw", label = _("Mark as unread"), action = { kind = "status", value = "unread" } })
    else
        table.insert(items, { icon = "book-check", label = _("Mark as read"), action = { kind = "status", value = "read" } })
    end
    if d.author_first then
        local label = #d.author_first <= 24 and T(_("More by %1"), d.author_first) or _("More by this author")
        table.insert(items, { icon = "user", label = label, action = { kind = "author" } })
    end
    if CatalogDetail.detailSeriesParams(detail) then
        table.insert(items, { icon = "layers-2", label = _("Open series"), action = { kind = "series" } })
    end
    if d.highlights and d.highlights.count > 0 then
        table.insert(items, { icon = "highlighter", label = T(_("Highlights (%1)"), d.highlights.count), action = { kind = "highlights" } })
    end
    if #d.usable > 0 then
        table.insert(items, { icon = "download", label = _("Download options"), action = { kind = "download-options" } })
    end
    table.insert(items, { icon = "refresh-cw", label = _("Refresh from BookOrbit"), action = { kind = "refresh" } })
    if d.on_device then
        table.insert(items, { icon = "trash", label = _("Remove from device"), action = { kind = "remove" }, separator = true })
    end
    self._detail_menu_items = {}
    for _i, item in ipairs(items) do table.insert(self._detail_menu_items, { icon = item.icon, label = item.label, separator = item.separator }) end
    return items
end

function CatalogDetail:updateDetailItems(select_number, no_recalculate_dimen)
    local old_dimen = self:prepareCustomUpdate(no_recalculate_dimen)
    self:ensureOnDeviceCurrent()
    local context = self.current_context
    local detail = context.detail
    local d = DetailData.build(self, context, os.time())
    self._detail_model = d
    local run = function(action, region, hold) self:detailRun(action, region, hold) end
    local screen, rows, regions = DetailView.build({
        d = d,
        page = context.detail_page or 1,
        sheet = context.detail_sheet,
        menu_items = context.detail_sheet == "menu" and self:detailMenuItems(d, detail) or nil,
        run = run,
        screen_w = self.inner_dimen.w,
        screen_h = self.available_height,
    })
    self._detail_regions = regions
    table.insert(self.item_group, screen)
    -- With a sheet open the cursor moves only through the sheet.
    local sheet = context.detail_sheet
    for _i, row in ipairs(rows) do
        local id = tostring(row.id)
        local in_sheet = id:match("^sheet") or id:match("^menu%-")
        if (sheet and in_sheet) or (not sheet and not in_sheet) then
            if id == "actions" then row.is_primary = true end
            table.insert(self.layout, row)
        end
    end
    self:detailScheduleClock()
    self:finishCustomUpdate(old_dimen, select_number)
    if DUMP_DIR then
        self:detailDump(d, context)
        UIManager:scheduleIn(1, function() self:detailDumpRects() end)
    end
    -- The page's own book and its shelf covers download behind the draw.
    local books = { detail }
    -- Every tab's covers, so switching tabs shows them at once.
    for _i, tab in ipairs(d.shelf_tabs or {}) do
        for _j, b in ipairs(tab.books) do table.insert(books, b) end
    end
    self:scheduleThumbnailDownloads(books)
end

-- Once a minute the header's clock is redrawn in place, like the home page:
-- only its own rectangle refreshes.
function CatalogDetail:detailScheduleClock()
    if self._detail_clock_task then UIManager:unschedule(self._detail_clock_task) end
    self._detail_clock_task = function()
        self._detail_clock_task = nil
        if self.catalog_closed or not self:detailMode() then return end
        local status = self._detail_regions and self._detail_regions.status
        if status and status.dimen and status.dimen.x and (not self.boardIsTopmost or self:boardIsTopmost()) then
            local datetime = require("datetime")
            local d = self._detail_model or {}
            d.clock = datetime.secondsToHour(os.time(), G_reader_settings:isTrue("twelve_hour_clock"))
            DetailView.refreshStatus(status, d)
            local dimen = status.dimen
            UIManager:setDirty(self.show_parent, function() return "fast", dimen end)
        end
        self:detailScheduleClock()
    end
    UIManager:scheduleIn(60 - os.time() % 60 + 1, self._detail_clock_task)
end

function CatalogDetail:detailSetSheet(sheet)
    local context = self.current_context
    if not context then return end
    context.detail_sheet = sheet
    self:updateItems(nil, true)
end

function CatalogDetail:detailSetPage(page)
    local context = self.current_context
    if not context then return end
    context.detail_page = page
    context.detail_sheet = nil
    self:updateItems(nil, true)
end

-- Every control on the page lands here.
function CatalogDetail:detailRun(action, region, hold)
    local context = self.current_context or {}
    local detail = context.detail
    local d = self._detail_model or {}
    if not detail then return end
    local kind = action.kind
    if hold then
        if kind == "detail" and action.book_id then
            return self:showBookActionSheetForEntry({ kind = "dashboard-book", book_id = action.book_id })
        end
        return
    end
    if kind == "back" then
        return self:detailBack()
    elseif kind == "menu" then
        if context.detail_sheet == "menu" then return self:detailSetSheet(nil) end
        return self:detailSetSheet("menu")
    elseif kind == "close-sheet" then
        return self:detailSetSheet(nil)
    elseif kind == "details" then
        return self:detailSetPage(2)
    elseif kind == "shelf-tab" then
        if context.detail_shelf == action.value then return end
        context.detail_shelf = action.value
        return self:updateItems(nil, true)
    elseif kind == "verdict" then
        return self:detailSetSheet("verdict")
    elseif kind == "page" then
        context.detail_sheet = nil
        if action.delta > 0 then return self:onNextPage() end
        return self:onPrevPage()
    elseif kind == "primary" or kind == "cover" then
        return self:detailPrimary(d, detail, kind == "cover")
    elseif kind == "rate" then
        context.detail_sheet = nil
        local value = action.value
        -- Tapping the rating already given clears it.
        if value ~= nil and tonumber(detail.rating) == value and not action.from_sheet then value = nil end
        return self:applyRating(detail, value)
    elseif kind == "status" then
        context.detail_sheet = nil
        return self:applyReadStatus(detail, action.value)
    elseif kind == "series" then
        context.detail_sheet = nil
        return self:openDetailSeries(detail)
    elseif kind == "author" then
        context.detail_sheet = nil
        local name = d.author_first
        if name then return self:loadBooks({ author = name, sort = "title" }, name, true) end
    elseif kind == "detail" then
        return self:loadBookDetail(action.book_id, { push = true })
    elseif kind == "tags" then
        return self:showGenresAndTags(detail)
    elseif kind == "about" then
        return self:showFullText(_("About this book"), detail.description, detail)
    elseif kind == "highlights" then
        if context.detail_sheet then
            context.detail_sheet = nil
            self:updateItems(nil, true)
        end
        return self:showDetailHighlights(d)
    elseif kind == "get" then
        return self:downloadDefaultFile(detail, action.file)
    elseif kind == "download-options" then
        context.detail_sheet = nil
        self:updateItems(nil, true)
        return self:showDownloadOptions(detail)
    elseif kind == "refresh" then
        context.detail_sheet = nil
        return self:refreshCurrent()
    elseif kind == "remove" then
        context.detail_sheet = nil
        self:updateItems(nil, true)
        return self:detailRemoveFromDevice(d)
    end
end

-- Back closes a sheet first, then leaves More details, then the page.
function CatalogDetail:detailBack()
    local context = self.current_context or {}
    if context.detail_sheet then return self:detailSetSheet(nil) end
    if (context.detail_page or 1) == 2 then return self:detailSetPage(1) end
    return self:onReturn()
end

function CatalogDetail:detailPrimary(d, detail, from_cover)
    local p = d.primary or {}
    if p.kind == "continue" or p.kind == "start" or p.kind == "again" then
        if d.read_path then return self:openDownloadedFile(d.read_path) end
    elseif from_cover then
        return
    elseif p.kind == "download" and p.entry then
        return self:downloadDefaultFile(detail, p.entry.file)
    elseif p.kind == "downloading" then
        -- The button is the cancel control while it fills.
        self:nextDownloadGeneration()
        self.current_context.downloading = nil
        self:updateItems(nil, true)
        Toast.show(_("Download cancelled"), { icon = "x" })
    end
end

-- The sidecar's highlights, newest first, on pages of their own.
function CatalogDetail:showDetailHighlights(d)
    local hl = d.highlights
    if not hl or not hl.items or #hl.items == 0 then
        Toast.show(_("No highlights in this book yet"), { icon = "info" })
        return
    end
    return require("bookorbit_text_pages").highlights(d.detail or {}, hl)
end

-- Deletes the book's file and sidecar from this device through KOReader's
-- own file manager, which asks first. The book stays in the library.
function CatalogDetail:detailRemoveFromDevice(d)
    local path = d.read_path
    if not path then return end
    local FileManager = require("apps/filemanager/filemanager")
    local fm = FileManager.instance
    if not fm or not fm.showDeleteFileDialog then
        Toast.error(_("Open the file browser to remove this book."))
        return
    end
    fm:showDeleteFileDialog(path, function()
        self:refreshOnDevice()
        self:markStackDirty()
        self:refreshDetailView()
    end)
end

-- Download progress for the book on screen, drawn in its action button.
-- Returns false when the page shows another book (the caller keeps its own
-- dialog then).
function CatalogDetail:detailShowDownloadProgress(detail, received, total, done)
    if not self:detailMode() then return false end
    local context = self.current_context
    if not context or not context.detail or context.detail.id ~= (detail and detail.id) then return false end
    if done then
        context.downloading = nil
        self:updateItems(nil, true)
        return true
    end
    -- Without a known size there is no percentage, only what has arrived.
    local pct = (total and total > 0) and math.floor(received * 100 / total) or nil
    local sub = total and total > 0 and T(_("%1 of %2"), formatBytes(received), formatBytes(total)) or formatBytes(received)
    local first = context.downloading == nil
    context.downloading = { pct = pct and math.max(0, math.min(99, pct)) or nil, sub = sub }
    local primary = self._detail_regions and self._detail_regions.primary
    if first or not primary or not primary.dimen or not primary.dimen.x then
        self:updateItems(nil, true)
    else
        DetailView.refreshPrimary(primary, { kind = "downloading", pct = context.downloading.pct, sub = sub })
        local dimen = primary.dimen
        UIManager:setDirty(self.show_parent, function() return "fast", dimen end)
    end
    return true
end

-- ------------------------------------------------------------ parity dump
-- With BO_DETAIL_DUMP set (a directory), each render writes the model it drew
-- in the design mock's shape, plus the rectangles of the main controls, so
-- the mock can draw the same page and the two can be compared pixel for
-- pixel. Development only.
local function jsonValue(v, depth)
    depth = depth or 0
    local t = type(v)
    if v == nil then return "null" end
    if t == "boolean" then return v and "true" or "false" end
    if t == "number" then
        if v ~= v or v == math.huge or v == -math.huge then return "null" end
        if v == math.floor(v) then return tostring(v) end
        return string.format("%.17g", v)
    end
    if t == "string" then
        return '"' .. v:gsub('[%c"\\]', function(ch)
            if ch == '"' then return '\\"' end
            if ch == "\\" then return "\\\\" end
            if ch == "\n" then return "\\n" end
            return string.format("\\u%04x", ch:byte())
        end) .. '"'
    end
    if t == "table" then
        if depth > 10 then return "null" end
        local n = #v
        if n > 0 or next(v) == nil then
            local parts = {}
            for i = 1, n do parts[i] = jsonValue(v[i], depth + 1) end
            return "[" .. table.concat(parts, ",") .. "]"
        end
        local parts = {}
        for k, val in pairs(v) do
            if type(k) == "string" and type(val) ~= "function" then
                table.insert(parts, jsonValue(k) .. ":" .. jsonValue(val, depth + 1))
            end
        end
        return "{" .. table.concat(parts, ",") .. "}"
    end
    return "null"
end

local function mockBook(b)
    if type(b) ~= "table" then return nil end
    local BoardUI = require("bookorbit_board_ui")
    return {
        id = b.id, title = b.title, authors = b.authors, seriesName = b.seriesName, seriesIndex = b.seriesIndex,
        coverPath = b.cover_path, coverAspect = b.cover_path and BoardUI.nativeAspect(b.cover_path) or nil,
    }
end

local function mockFile(e)
    return { format = e.format, title = e.title, audio = e.audio, opens = e.opens, readAlong = e.read_along,
        textOnly = e.text_only, onDevice = e.on_device, size = e.size, duration = e.duration }
end

function CatalogDetail:detailDump(d, context)
    if not DUMP_DIR then return end
    local Device = require("device")
    local BoardMetrics = require("bookorbit_board_metrics")
    local m = BoardMetrics.get()
    local books = {}
    for _i, b in ipairs((d.shelf and d.shelf.books) or {}) do table.insert(books, mockBook(b)) end
    local author_books = {}
    for _i, b in ipairs(d.author_books or {}) do table.insert(author_books, mockBook(b)) end
    local files = {}
    for _i, e in ipairs(d.usable) do table.insert(files, mockFile(e)) end
    for _i, e in ipairs(d.other) do table.insert(files, mockFile(e)) end
    local series
    if d.series then
        local list = {}
        for _i, b in ipairs(d.series.books) do
            table.insert(list, { id = b.id, title = b.title, index = b.index, status = b.status, pct = b.pct, current = b.current })
        end
        series = { name = d.series.name, total = d.series.total, complete = d.series.complete, read = d.series.read,
            books = list, next = d.series.next and { id = d.series.next.id, index = d.series.next.index, title = d.series.next.title } or nil }
    end
    local p = d.progress
    local j = d.journal
    local detail = d.detail
    local model = {
        title = d.title, subtitle = d.subtitle, authors = d.authors, authorLines = d.author_lines,
        book = mockBook({ id = detail.id, title = detail.title, authors = detail.authors, seriesName = detail.seriesName,
            seriesIndex = detail.seriesIndex, cover_path = d.cover_path }),
        status = d.status, statusLabel = d.status_label, rating = d.rating, pct = d.pct, pages = d.pages,
        kicker = d.kicker,
        progress = p and { pct = p.pct, label = p.label, page = p.page, pageShort = p.page_short, left = p.left, leftShort = p.left_short,
            finish = p.finish and { day = p.finish.day, short = p.finish.short, date = p.finish.date }, perDay = p.finish and p.finish.per_day } or nil,
        journal = j and { started = j.started, time = j.time, timeShort = j.time_short, days = j.days, lastRead = j.last_read,
            pace = j.pace, paceShort = j.pace_short, finishedOn = j.finished_on, path = j.path } or nil,
        finishedOn = d.finished and d.finished.date or nil,
        notStarted = d.not_started,
        highlights = d.highlights and { count = d.highlights.count, latest = d.highlights.latest } or nil,
        description = d.description, chips = d.chips, facts = d.facts, spec = d.spec, files = files,
        primary = d.primary and { kind = d.primary.kind, icon = d.primary.icon, labels = d.primary.labels, pct = d.primary.pct, sub = d.primary.sub } or nil,
        series = series,
        shelf = d.shelf and { kind = d.shelf.kind, label = d.shelf.label, books = books } or nil,
        shelfTabs = (function()
            local tabs = {}
            for _i, tab in ipairs(d.shelf_tabs or {}) do table.insert(tabs, { kind = tab.kind, label = tab.label }) end
            return #tabs > 1 and tabs or nil
        end)(),
        authorBooks = #author_books > 0 and author_books or nil,
        authorFirst = d.author_first,
        pager = d.pager, from = d.back, offline = d.offline, online = d.online, onDevice = d.on_device,
        clock = d.clock, battery = Device:hasBattery() and Device:getPowerDevice():getCapacity() or nil,
    }
    local doc = { data = model, page = context.detail_page or 1, sheet = context.detail_sheet,
        w = m.w, h = m.h, dpi = Device.screen:getDPI(), menuItems = context.detail_sheet == "menu" and self._detail_menu_items or nil }
    local f = io.open(DUMP_DIR .. "/detail-dump.json", "w")
    if f then f:write(jsonValue(doc)); f:close() end
end

-- The rectangles of the page's named controls once painted.
function CatalogDetail:detailDumpRects()
    if not DUMP_DIR then return end
    local rects = {}
    for key, region in pairs(self._detail_regions or {}) do
        local dm = region.dimen
        if dm and dm.x then rects[key] = { x = dm.x, y = dm.y, w = dm.w, h = dm.h } end
    end
    local f = io.open(DUMP_DIR .. "/detail-rects.json", "w")
    if f then f:write(jsonValue(rects)); f:close() end
end

function CatalogDetail.install(Catalog)
    for name, fn in pairs(CatalogDetail) do
        if name ~= "install" then
            Catalog[name] = fn
        end
    end
end

return CatalogDetail
