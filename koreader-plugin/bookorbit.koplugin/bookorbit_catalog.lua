--[[--
Native BookOrbit catalog browser.

Uses BookOrbit's KOReader-authenticated JSON catalog endpoints. Book result
pages render as KOReader-style menu pages with a cover mosaic and progressive
thumbnail loading.
]]

local BD = require("ui/bidi")
local Blitbuffer = require("ffi/blitbuffer")
local Button = require("ui/widget/button")
local ButtonDialog = require("ui/widget/buttondialog")
local CenterContainer = require("ui/widget/container/centercontainer")
local ConfirmBox = require("ui/widget/confirmbox")
local DataStorage = require("datastorage")
local Device = require("device")
local DocumentRegistry = require("document/documentregistry")
local Font = require("ui/font")
local FrameContainer = require("ui/widget/container/framecontainer")
local Geom = require("ui/geometry")
local GestureRange = require("ui/gesturerange")
local HorizontalGroup = require("ui/widget/horizontalgroup")
local HorizontalSpan = require("ui/widget/horizontalspan")
local ImageWidget = require("ui/widget/imagewidget")
local InfoMessage = require("ui/widget/infomessage")
local InputContainer = require("ui/widget/container/inputcontainer")
local InputDialog = require("ui/widget/inputdialog")
local Menu = require("ui/widget/menu")
local NetworkMgr = require("ui/network/manager")
local Notification = require("ui/widget/notification")
local Size = require("ui/size")
local TextBoxWidget = require("ui/widget/textboxwidget")
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

local PAGE_SIZE = 9
local GRID_COLUMNS = 3
local GRID_ROWS = 3
local GRID_ITEMS = GRID_COLUMNS * GRID_ROWS
local THUMBNAIL_BATCH_SIZE = 2
local Screen = Device.screen

local SORTS = {
    { id = "title", text = _("Title") },
    { id = "author", text = _("Author") },
    { id = "recently_added", text = _("Recently added") },
    { id = "recently_updated", text = _("Recently updated") },
    { id = "series", text = _("Series order") },
}

local BookOrbitCatalog = Menu:extend{
    title = _("BookOrbit"),
    title_shrink_font_to_fit = true,
    title_bar_left_icon = "appbar.menu",
}

local Menu_recalculateDimen = Menu._recalculateDimen
local Menu_updateItems = Menu.updateItems
local Menu_onGotoPage = Menu.onGotoPage
local Menu_onNextPage = Menu.onNextPage
local Menu_onPrevPage = Menu.onPrevPage
local Menu_onFirstPage = Menu.onFirstPage
local Menu_onLastPage = Menu.onLastPage

local firstAuthor

local function isAuthError(err)
    return err == 401 or err == 403
end

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

local function cloneParams(params)
    local copy = {}
    for key, value in pairs(params or {}) do
        copy[key] = value
    end
    return copy
end

local function formatBytes(bytes)
    if not bytes then return "" end
    if bytes >= 1024 * 1024 then
        return string.format("%.1f MB", bytes / 1024 / 1024)
    elseif bytes >= 1024 then
        return string.format("%.0f KB", bytes / 1024)
    end
    return tostring(bytes) .. " B"
end

local function formatDuration(seconds)
    if not seconds then return nil end
    local minutes = math.floor(seconds / 60 + 0.5)
    if minutes < 60 then
        return T(_("%1 min"), minutes)
    end
    local hours = math.floor(minutes / 60)
    local remaining = minutes - hours * 60
    if remaining == 0 then
        return T(_("%1 h"), hours)
    end
    return T(_("%1 h %2 min"), hours, remaining)
end

local function formatProgress(value)
    if not value then return nil end
    return tostring(math.floor(value + 0.5)) .. "%"
end

local function formatRating(value)
    if not value then return nil end
    if value == math.floor(value) then
        return tostring(value) .. "/5"
    end
    return string.format("%.1f/5", value)
end

