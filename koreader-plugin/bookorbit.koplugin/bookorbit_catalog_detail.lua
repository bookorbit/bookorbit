--[[--
Book detail mixin for the BookOrbit catalog browser.

Owns the full-page book detail view (hero header, description, related
shelves), the offline detail cache, the book action sheet and the read
status / rating dialogs. Installed onto the catalog controller as regular
methods.

The detail page uses a shared horizontal inset and content-sized text blocks:
every text widget is measured after building, leftover vertical space goes
into a single flexible gap inside the header (info pinned to the cover top,
actions pinned to its bottom) instead of being spread across fixed slots.
]]

local BD = require("ui/bidi")
local Blitbuffer = require("ffi/blitbuffer")
local Button = require("ui/widget/button")
local ButtonDialog = require("ui/widget/buttondialog")
local CenterContainer = require("ui/widget/container/centercontainer")
local LeftContainer = require("ui/widget/container/leftcontainer")
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
local TextViewer = require("ui/widget/textviewer")
local UIManager = require("ui/uimanager")
local VerticalGroup = require("ui/widget/verticalgroup")
local VerticalSpan = require("ui/widget/verticalspan")
local T = require("ffi/util").template
local _ = require("gettext")

local InputContainer = require("ui/widget/container/inputcontainer")
local GestureRange = require("ui/gesturerange")

local CatalogUtil = require("bookorbit_catalog_util")
local CatalogWidgets = require("bookorbit_catalog_widgets")

local cleanDescriptionText = CatalogUtil.cleanDescriptionText
local cleanInlineText = CatalogUtil.cleanInlineText
local coverLabel = CatalogUtil.coverLabel
local formatBytes = CatalogUtil.formatBytes
local formatDuration = CatalogUtil.formatDuration
local formatProgress = CatalogUtil.formatProgress
local formatRating = CatalogUtil.formatRating
local isSupportedFormat = CatalogUtil.isSupportedFormat
local SETTABLE_READ_STATUSES = CatalogUtil.SETTABLE_READ_STATUSES
local joinNames = CatalogUtil.joinNames
local shortText = CatalogUtil.shortText

local buildCoverWidget = CatalogWidgets.buildCoverWidget
local BookOrbitDetailRelatedCard = CatalogWidgets.DetailRelatedCard
local BookOrbitDetailTabButton = CatalogWidgets.DetailTabButton
local BookOrbitDetailRatingStar = CatalogWidgets.DetailRatingStar

-- Max genres/tags shown inline on the detail page before a "+N more" pill.
local DETAIL_TAGS_INLINE = 6
local DETAIL_CACHE_MAX_BOOKS = 80

-- Shared spacing scale for the detail page. INSET is the left/right content
-- margin every section aligns to; the gaps are the only vertical rhythm used.
local DETAIL_INSET = Screen:scaleBySize(16)
local DETAIL_RELATED_SHELF_INSET = Screen:scaleBySize(12)
local DETAIL_GAP_XS = Screen:scaleBySize(4)
local DETAIL_GAP_S = Screen:scaleBySize(8)
local DETAIL_GAP_M = Screen:scaleBySize(14)
local DETAIL_TABS_HEIGHT = Screen:scaleBySize(36)
local DETAIL_PILL_HEIGHT = Screen:scaleBySize(26)
local DETAIL_STAR_SIZE = Screen:scaleBySize(30)
local DETAIL_PROGRESS_BAR_HEIGHT = Screen:scaleBySize(7)
local DETAIL_BUTTON_HEIGHT = Screen:scaleBySize(38)
local DETAIL_DESCRIPTION_HEIGHT = Screen:scaleBySize(136)
local DETAIL_COVER_ASPECT = 0.66
local DETAIL_RELATED_TALL_ASPECT_RATIO = 1.55
local DETAIL_RELATED_MAX_ROWS = 2

-- Mirrors TextBoxWidget's own line height math so single/double line boxes
-- can be sized exactly.
local function lineHeight(face)
    return math.floor(1.3 * face.size + 0.5)
end

local DetailDescriptionWidget = InputContainer:extend{
    detail = nil,
    width = nil,
    max_height = nil,
    menu = nil,
}

function DetailDescriptionWidget:init()
    local text_w = self.width - 2 * DETAIL_INSET
    local description = cleanDescriptionText(self.detail.description)
    local text = description or _("No description available.")

    local face = Font:getFace("smallinfofont", 15)
    local text_h = math.max(lineHeight(face), self.max_height)

    local dimen = Geom:new{ w = self.width, h = text_h }
    self.dimen = dimen

    local has_desc = description ~= nil
    if has_desc then
        self.ges_events = {
            TapSelect = { GestureRange:new{ ges = "tap", range = dimen } },
        }
    end

    self[1] = HorizontalGroup:new{
        HorizontalSpan:new{ width = DETAIL_INSET },
        TextBoxWidget:new{
            text = BD.auto(text),
            width = text_w,
            height = text_h,
            height_overflow_show_ellipsis = true,
            face = face,
        },
        HorizontalSpan:new{ width = DETAIL_INSET },
    }