local function isSupportedFormat(format)
    return format and DocumentRegistry:hasProvider("dummy." .. string.lower(format))
end

local function shortText(text, max_len)
    text = tostring(text or "")
    if #text <= max_len then return text end
    return util.fixUtf8(text:sub(1, max_len - 3), "?") .. "..."
end

local function joinNames(items, key)
    local names = {}
    for _, item in ipairs(items or {}) do
        table.insert(names, key and item[key] or item)
    end
    return #names > 0 and table.concat(names, ", ") or nil
end

local HTML_ENTITIES = {
    amp = "&",
    apos = "'",
    bull = "*",
    eacute = "e",
    hellip = "...",
    ldquo = "\"",
    lsquo = "'",
    lt = "<",
    mdash = " - ",
    nbsp = " ",
    ndash = " - ",
    quot = "\"",
    rdquo = "\"",
    gt = ">",
    rsquo = "'",
}

local NUMERIC_ENTITIES = {
    [160] = " ",
    [8211] = " - ",
    [8212] = " - ",
    [8216] = "'",
    [8217] = "'",
    [8220] = "\"",
    [8221] = "\"",
    [8226] = "*",
    [8230] = "...",
}

local function decodeHtmlEntity(entity)
    local named = HTML_ENTITIES[entity:lower()]
    if named then return named end

    local code = entity:match("^#(%d+)$")
    if code then
        code = tonumber(code)
    else
        local hex_code = entity:match("^#x(%x+)$") or entity:match("^#X(%x+)$")
        code = hex_code and tonumber(hex_code, 16) or nil
    end
    if not code then return "&" .. entity .. ";" end

    local replacement = NUMERIC_ENTITIES[code]
    if replacement then return replacement end
    if code >= 32 and code <= 126 then
        return string.char(code)
    end
    return ""
end

local function decodeHtmlEntities(text)
    return text:gsub("&(#?[xX]?%w+);", decodeHtmlEntity)
end

local function cleanInlineText(text)
    text = tostring(text or "")
    text = text:gsub("%s+", " "):gsub("^%s+", ""):gsub("%s+$", "")
    return text ~= "" and text or nil
end

local function cleanDescriptionText(text)
    text = tostring(text or "")
    text = decodeHtmlEntities(text)
    text = text:gsub("\r\n", "\n"):gsub("\r", "\n")
    text = text:gsub("<%s*[Bb][Rr]%s*/?%s*>", "\n")
    text = text:gsub("<%s*/%s*[Pp]%s*>", "\n\n")
    text = text:gsub("<%s*[Pp][^>]*>", "")
    text = text:gsub("<%s*/%s*[Dd][Ii][Vv]%s*>", "\n\n")
    text = text:gsub("<%s*[Dd][Ii][Vv][^>]*>", "")
    text = text:gsub("<%s*/%s*[Ll][Ii]%s*>", "\n")
    text = text:gsub("<%s*[Ll][Ii][^>]*>", "* ")
    text = text:gsub("<[^>]+>", "")
    text = decodeHtmlEntities(text)
    text = text:gsub("[ \t]+", " ")
    text = text:gsub(" *\n *", "\n")
    text = text:gsub("\n\n\n+", "\n\n")
    text = text:gsub("^%s+", ""):gsub("%s+$", "")
    return text ~= "" and text or nil
end

local function formatSeries(book)
    if not book.seriesName then return nil end
    if book.seriesIndex then
        return book.seriesName .. " #" .. tostring(book.seriesIndex)
    end
    return book.seriesName
end

function firstAuthor(book)
    return book.authors and book.authors[1] or nil
end

local function safeFilenameBase(detail)
    local title = detail.title or ("book-" .. tostring(detail.id))
    local author = firstAuthor(detail)
    local base = author and (title .. " - " .. author) or title
    base = base:gsub("[\"\\/:*?<>|]+", " "):gsub("%s+", " "):gsub("^%s+", ""):gsub("%s+$", "")
    if base == "" then base = "book-" .. tostring(detail.id) end
    return base