end

function DetailDescriptionWidget:onTapSelect()
    if cleanDescriptionText(self.detail.description) then
        self.menu:showFullText(_("Description"), self.detail.description)
    end
    return true
end

local DetailOverviewWidget = InputContainer:extend{
    detail = nil,
    width = nil,
    max_height = nil,
    menu = nil,
}

function DetailOverviewWidget:init()
    local text_w = self.width - 2 * DETAIL_INSET
    local description = cleanDescriptionText(self.detail.description)

    local face = Font:getFace("x_smallinfofont")
    local text_h = math.max(lineHeight(face), self.max_height)

    local dimen = Geom:new{ w = self.width, h = text_h }
    self.dimen = dimen

    local has_desc = description ~= nil
    if has_desc then
        self.ges_events = {
            TapSelect = { GestureRange:new{ ges = "tap", range = dimen } },
        }
    end

    self[1] = HorizontalGroup:new{
        HorizontalSpan:new{ width = DETAIL_INSET },
        TextBoxWidget:new{
            text = table.concat(self.menu:detailOverviewLines(self.detail), "\n"),
            width = text_w,
            height = text_h,
            height_adjust = true,
            height_overflow_show_ellipsis = true,
            face = face,
        },
        HorizontalSpan:new{ width = DETAIL_INSET },
    }
end

function DetailOverviewWidget:onTapSelect()
    if cleanDescriptionText(self.detail.description) then
        self.menu:showFullText(_("Description"), self.detail.description)
    end
    return true
end

local DetailPillWidget = InputContainer:extend{
    text = nil,
    height = nil,
    max_width = nil,
    callback = nil,
}

function DetailPillWidget:init()
    local pill = CatalogWidgets.buildDetailPill(self.text, self.height, self.max_width)
    local dimen = Geom:new{ w = pill:getSize().w, h = pill:getSize().h }
    self.dimen = dimen
    self.ges_events = {
        TapSelect = { GestureRange:new{ ges = "tap", range = dimen } },
    }
    self[1] = pill
end

function DetailPillWidget:onTapSelect()
    if self.callback then
        self.callback()
    end
    return true
end

local CatalogDetail = {}

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
    return detail ~= nil and detail.id ~= nil and self.on_device[detail.id] or nil
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
    local entry = self:detailCache()[tostring(book_id)]
    if type(entry) == "table" and type(entry.detail) == "table" then
        return entry.detail
    end
    return nil
end