end

local function coverLabel(book)
    local lines = {}
    local title = book and book.title or _("Untitled")
    table.insert(lines, shortText(title, 34))
    local author = book and firstAuthor(book)
    if author then
        table.insert(lines, shortText(author, 28))
    end
    return table.concat(lines, "\n")
end

local function bookCellLabel(book)
    local parts = { shortText(book.title or _("Untitled"), 30) }
    local author = firstAuthor(book)
    if author then
        table.insert(parts, shortText(author, 24))
    end
    local progress = formatProgress(book.progressPercentage)
    if progress then
        table.insert(parts, progress)
    elseif book.formats and book.formats[1] then
        table.insert(parts, table.concat(book.formats, ", "))
    end
    return table.concat(parts, "\n")
end

local function buildFakeCover(book, width, height, footer)
    local inner_w = math.max(1, width - 2 * Size.padding.default - 2 * Size.border.thin)
    local inner_h = math.max(1, height - 2 * Size.padding.default - 2 * Size.border.thin)
    local title_h = math.floor(inner_h * 0.58)
    local author_h = math.floor(inner_h * 0.22)
    local footer_h = math.max(1, inner_h - title_h - author_h)
    local author = book and firstAuthor(book) or nil

    local content = VerticalGroup:new{ align = "center" }
    table.insert(content, VerticalSpan:new{ width = Size.span.vertical_default })
    table.insert(content, TextBoxWidget:new{
        text = BD.auto(shortText(book and book.title or _("Untitled"), 60)),
        width = inner_w,
        height = title_h,
        alignment = "center",
        face = Font:getFace("smallinfofont", 16),
        height_overflow_show_ellipsis = true,
    })
    table.insert(content, TextBoxWidget:new{
        text = author and BD.auto(shortText(author, 44)) or "",
        width = inner_w,
        height = author_h,
        alignment = "center",
        face = Font:getFace("x_smallinfofont"),
        height_overflow_show_ellipsis = true,
    })
    table.insert(content, TextBoxWidget:new{
        text = footer or "",
        width = inner_w,
        height = footer_h,
        alignment = "center",
        face = Font:getFace("xx_smallinfofont"),
        height_overflow_show_ellipsis = true,
    })

    return FrameContainer:new{
        width = width,
        height = height,
        margin = 0,
        padding = Size.padding.default,
        bordersize = Size.border.thin,
        background = Blitbuffer.COLOR_WHITE,
        CenterContainer:new{
            dimen = Geom:new{ w = inner_w, h = inner_h },
            content,
        },
    }
end

local function buildCoverWidget(book, width, height, path, state)
    if path then
        return CenterContainer:new{
            dimen = Geom:new{ w = width, h = height },
            FrameContainer:new{
                margin = 0,
                padding = 0,
                bordersize = Size.border.thin,
                ImageWidget:new{
                    file = path,
                    width = width,
                    height = height,
                    scale_factor = 0,
                },
            },
        }
    end

    local footer
    if state == "loading" then
        footer = _("Loading cover")
    elseif state == "failed" then
        footer = _("Cover unavailable")
    else
        footer = _("No cover")
    end
    return buildFakeCover(book, width, height, footer)
end

local BookOrbitMosaicItem = InputContainer:extend{
    entry = nil,
    dimen = nil,
    menu = nil,
    text = nil,
}

function BookOrbitMosaicItem:init()
    self.ges_events = {
        TapSelect = {
            GestureRange:new{
                ges = "tap",
                range = self.dimen,
            },
        },
        HoldSelect = {
            GestureRange:new{
                ges = "hold",
                range = self.dimen,
            },
        },
    }

    local book = self.entry.book
    local label_h = math.max(Screen:scaleBySize(44), math.floor(self.dimen.h * 0.24))
    local cover_h = math.max(Screen:scaleBySize(72), self.dimen.h - label_h - Size.span.vertical_default)
    local cover_w = math.min(self.dimen.w - 2 * Size.padding.default, math.floor(cover_h * 0.68))
    cover_h = math.min(cover_h, self.dimen.h - label_h - Size.span.vertical_default)

    local path = self.menu:cachedThumbnailPath(book)
    local state = self.menu:thumbnailState(book)
    local content = VerticalGroup:new{ align = "center" }
    table.insert(content, buildCoverWidget(book, cover_w, cover_h, path, state))
    table.insert(content, VerticalSpan:new{ width = Size.span.vertical_default })
    table.insert(content, TextBoxWidget:new{
        text = bookCellLabel(book),
        width = self.dimen.w - 2 * Size.padding.tiny,
        height = label_h,
        alignment = "center",
        face = Font:getFace("x_smallinfofont"),
        height_overflow_show_ellipsis = true,
    })

    self[1] = CenterContainer:new{
        dimen = Geom:new{ w = self.dimen.w, h = self.dimen.h },
        content,
    }
end

function BookOrbitMosaicItem:onTapSelect()
    self.menu:onMenuSelect(self.entry)
    return true
end

function BookOrbitMosaicItem:onHoldSelect()
    self.menu:onMenuSelect(self.entry)
    return true
end

function BookOrbitCatalog:init()
    self.client = BookOrbitApi.new(self.api)
    self.stack = {}
    self.thumbnail_cache_dir = DataStorage:getDataDir() .. "/cache/bookorbit"
    self.thumbnail_generation = 0
    self.thumbnail_failures = {}
    self.current_context = { kind = "root", title = self.title }
    self.item_table = self:rootItems()
    self.is_borderless = true
    self.title_bar_fm_style = true
    Menu.init(self)
    self.paths = self.stack
end

function BookOrbitCatalog:rootItems()
    local body, err = self.client:catalogRoot()
    if not body then
        showError(err)
        return {}
    end

    local items = {}
    for _, section in ipairs(body.sections or {}) do
        if section.section == "search" then
            table.insert(items, {
                text = section.title,
                kind = "search",
                params = {},
            })
        elseif section.section == "recent" then
            table.insert(items, {
                text = section.title,
                kind = "books",
                params = { sort = "recently_added" },
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
    if context.kind == "books" then
        self:scheduleThumbnailDownloads(context.books or {})
    elseif context.kind == "detail" then
        self:scheduleThumbnailDownloads({ context.detail })
    end
end

function BookOrbitCatalog:loadSection(section)
    NetworkMgr:runWhenConnected(function()
        local body, err = self.client:catalogSection(section)
        if not body then
            showError(err)
            return
        end

        local item_table = {}
        for _, entry in ipairs(body.items or {}) do
            local params = self:paramsForEntry(section, entry)
            table.insert(item_table, {
                text = entry.title,
                mandatory = entry.count and tostring(entry.count) or nil,
                kind = "books",
                params = params,
            })
        end

        if #item_table == 0 then
            table.insert(item_table, { text = _("No entries"), enabled = false })
        end
        local title = self:titleForSection(section)
        self:switchTo(title, item_table, { kind = "section", title = title, section = section }, true)
    end)
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
    NetworkMgr:runWhenConnected(function()
        local query = cloneParams(params)
        query.page = query.page or 1
        query.size = query.size or PAGE_SIZE
        query.sort = query.sort or "recently_added"

        local body, err = self.client:catalogBooks(query)
        if not body then
            showError(err)
            return
        end

        self:showBookPage(body, query, title or _("Books"), push ~= false)
    end)
end

function BookOrbitCatalog:scopeParams(query)
    local params = cloneParams(query)
    params.page = nil
    params.size = nil
    params.q = nil
    return params
end

function BookOrbitCatalog:promptSearch(params)
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
                    text = _("Search"),
                    is_enter_default = true,
                    callback = function()
                        local q = util.trim(dialog:getInputText() or "")
                        if q == "" then return end
                        UIManager:close(dialog)
                        local query = cloneParams(params)
                        query.q = q
                        query.page = 1
                        query.sort = query.sort or "title"
                        self:loadBooks(query, T(_("Search: %1"), q), true)
                    end,
                },
            },
        },
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