function CatalogDetail:cacheBookDetail(detail)
    if type(detail) ~= "table" or detail.id == nil then return end
    local cache = self:detailCache()
    cache[tostring(detail.id)] = {
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

function CatalogDetail:showBookActionSheet(detail, opts)
    if not detail then return end
    opts = opts or {}
    self:refreshOnDevice()

    local has_genres = detail.genres and #detail.genres > 0
    local has_tags = detail.tags and #detail.tags > 0
    local supported_files = opts.supported_files or self:supportedFiles(detail)
    local include_details = opts.include_details ~= false
    local include_quick_actions = opts.include_quick_actions ~= false
    local allow_select = opts.allow_select == true
    local read_path = self:detailReadPath(detail)
    local undownloaded = 0
    for _, file in ipairs(supported_files) do
        if not self:onDeviceFilePath(file) then
            undownloaded = undownloaded + 1
        end
    end
    local show_download = #supported_files > 0 and (read_path == nil or undownloaded > 0)
    local dialog
    local buttons = {}
    local function addRow(first, second)
        if second then
            table.insert(buttons, { first, second })
        else
            table.insert(buttons, { first })
        end
    end
    local function closeThen(callback)
        UIManager:close(dialog)
        callback()
    end
    local download_options_button = (include_details and #supported_files > 0) and {
        text = _("Download options"),
        callback = function()
            closeThen(function()
                self:showDownloadOptions(detail)
            end)
        end,
    } or nil
    local description_button = include_details and {
        text = _("Description"),
        enabled = cleanDescriptionText(detail.description) ~= nil,
        callback = function()
            closeThen(function()
                self:showFullText(_("Description"), detail.description)
            end)
        end,
    } or nil

    if include_details or allow_select then
        local details_button = include_details and {
            text = _("Details"),
            callback = function()
                closeThen(function()
                    self:showBookDetail(detail)
                end)
            end,
        } or nil
        local select_button
        if allow_select then
            local selected = self.bulkIsBookSelected and self:bulkIsBookSelected(detail)
            select_button = {
                text = selected and _("Unselect") or _("Select"),
                callback = function()
                    closeThen(function()
                        if self:isBulkSelectionActive() then
                            self:bulkToggleBook(detail)
                        else
                            self:bulkEnterSelectionMode({ kind = "book", book = detail })
                        end
                    end)
                end,
            }
        end
        addRow(details_button or select_button, details_button and select_button or nil)
    end

    if include_quick_actions then
        local read_button = read_path and {
            text = _("Read"),
            callback = function()
                closeThen(function()
                    self:openDownloadedFile(read_path)
                end)
            end,
        } or nil
        local download_button = {
            text = self:downloadButtonLabel(supported_files),
            enabled = show_download,
            callback = function()
                closeThen(function()
                    if #supported_files == 1 then
                        self:downloadDefaultFile(detail, supported_files[1])
                    else
                        self:showFileChoices(detail)
                    end
                end)
            end,
        }
        if read_button and show_download then
            addRow(read_button, download_button)
        elseif read_button then
            addRow(read_button)
        else
            addRow(download_button)
        end
    end

    if download_options_button and description_button then
        addRow(download_options_button, description_button)
    elseif download_options_button then
        addRow(download_options_button)
    elseif description_button then
        addRow(description_button)
    end

    if include_details then
        addRow({
            text = _("Genres"),
            enabled = has_genres,
            callback = function()
                closeThen(function()
                    self:showFullList(_("Genres"), detail.genres)
                end)
            end,
        }, {
            text = _("Tags"),
            enabled = has_tags,
            callback = function()
                closeThen(function()
                    self:showFullList(_("Tags"), detail.tags)
                end)
            end,
        })
    end

    if opts.include_page_actions == true then
        addRow({
            text = _("Dashboard"),
            callback = function()
                closeThen(function()
                    self:goDashboard()
                end)
            end,
        }, {
            text = _("Close BookOrbit"),
            callback = function()
                closeThen(function()
                    self:onCloseAllMenus()
                end)
            end,
        })
    end

    dialog = ButtonDialog:new{
        title = detail.title or _("Book"),
        buttons = buttons,
    }
    UIManager:show(dialog)
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
    self:runConnected(function()
        local detail, err = self:fetch(_("Loading book..."), function()
            return self.client:catalogBook(book_id)
        end)
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

function CatalogDetail:showSetStatusDialog(detail)
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

function CatalogDetail:showSetRatingDialog(detail)
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

function CatalogDetail:refreshDetailView()
    if self:detailMode() then
        self:updateItems()
    end
end

function CatalogDetail:applyReadStatus(detail, status)
    self:runConnected(function()
        local body, err = self:fetch(_("Saving..."), function()
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
        UIManager:show(InfoMessage:new{ text = _("Read status updated"), timeout = 1 })
    end)
end

function CatalogDetail:applyRating(detail, rating)
    self:runConnected(function()
        local body, err = self:fetch(_("Saving..."), function()
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
        UIManager:show(InfoMessage:new{ text = _("Rating updated"), timeout = 1 })
    end)
end

function CatalogDetail:rateDetailFromStar(rating)
    local context = self.current_context or {}
    local detail = context.detail
    if not detail then return end
    if rating ~= nil and tonumber(detail.rating) == rating then
        rating = nil
    end
    self:applyRating(detail, rating)
end

function CatalogDetail:loadBookDetail(book_id)
    local cached = self:cachedBookDetail(book_id)
    if cached and not NetworkMgr:isConnected() then
        self:showBookDetail(cached, { stale = true })
        return
    end
    self:runConnected(function()
        local detail, err = self:fetch(_("Loading book..."), function()
            return self.client:catalogBook(book_id)
        end)
        if not detail then
            if cached and err ~= "cancelled" then
                self:showBookDetail(cached, { stale = true })
                return
            end
            if err ~= "cancelled" then
                self:showRetry(err, function()
                    self:loadBookDetail(book_id)
                end)
            end
            return
        end
        self:cacheBookDetail(detail)
        self:showBookDetail(detail)
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
    return T(_("Download (%1)"), string.upper(format))
end

function CatalogDetail:fileLabel(file, show_support)
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

function CatalogDetail:fileMetadataValue(detail)
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

function CatalogDetail:cappedListText(items)
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

function CatalogDetail:detailOverviewLines(detail)
    local lines = {}
    local description = cleanDescriptionText(detail.description)
    if description then
        table.insert(lines, _("Description"))
        table.insert(lines, shortText(description, 360))
    end

    if #lines == 0 then
        table.insert(lines, _("No description available."))
    end
    return lines
end

function CatalogDetail:showFullText(title, text)
    text = cleanDescriptionText(text) or _("Nothing to show.")
    UIManager:show(TextViewer:new{
        title = title,
        text = text,
    })
end

function CatalogDetail:showFullList(title, items)
    if not items or #items == 0 then
        UIManager:show(InfoMessage:new{ text = _("None."), timeout = 2 })
        return
    end
    UIManager:show(TextViewer:new{
        title = title,
        text = table.concat(items, "\n"),
    })
end

function CatalogDetail:showBookDetail(detail, opts)
    opts = opts or {}
    self:refreshOnDevice()
    local supported_files = self:supportedFiles(detail)
    local push = not self:detailMode()
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
        related_tab = nil,
        related_pages = {},
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

function CatalogDetail.detailHeroMetaLine(_unused, detail)
    local parts = {}
    if detail.publishedYear then table.insert(parts, tostring(detail.publishedYear)) end
    if detail.publisher then table.insert(parts, detail.publisher) end
    if detail.pageCount then table.insert(parts, T(_("%1 pages"), detail.pageCount)) end
    return #parts > 0 and table.concat(parts, " - ") or nil
end

function CatalogDetail.detailPillItems(_unused, detail)
    local items = {}
    local seen = {}
    local function add(value)
        value = cleanInlineText(value)
        local key = value and string.lower(value) or nil
        if value and not seen[key] then
            seen[key] = true
            table.insert(items, string.upper(value))
        end
    end
    for _, value in ipairs(detail.genres or {}) do add(value) end
    for _, value in ipairs(detail.tags or {}) do add(value) end
    if #items == 0 then add(detail.libraryName) end
    return items
end

function CatalogDetail:detailProgressText(detail)
    local parts = {}
    local progress = formatProgress(detail.progressPercentage)
    if detail.pageCount and progress then
        local current = math.floor(detail.pageCount * (detail.progressPercentage or 0) / 100 + 0.5)
        table.insert(parts, T(_("%1 / %2 pages"), current, detail.pageCount))
    elseif detail.pageCount then
        table.insert(parts, T(_("%1 pages"), detail.pageCount))
    elseif progress then
        table.insert(parts, T(_("Progress %1"), progress))
    end
    if self:isOnDevice(detail) then table.insert(parts, _("On device")) end
    return #parts > 0 and table.concat(parts, " - ") or nil
end

function CatalogDetail:detailRelatedPage(section_id, page_count)
    local context = self.current_context or {}
    context.related_pages = context.related_pages or {}
    local page = tonumber(context.related_pages[section_id]) or 1
    if page < 1 then page = 1 end
    if page > page_count then page = page_count end
    context.related_pages[section_id] = page
    return page
end

function CatalogDetail:detailTallLayout()
    return self.inner_dimen.h / math.max(1, self.inner_dimen.w) >= DETAIL_RELATED_TALL_ASPECT_RATIO
end

function CatalogDetail:turnDetailRelatedPage(section_id, delta)
    local context = self.current_context or {}
    context.related_pages = context.related_pages or {}
    context.related_pages[section_id] = math.max(1, (tonumber(context.related_pages[section_id]) or 1) + delta)
    self:updateItems(nil, true)
end

function CatalogDetail.detailRelatedTabLabel(_unused, section)
    local id = section and section.id
    if id == "similar" then return string.upper(_("Similar Books")) end
    if id == "author" then return string.upper(_("More by Author")) end
    if id == "series" then return string.upper(_("More in series")) end
    return string.upper(section and section.title or _("Related"))
end

function CatalogDetail:orderedDetailRelatedSections(related)
    local by_id = {}
    for _, section in ipairs(related or {}) do
        if section and section.id then
            by_id[section.id] = section
        end
    end

    local specs = {
        { id = "similar", title = _("Similar books") },
        { id = "author", title = _("Also by this author") },
        { id = "series", title = _("More in series") },
    }
    local ordered = {}
    for _, spec in ipairs(specs) do
        local section = by_id[spec.id] or {
            id = spec.id,
            title = spec.title,
            books = {},
        }
        section.title = section.title or spec.title
        if type(section.books) ~= "table" then section.books = {} end
        table.insert(ordered, section)
    end
    return ordered
end

function CatalogDetail:activeDetailRelatedSection(related)
    local context = self.current_context or {}
    local active_id = context.related_tab
    for _, section in ipairs(related) do
        if section.id == active_id then
            return section
        end
    end
    for _, section in ipairs(related) do
        if type(section.books) == "table" and #section.books > 0 then
            context.related_tab = section.id
            return section
        end
    end
    local first = related[1]
    if first then context.related_tab = first.id end
    return first
end

function CatalogDetail:selectDetailRelatedTab(section_id)
    local context = self.current_context or {}
    if context.related_tab == section_id then return true end
    context.related_tab = section_id
    self:updateItems(nil, true)
    return true
end

function CatalogDetail:detailCoverDimensions()
    local cover_h = math.min(
        Screen:scaleBySize(300),
        math.max(Screen:scaleBySize(150), math.floor(self.available_height * 0.38)))
    local cover_w = math.floor(cover_h * DETAIL_COVER_ASPECT)
    local max_cover_w = math.floor(self.inner_dimen.w * 0.38)
    if cover_w > max_cover_w then
        cover_w = max_cover_w
        cover_h = math.floor(cover_w / DETAIL_COVER_ASPECT)
    end
    return cover_w, cover_h
end

function CatalogDetail:buildDetailRating(detail, width)
    local rating = tonumber(detail.rating) or 0
    local row = HorizontalGroup:new{ align = "center" }
    self.detail_rating_stars = {}
    for star = 1, 5 do
        local widget = BookOrbitDetailRatingStar:new{
            entry = {
                rating = star,
                filled = rating >= star,
            },
            dimen = Geom:new{ w = DETAIL_STAR_SIZE, h = DETAIL_STAR_SIZE },
            menu = self,
        }
        table.insert(row, widget)
        table.insert(self.detail_rating_stars, widget)
    end
    table.insert(row, HorizontalSpan:new{ width = DETAIL_GAP_S })
    local label_face = Font:getFace("xx_smallinfofont", 12)
    table.insert(row, TextBoxWidget:new{
        text = rating > 0 and formatRating(rating) or _("Not rated"),
        width = math.max(1, width - 5 * DETAIL_STAR_SIZE - DETAIL_GAP_S),
        height = lineHeight(label_face),
        height_overflow_show_ellipsis = true,
        face = label_face,
    })
    return row
end

function CatalogDetail:buildDetailPillRow(items, width, title, more_button_key)
    if #items == 0 then return nil end

    local max_pill_w = math.floor(width * 0.45)
    local row = HorizontalGroup:new{ align = "center" }
    local used = 0
    local shown = 0
    if more_button_key then self[more_button_key] = nil end

    for i = 1, #items do
        local text = items[i]
        local pill = DetailPillWidget:new{
            text = text,
            height = DETAIL_PILL_HEIGHT,
            max_width = max_pill_w,
            callback = function()
                self:showFullList(title, items)
            end,
        }
        local pill_w = pill:getSize().w
        local remaining_after = #items - shown - 1
        local more_w = 0
        if remaining_after > 0 then
            more_w = DetailPillWidget:new{
                text = T(_("+%1"), remaining_after),
                height = DETAIL_PILL_HEIGHT,
                max_width = max_pill_w,
            }:getSize().w
        end
        local gap_w = shown > 0 and DETAIL_GAP_S or 0
        local reserve_w = remaining_after > 0 and (DETAIL_GAP_S + more_w) or 0
        if shown > 0 and used + gap_w + pill_w + reserve_w > width then break end
        if shown > 0 then
            table.insert(row, HorizontalSpan:new{ width = DETAIL_GAP_S })
            used = used + DETAIL_GAP_S
        end
        table.insert(row, pill)
        used = used + pill_w
        shown = shown + 1
    end
    local remaining = #items - shown
    if remaining > 0 then
        local more = DetailPillWidget:new{
            text = T(_("+%1"), remaining),
            height = DETAIL_PILL_HEIGHT,
            max_width = max_pill_w,
            callback = function()
                self:showFullList(title, items)
            end,
        }
        if shown == 0 or used + DETAIL_GAP_S + more:getSize().w <= width then
            if shown > 0 then table.insert(row, HorizontalSpan:new{ width = DETAIL_GAP_S }) end
            table.insert(row, more)
            if more_button_key then self[more_button_key] = more end
        end
    end
    return row
end

function CatalogDetail:buildDetailPills(detail, width)
    return self:buildDetailPillRow(
        self:detailPillItems(detail),
        width,
        _("Genres & Tags"),
        "detail_more_pills_button")
end

-- Progress line with the read status as a tappable caption on the right:
-- glanceable and one tap to change, without competing with the action button.
function CatalogDetail:buildDetailProgress(detail, width)
    local label_face = Font:getFace("xx_smallinfofont", 12)
    self.detail_status_button = Button:new{
        text = (self:readStatusLabel(detail) or _("Unread")) .. " ▾",
        bordersize = 0,
        margin = 0,
        padding = 0,
        text_font_size = 13,
        callback = function()
            self:showSetStatusDialog(detail)
        end,
    }
    local status_w = self.detail_status_button:getSize().w
    local row = HorizontalGroup:new{ align = "center" }
    table.insert(row, TextBoxWidget:new{
        text = self:detailProgressText(detail) or _("Not started"),
        width = math.max(1, width - status_w - DETAIL_GAP_S),
        height = lineHeight(label_face),
        height_overflow_show_ellipsis = true,
        face = label_face,
    })
    table.insert(row, HorizontalSpan:new{ width = DETAIL_GAP_S })
    table.insert(row, self.detail_status_button)

    local col = VerticalGroup:new{ align = "left" }
    table.insert(col, row)
    table.insert(col, VerticalSpan:new{ width = DETAIL_GAP_XS })
    table.insert(col, CatalogWidgets.buildDetailProgressBar(
        detail.progressPercentage, width, DETAIL_PROGRESS_BAR_HEIGHT))
    return col
end

function CatalogDetail:buildDetailButtons(detail, width)
    local supported_files = self.current_context.supported_files or {}
    local read_path = self:detailReadPath(detail)

    if read_path then
        self.detail_read_button = Button:new{
            text = _("Read"),
            width = width,
            height = DETAIL_BUTTON_HEIGHT,
            text_font_size = 15,
            callback = function()
                self:openDownloadedFile(read_path)
            end,
        }
        return self.detail_read_button
    end
    self.detail_download_button = Button:new{
        text = self:downloadButtonLabel(supported_files),
        width = width,
        height = DETAIL_BUTTON_HEIGHT,
        enabled = #supported_files > 0,
        text_font_size = 15,
        callback = function()
            self:showDownloadOptions(detail)
        end,
    }
    return self.detail_download_button
end

-- The hero header: cover on the left, a measured text column on the right.
-- The column's info block hugs the cover's top edge and the action block
-- (progress + buttons) its bottom edge, with one flexible gap in between.
function CatalogDetail:buildDetailHeader(detail, width)
    local cover_w, cover_h = self:detailCoverDimensions()
    local text_w = math.max(1, width - 2 * DETAIL_INSET - cover_w - DETAIL_GAP_M)
    local path = self:cachedThumbnailPath(detail)
    local state = self:thumbnailState(detail)

    self.detail_status_button = nil
    self.detail_read_button = nil
    self.detail_download_button = nil
    self.detail_more_pills_button = nil

    local title_face = Font:getFace("cfont", 21)
    local top = VerticalGroup:new{ align = "left" }
    table.insert(top, TextBoxWidget:new{
        text = BD.auto(detail.title or _("Untitled")),
        width = text_w,
        height = 2 * lineHeight(title_face),
        height_adjust = true,
        height_overflow_show_ellipsis = true,
        bold = true,
        face = title_face,
    })
    table.insert(top, VerticalSpan:new{ width = DETAIL_GAP_XS })
    local author_face = Font:getFace("smallinfofont", 16)
    table.insert(top, TextBoxWidget:new{
        text = BD.auto(joinNames(detail.authors) or _("Unknown author")),
        width = text_w,
        height = lineHeight(author_face),
        height_overflow_show_ellipsis = true,
        face = author_face,
    })
    local meta_line = self:detailHeroMetaLine(detail)
    if meta_line then
        local meta_face = Font:getFace("x_smallinfofont", 13)
        table.insert(top, VerticalSpan:new{ width = DETAIL_GAP_XS })
        table.insert(top, TextBoxWidget:new{
            text = meta_line,
            width = text_w,
            height = lineHeight(meta_face),
            height_overflow_show_ellipsis = true,
            face = meta_face,
        })
    end
    table.insert(top, VerticalSpan:new{ width = DETAIL_GAP_S })
    table.insert(top, self:buildDetailRating(detail, text_w))
    local pills = self:buildDetailPills(detail, text_w)
    if pills then
        table.insert(top, VerticalSpan:new{ width = DETAIL_GAP_S })
        table.insert(top, pills)
    end

    local bottom = VerticalGroup:new{ align = "left" }
    table.insert(bottom, self:buildDetailProgress(detail, text_w))
    table.insert(bottom, VerticalSpan:new{ width = DETAIL_GAP_M })
    table.insert(bottom, self:buildDetailButtons(detail, text_w))

    local flex = math.max(DETAIL_GAP_M, cover_h - top:getSize().h - bottom:getSize().h)
    local right = VerticalGroup:new{ align = "left" }
    table.insert(right, top)
    table.insert(right, VerticalSpan:new{ width = flex })
    table.insert(right, bottom)

    return HorizontalGroup:new{
        align = "top",
        HorizontalSpan:new{ width = DETAIL_INSET },
        buildCoverWidget(detail, cover_w, cover_h, path, state),
        HorizontalSpan:new{ width = DETAIL_GAP_M },
        right,
        HorizontalSpan:new{ width = DETAIL_INSET },
    }
end

function CatalogDetail:buildDetailDescription(detail, width, max_height)
    return DetailDescriptionWidget:new{
        detail = detail,
        width = width,
        max_height = max_height,
        menu = self,
    }
end

function CatalogDetail:buildDetailOverview(detail, width, max_height)
    return DetailOverviewWidget:new{
        detail = detail,
        width = width,
        max_height = max_height,
        menu = self,
    }
end

-- Underline-style tabs on a shared baseline rule: no boxed borders, the
-- active tab gets a thick underline (drawn by DetailTabButton).
function CatalogDetail:buildDetailRelatedTabs(related, width, active_id)
    if #related == 0 then return nil, nil end

    local content_w = width - 2 * DETAIL_INSET
    local tab_w = math.floor(content_w / #related)
    local row = HorizontalGroup:new{}
    table.insert(row, HorizontalSpan:new{ width = DETAIL_INSET })
    local focus_row = {}
    for index, section in ipairs(related) do
        local cell_w = index < #related and tab_w or content_w - (#related - 1) * tab_w
        local button = BookOrbitDetailTabButton:new{
            entry = {
                text = self:detailRelatedTabLabel(section),
                section_id = section.id,
                selected = section.id == active_id,
            },
            dimen = Geom:new{ w = cell_w, h = DETAIL_TABS_HEIGHT },
            menu = self,
        }
        table.insert(row, button)
        table.insert(focus_row, button)
    end
    table.insert(row, HorizontalSpan:new{ width = DETAIL_INSET })

    local col = VerticalGroup:new{}
    table.insert(col, row)
    table.insert(col, HorizontalGroup:new{
        HorizontalSpan:new{ width = DETAIL_INSET },
        LineWidget:new{
            background = Blitbuffer.COLOR_GRAY,
            dimen = Geom:new{ w = content_w, h = Size.line.medium },
        },
        HorizontalSpan:new{ width = DETAIL_INSET },
    })
    return col, focus_row
end

-- One or two shelf rows of related covers. Tall screens use a second row only
-- when the measured shelf budget can fit it; compact e-ink layouts keep the
-- original single-row carousel.
function CatalogDetail:buildDetailRelatedSection(section, width, height)
    local books = type(section.books) == "table" and section.books or {}
    if #books == 0 then
        local face = Font:getFace("x_smallinfofont", 13)
        return HorizontalGroup:new{
            HorizontalSpan:new{ width = DETAIL_INSET },
            TextBoxWidget:new{
                text = _("No books in this section"),
                width = width - 2 * DETAIL_INSET,
                height = lineHeight(face),
                face = face,
            },
            HorizontalSpan:new{ width = DETAIL_INSET },
        }, {}
    end

    local content_w = width - 2 * DETAIL_RELATED_SHELF_INSET
    local gap = Screen:scaleBySize(10)
    local nav_w = Screen:scaleBySize(20)
    local nav_gap = Screen:scaleBySize(4)
    local nav_gutter_w = nav_w + nav_gap
    local slots = 4

    local rows = 1
    if self:detailTallLayout() then
        local book_rows = math.ceil(#books / slots)
        rows = math.min(DETAIL_RELATED_MAX_ROWS, math.max(1, book_rows))
    end

    local function metrics(row_count)
        local page_size = slots * row_count
        local has_nav = #books > page_size
        local covers_w = math.max(1, content_w - 2 * nav_gutter_w)
        local card_w = math.floor((covers_w - (slots - 1) * gap) / slots)
        local card_h = CatalogWidgets.detailRelatedCardHeight(card_w)
        return {
            rows = row_count,
            page_size = page_size,
            has_nav = has_nav,
            card_w = card_w,
            card_h = card_h,
            total_h = row_count * card_h + math.max(0, row_count - 1) * gap,
        }
    end

    local layout = metrics(rows)
    while layout.rows > 1 and layout.total_h > height do
        layout = metrics(layout.rows - 1)
    end

    local page_count = math.max(1, math.ceil(#books / layout.page_size))
    local section_id = section.id or tostring(section.title or "related")
    local page = self:detailRelatedPage(section_id, page_count)
    local first = (page - 1) * layout.page_size + 1

    local focus_rows = { is_grid = true }
    local row = HorizontalGroup:new{ align = "center" }
    local prev_button
    local next_button
    if layout.has_nav then
        prev_button = Button:new{
            icon = "chevron.left",
            icon_width = Screen:scaleBySize(16),
            icon_height = Screen:scaleBySize(16),
            width = nav_w,
            bordersize = 0,
            show_border = false,
            enabled = page > 1,
            callback = function()
                self:turnDetailRelatedPage(section_id, -1)
            end,
        }
        table.insert(row, CenterContainer:new{
            dimen = Geom:new{ w = nav_w, h = layout.total_h },
            prev_button,
        })
        table.insert(row, HorizontalSpan:new{ width = nav_gap })
    else
        table.insert(row, HorizontalSpan:new{ width = nav_gutter_w })
    end

    local grid = VerticalGroup:new{ align = "left" }
    for row_index = 1, layout.rows do
        local visual_row = HorizontalGroup:new{ align = "center" }
        local focus_row = {}
        local row_first = first + (row_index - 1) * slots
        for slot = 1, slots do
            if slot > 1 then
                table.insert(visual_row, HorizontalSpan:new{ width = gap })
            end
            local book = books[row_first + slot - 1]
            if book then
                local card = BookOrbitDetailRelatedCard:new{
                    entry = {
                        text = coverLabel(book),
                        kind = "dashboard-book",
                        book_id = book.id,
                        book = book,
                    },
                    dimen = Geom:new{ w = layout.card_w, h = layout.card_h },
                    menu = self,
                }
                table.insert(visual_row, card)
                table.insert(focus_row, card)
            else
                table.insert(visual_row, HorizontalSpan:new{ width = layout.card_w })
            end
        end
        if row_index > 1 then
            table.insert(grid, VerticalSpan:new{ width = gap })
        end
        table.insert(grid, visual_row)
        table.insert(focus_rows, focus_row)
    end
    table.insert(row, grid)

    if layout.has_nav then
        table.insert(row, HorizontalSpan:new{ width = nav_gap })
        next_button = Button:new{
            icon = "chevron.right",
            icon_width = Screen:scaleBySize(16),
            icon_height = Screen:scaleBySize(16),
            width = nav_w,
            bordersize = 0,
            show_border = false,
            enabled = page < page_count,
            callback = function()
                self:turnDetailRelatedPage(section_id, 1)
            end,
        }
        table.insert(row, CenterContainer:new{
            dimen = Geom:new{ w = nav_w, h = layout.total_h },
            next_button,
        })
        table.insert(focus_rows[1], 1, prev_button)
        table.insert(focus_rows[1], next_button)
    else
        table.insert(row, HorizontalSpan:new{ width = nav_gutter_w })
    end

    return HorizontalGroup:new{
        HorizontalSpan:new{ width = DETAIL_RELATED_SHELF_INSET },
        LeftContainer:new{
            dimen = Geom:new{ w = content_w, h = layout.total_h },
            row,
        },
        HorizontalSpan:new{ width = DETAIL_RELATED_SHELF_INSET },
    }, focus_rows
end

function CatalogDetail:updateDetailItems(select_number, no_recalculate_dimen)
    local old_dimen = self:prepareCustomUpdate(no_recalculate_dimen)
    local detail = self.current_context.detail
    local related = {}
    for _, section in ipairs(self:orderedDetailRelatedSections(self:detailRelatedSections(detail))) do
        if type(section.books) == "table" and #section.books > 0 then
            table.insert(related, section)
        end
    end
    local active_related = self:activeDetailRelatedSection(related)
    local width = self.inner_dimen.w

    table.insert(self.item_group, VerticalSpan:new{ width = DETAIL_GAP_S })
    local header = self:buildDetailHeader(detail, width)
    table.insert(self.item_group, header)
    local used = DETAIL_GAP_S + header:getSize().h

    local focus_row = {}
    for _, star in ipairs(self.detail_rating_stars or {}) do
        table.insert(focus_row, star)
    end
    if self.detail_more_pills_button then
        table.insert(focus_row, self.detail_more_pills_button)
    end
    if self.detail_status_button then table.insert(focus_row, self.detail_status_button) end
    if self.detail_read_button then table.insert(focus_row, self.detail_read_button) end
    if self.detail_download_button then table.insert(focus_row, self.detail_download_button) end
    self.layout = { focus_row }

    if active_related then
        local desc_max = DETAIL_DESCRIPTION_HEIGHT
        if desc_max >= Screen:scaleBySize(40) then
            local description = self:buildDetailDescription(detail, width, desc_max)
            table.insert(self.item_group, VerticalSpan:new{ width = DETAIL_GAP_M })
            table.insert(self.item_group, description)
            if cleanDescriptionText(detail.description) then
                table.insert(self.layout, { description })
            end
            used = used + DETAIL_GAP_M + description:getSize().h
        end

        local tabs, tab_focus = self:buildDetailRelatedTabs(related, width, active_related.id)
        if tabs then
            table.insert(self.item_group, VerticalSpan:new{ width = DETAIL_GAP_M })
            table.insert(self.item_group, tabs)
            if tab_focus and #tab_focus > 0 then
                table.insert(self.layout, tab_focus)
            end
            used = used + DETAIL_GAP_M + tabs:getSize().h
        end

        local shelf_h = self.available_height - used - 2 * DETAIL_GAP_M
        if shelf_h >= Screen:scaleBySize(80) then
            table.insert(self.item_group, VerticalSpan:new{ width = DETAIL_GAP_M })
            local widget, section_focus = self:buildDetailRelatedSection(active_related, width, shelf_h)
            if widget then
                table.insert(self.item_group, widget)
                if section_focus and #section_focus > 0 then
                    if section_focus.is_grid then
                        for _, row in ipairs(section_focus) do
                            if #row > 0 then table.insert(self.layout, row) end
                        end
                    else
                        table.insert(self.layout, section_focus)
                    end
                end
            end
        end
    else
        local overview_h = self.available_height - used - 2 * DETAIL_GAP_M
        if overview_h >= Screen:scaleBySize(40) then
            local overview = self:buildDetailOverview(detail, width, overview_h)
            table.insert(self.item_group, VerticalSpan:new{ width = DETAIL_GAP_M })
            table.insert(self.item_group, overview)
            if cleanDescriptionText(detail.description) then
                table.insert(self.layout, { overview })
            end
        end
    end

    self:finishCustomUpdate(old_dimen, select_number)
end

function CatalogDetail.install(Catalog)
    for name, fn in pairs(CatalogDetail) do
        if name ~= "install" then
            Catalog[name] = fn
        end
    end
end

return CatalogDetail