function BookOrbitCatalog:showBookPage(body, query, title, push)
    local items = body.items or {}
    local page = body.page or query.page or 1
    local size = body.size or query.size or PAGE_SIZE
    local total = body.total or 0
    local page_count = math.max(1, math.ceil(total / size))
    local subtitle = total > 0
        and T(_("%1 books - Sort: %2"), total, self:sortLabel(query.sort))
        or T(_("Sort: %1"), self:sortLabel(query.sort))
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
end

function BookOrbitCatalog:thumbnailPath(book)
    if not book or not book.hasCover then return nil end
    if not util.makePath(self.thumbnail_cache_dir) then return nil end
    return self.thumbnail_cache_dir .. "/" .. tostring(book.id) .. ".jpg"
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
            end
        end
    end

    UIManager:scheduleIn(0.15, step)
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
                    params.page = 1
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

function BookOrbitCatalog:sortLabel(sort_id)
    for _, sort in ipairs(SORTS) do
        if sort.id == sort_id then return sort.text end
    end
    return _("Recently added")
end

function BookOrbitCatalog:showBookActions()
    local context = self.current_context or {}
    local params = context.kind == "books" and self:scopeParams(context.params or {}) or {}
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
            },
            {
                {
                    text = context.kind == "books"
                        and T(_("Sort: %1"), self:sortLabel((context.params or {}).sort))
                        or _("Sort books"),
                    enabled = context.kind == "books",
                    callback = function()
                        UIManager:close(dialog)
                        self:showSortDialog({
                            params = params,
                            current_sort = (context.params or {}).sort,
                            title = context.title,
                        })
                    end,
                },
            },
        },
    }
    UIManager:show(dialog)
end

function BookOrbitCatalog:onLeftButtonTap()
    self:showBookActions()
    return true
end

function BookOrbitCatalog:loadBookDetail(book_id)
    NetworkMgr:runWhenConnected(function()
        local detail, err = self.client:catalogBook(book_id)
        if not detail then
            showError(err)
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
    add(_("Rating"), formatRating(detail.rating))
    add(_("ISBN"), detail.isbn13 or detail.isbn10)
    add(_("Progress"), formatProgress(detail.progressPercentage))
    add(_("Status"), detail.readStatus)
    add(_("Library"), detail.libraryName)
    add(#(detail.files or {}) == 1 and _("File") or _("Files"), self:fileMetadataValue(detail))
    return lines
end

function BookOrbitCatalog:detailOverviewLines(detail)
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

function BookOrbitCatalog:showBookDetail(detail)
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

function BookOrbitCatalog:showFileChoices(detail)
    local files = self:supportedFiles(detail)

    if #files == 0 then
        UIManager:show(InfoMessage:new{ text = _("No KOReader-supported file found."), timeout = 3 })
        return
    end
    if #files == 1 then
        self:showDownloadDialog(detail, files[1])
        return
    end

    local dialog
    local buttons = {}
    for _, file in ipairs(files) do
        table.insert(buttons, {
            {
                text = self:fileLabel(file, false),
                callback = function()
                    UIManager:close(dialog)
                    self:showDownloadDialog(detail, file)
                end,
            },
        })
    end
    dialog = ButtonDialog:new{
        title = _("Choose file"),
        buttons = buttons,
    }
    UIManager:show(dialog)
end

function BookOrbitCatalog:getCurrentDownloadDir()
    return G_reader_settings:readSetting("download_dir") or G_reader_settings:readSetting("lastdir")
end

function BookOrbitCatalog:getLocalDownloadPath(filename, filetype)
    local download_dir = self:getCurrentDownloadDir()
    filename = filename .. "." .. string.lower(filetype or "bin")
    filename = util.getSafeFilename(filename, download_dir)
    return (download_dir ~= "/" and download_dir or "") .. "/" .. filename
end

function BookOrbitCatalog:showDownloadDialog(detail, file)
    local filename = safeFilenameBase(detail)
    local filetype = string.lower(file.format or "bin")

    local function createTitle(path, name)
        return T(_("Download folder:\n%1\n\nDownload filename:\n%2\n\nDownload file type:\n%3"),
            BD.dirpath(path), name, string.upper(filetype))
    end

    local dialog
    dialog = ButtonDialog:new{
        title = createTitle(self:getCurrentDownloadDir(), filename),
        buttons = {
            {
                {
                    text = _("Download"),
                    callback = function()
                        UIManager:close(dialog)
                        local local_path = self:getLocalDownloadPath(filename, filetype)
                        self:checkDownloadFile(local_path, detail, file)
                    end,
                },
            },
            {},
            {
                {
                    text = _("Choose folder"),
                    callback = function()
                        require("ui/downloadmgr"):new{
                            onConfirm = function(path)
                                logger.dbg("BookOrbit: download folder set to", path)
                                if self._manager and self._manager.ui and self._manager.ui.folder_shortcuts then
                                    self._manager.ui.folder_shortcuts:updateShortcut("download_dir", path)
                                end
                                G_reader_settings:saveSetting("download_dir", path)
                                dialog:setTitle(createTitle(path, filename))
                            end,
                        }:chooseDir(self:getCurrentDownloadDir())
                    end,
                },
                {
                    text = _("Change filename"),
                    callback = function()
                        local input_dialog
                        input_dialog = InputDialog:new{
                            title = _("Enter filename"),
                            input = filename,
                            buttons = {
                                {
                                    {
                                        text = _("Cancel"),
                                        id = "close",
                                        callback = function()
                                            UIManager:close(input_dialog)
                                        end,
                                    },
                                    {
                                        text = _("Set filename"),
                                        is_enter_default = true,
                                        callback = function()
                                            local value = util.trim(input_dialog:getInputText() or "")
                                            if value ~= "" then filename = value end
                                            UIManager:close(input_dialog)
                                            dialog:setTitle(createTitle(self:getCurrentDownloadDir(), filename))
                                        end,
                                    },
                                },
                            },
                        }
                        UIManager:show(input_dialog)
                        input_dialog:onShowKeyboard()
                    end,
                },
            },
        },
    }
    UIManager:show(dialog)
end

function BookOrbitCatalog:checkDownloadFile(local_path, detail, file)
    local function download()
        UIManager:show(InfoMessage:new{ text = _("Downloading..."), timeout = 1 })
        UIManager:scheduleIn(1, function()
            self:downloadFile(local_path, detail, file)
        end)
    end

    if lfs.attributes(local_path) then
        UIManager:show(ConfirmBox:new{
            text = T(_("The file %1 already exists. Do you want to overwrite it?"), BD.filepath(local_path)),
            ok_text = _("Overwrite"),
            ok_callback = download,
        })
    else
        download()
    end
end

function BookOrbitCatalog:downloadFile(local_path, detail, file)
    local ok, err = self.client:downloadCatalogFile(file.id, local_path)
    if not ok then
        showError(err)
        return
    end

    local linked = self:linkDownloadedFile(local_path)
    self:showDownloadedDialog(local_path, linked)
end

function BookOrbitCatalog:linkDownloadedFile(local_path)
    local ok, digest = pcall(util.partialMD5, local_path)
    if not ok or not digest then
        logger.warn("BookOrbit: downloaded file partial MD5 failed", local_path)
        return false
    end

    local body, err = self.client:matchCheck({ digest })
    if not body then
        logger.warn("BookOrbit: downloaded file match-check failed", err)
        return false
    end

    local state = BookOrbitState.open()
    state:rememberFile(local_path, digest)
    for _, match in ipairs(body.matches or {}) do
        if match.hash == digest then
            state:setMatched(digest, match.bookFileId, match.bookId, local_path)
            state:flush()
            return true
        end
    end
    state:setUnmatched(digest)
    state:flush()
    return false
end

function BookOrbitCatalog:showDownloadedDialog(local_path, linked)
    local message = linked and _("File saved and linked to BookOrbit sync:\n%1\n\nOpen now?")
        or _("File saved:\n%1\n\nOpen now?")
    UIManager:nextTick(function()
        UIManager:show(ConfirmBox:new{
            text = T(message, BD.filepath(local_path)),
            ok_text = _("Open now"),
            cancel_text = _("Close"),
            ok_callback = function()
                self:openDownloadedFile(local_path)
            end,
        })
    end)
end

function BookOrbitCatalog:openDownloadedFile(local_path)
    if self.close_callback then
        self.close_callback()
    else
        UIManager:close(self)
    end
    if self._manager and self._manager.ui then
        if self._manager.ui.document then
            self._manager.ui:switchDocument(local_path)
        else
            self._manager.ui:openFile(local_path)
        end
    else
        Notification:notify(T(_("Downloaded to %1"), local_path))
    end
end

function BookOrbitCatalog:bookMode()
    return self.current_context and self.current_context.kind == "books"
end

function BookOrbitCatalog:detailMode()
    return self.current_context and self.current_context.kind == "detail"
end

function BookOrbitCatalog:_recalculateDimen(no_recalculate_dimen)
    if self:bookMode() then
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
    self.perpage = GRID_ITEMS
    self.page = self.current_context.page or 1
    self.page_num = self.current_context.page_count or 1
    local top_height, bottom_height = self:menuChromeHeight()
    self.available_height = self.inner_dimen.h - top_height - bottom_height
    self.item_margin = Screen:scaleBySize(10)
    self.item_height = math.floor((self.available_height - (GRID_ROWS + 1) * self.item_margin) / GRID_ROWS)
    self.item_width = math.floor((self.inner_dimen.w - (GRID_COLUMNS + 1) * self.item_margin) / GRID_COLUMNS)
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
                text = _("No books"),
                width = self.inner_dimen.w - 2 * Size.padding.large,
                alignment = "center",
                face = Font:getFace("infofont"),
            },
        })
        self:finishCustomUpdate(old_dimen, selected_number)
        return
    end

    for row = 1, GRID_ROWS do
        local line_layout = {}
        table.insert(self.item_group, VerticalSpan:new{ width = self.item_margin })
        local row_group = HorizontalGroup:new{}
        table.insert(row_group, HorizontalSpan:new{ width = self.item_margin })
        for col = 1, GRID_COLUMNS do
            local slot = (row - 1) * GRID_COLUMNS + col
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

    self.detail_download_button = Button:new{
        text = _("Download"),
        width = button_w,
        height = button_h,
        enabled = #supported_files > 0,
        text_font_size = 16,
        callback = function()
            self:showFileChoices(detail)
        end,
    }

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
    table.insert(right, HorizontalGroup:new{
        self.detail_download_button,
    })

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
    self.layout = {
        { self.detail_download_button },
    }
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
    elseif item.kind == "books" then
        self:loadBooks(item.params or {}, item.list_title or item.text)
    elseif item.kind == "book" then
        self:loadBookDetail(item.book_id)
    elseif item.kind == "search" then
        self:promptSearch(item.params or {})
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
    return true
end

function BookOrbitCatalog:onHoldReturn()
    self:cancelThumbnailJobs()
    self.stack = {}
    self:updateReturnPath()
    self.item_table = self:rootItems()
    self.current_context = { kind = "root", title = self.title }
    self:switchItemTable(self.title, self.item_table, nil, nil, "")
    return true
end

function BookOrbitCatalog:onCloseWidget()
    self:cancelThumbnailJobs()
    return Menu.onCloseWidget(self)
end

return BookOrbitCatalog
