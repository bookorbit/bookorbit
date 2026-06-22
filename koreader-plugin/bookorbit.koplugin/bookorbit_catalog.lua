--[[--
Native BookOrbit catalog browser.

Uses BookOrbit's KOReader-authenticated JSON catalog endpoints. The list UI is
text-first so it remains usable on devices where cover downloads fail.
]]

local BD = require("ui/bidi")
local ButtonDialog = require("ui/widget/buttondialog")
local CenterContainer = require("ui/widget/container/centercontainer")
local ConfirmBox = require("ui/widget/confirmbox")
local DataStorage = require("datastorage")
local Device = require("device")
local DocumentRegistry = require("document/documentregistry")
local FrameContainer = require("ui/widget/container/framecontainer")
local Geom = require("ui/geometry")
local ImageWidget = require("ui/widget/imagewidget")
local InfoMessage = require("ui/widget/infomessage")
local InputDialog = require("ui/widget/inputdialog")
local Menu = require("ui/widget/menu")
local NetworkMgr = require("ui/network/manager")
local Notification = require("ui/widget/notification")
local Size = require("ui/size")
local TextViewer = require("ui/widget/textviewer")
local UIManager = require("ui/uimanager")
local lfs = require("libs/libkoreader-lfs")
local logger = require("logger")
local util = require("util")
local T = require("ffi/util").template
local _ = require("gettext")

local BookOrbitApi = require("bookorbit_api")
local BookOrbitState = require("bookorbit_state")

local PAGE_SIZE = 20
local Screen = Device.screen
local THUMBNAIL_WIDTH = Screen:scaleBySize(30)
local THUMBNAIL_HEIGHT = Screen:scaleBySize(44)
local THUMBNAIL_SLOT_WIDTH = THUMBNAIL_WIDTH + Size.span.horizontal_default

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
}

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

local function tableSize(items)
    local count = 0
    for _ in pairs(items or {}) do
        count = count + 1
    end
    return count
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

local function formatProgress(value)
    if not value then return nil end
    return tostring(math.floor(value + 0.5)) .. "%"
end

local function isSupportedFormat(format)
    return format and DocumentRegistry:hasProvider("dummy." .. string.lower(format))
end

local function formatSeries(book)
    if not book.seriesName then return nil end
    if book.seriesIndex then
        return book.seriesName .. " #" .. tostring(book.seriesIndex)
    end
    return book.seriesName
end

local function firstAuthor(book)
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

function BookOrbitCatalog:init()
    self.client = BookOrbitApi.new(self.api)
    self.stack = {}
    self.thumbnail_cache_dir = DataStorage:getDataDir() .. "/cache/bookorbit"
    self.current_context = { kind = "root", title = self.title }
    self.item_table = self:rootItems()
    self.is_borderless = true
    self.title_bar_fm_style = true
    Menu.init(self)
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

function BookOrbitCatalog:switchTo(title, item_table, context, push, state_w)
    if push and self.current_context then
        table.insert(self.stack, {
            title = self.current_context.title,
            item_table = self.item_table,
            context = self.current_context,
            state_w = self.state_w,
        })
    end
    self.current_context = context
    self.state_w = state_w
    self:switchItemTable(title, item_table)
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
        self:switchTo(self:titleForSection(section), item_table, { kind = "section", title = self:titleForSection(section), section = section }, true)
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

        local item_table = {}
        table.insert(item_table, {
            text = _("Search in this scope"),
            kind = "search",
            params = self:scopeParams(query),
        })
        table.insert(item_table, {
            text = T(_("Sort: %1"), self:sortLabel(query.sort)),
            kind = "sort",
            params = self:scopeParams(query),
            current_sort = query.sort,
            title = title,
        })

        if body.hasPrevious then
            local prev = cloneParams(query)
            prev.page = body.page - 1
            table.insert(item_table, { text = _("Previous page"), kind = "books", params = prev, list_title = title })
        end

        for _, book in ipairs(body.items or {}) do
            table.insert(item_table, self:bookItem(book))
        end

        if #(body.items or {}) == 0 then
            table.insert(item_table, { text = _("No books"), enabled = false })
        end

        if body.hasNext then
            local next_params = cloneParams(query)
            next_params.page = body.page + 1
            table.insert(item_table, { text = _("Next page"), kind = "books", params = next_params, list_title = title })
        end

        local page_title = title or _("Books")
        if body.total then
            page_title = T(_("%1 (%2)"), page_title, body.total)
        end
        self:switchTo(page_title, item_table, { kind = "books", title = title or _("Books"), params = query }, push ~= false, THUMBNAIL_SLOT_WIDTH)
    end)
end

function BookOrbitCatalog:scopeParams(query)
    local params = cloneParams(query)
    params.page = nil
    params.size = nil
    params.q = nil
    return params
end

function BookOrbitCatalog:bookItem(book)
    local author = firstAuthor(book)
    local text = author and (book.title .. " - " .. author) or book.title
    local hints = {}
    local series = formatSeries(book)
    local progress = formatProgress(book.progressPercentage)
    if series then table.insert(hints, series) end
    if progress then table.insert(hints, progress) end
    if tableSize(hints) == 0 and book.formats and book.formats[1] then
        table.insert(hints, table.concat(book.formats, ", "))
    end
    return {
        text = text,
        mandatory = #hints > 0 and table.concat(hints, " | ") or nil,
        kind = "book",
        book_id = book.id,
        state = self:thumbnailWidget(book),
    }
end

function BookOrbitCatalog:thumbnailWidget(book)
    local path = self:cachedThumbnailPath(book)
    if not path then return nil end

    return CenterContainer:new{
        dimen = Geom:new{ w = THUMBNAIL_SLOT_WIDTH, h = THUMBNAIL_HEIGHT },
        FrameContainer:new{
            padding = 0,
            margin = 0,
            bordersize = Size.border.thin,
            ImageWidget:new{
                file = path,
                width = THUMBNAIL_WIDTH,
                height = THUMBNAIL_HEIGHT,
                scale_factor = 0,
            },
        },
    }
end

function BookOrbitCatalog:cachedThumbnailPath(book)
    if not book.hasCover then return nil end
    if not util.makePath(self.thumbnail_cache_dir) then return nil end

    local path = self.thumbnail_cache_dir .. "/" .. tostring(book.id) .. ".jpg"
    if lfs.attributes(path, "mode") == "file" then
        return path
    end

    local ok, err = self.client:downloadCatalogThumbnail(book.id, path)
    if not ok then
        logger.dbg("BookOrbit: thumbnail download failed", book.id, err)
        return nil
    end
    return path
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

function BookOrbitCatalog:showBookDetail(detail)
    local lines = {}
    table.insert(lines, detail.title or _("Untitled"))
    if detail.subtitle then table.insert(lines, detail.subtitle) end
    if detail.authors and detail.authors[1] then
        table.insert(lines, "")
        table.insert(lines, T(_("Author: %1"), table.concat(detail.authors, ", ")))
    end
    if detail.seriesName then
        table.insert(lines, T(_("Series: %1"), formatSeries(detail)))
    end
    if detail.progressPercentage then
        table.insert(lines, T(_("Progress: %1"), formatProgress(detail.progressPercentage)))
    end
    if detail.readStatus then
        table.insert(lines, T(_("Status: %1"), detail.readStatus))
    end
    if detail.libraryName then
        table.insert(lines, T(_("Library: %1"), detail.libraryName))
    end
    if detail.collections and #detail.collections > 0 then
        local names = {}
        for _, collection in ipairs(detail.collections) do
            table.insert(names, collection.name)
        end
        table.insert(lines, T(_("Collections: %1"), table.concat(names, ", ")))
    end
    if detail.publisher or detail.publishedYear or detail.language then
        table.insert(lines, "")
        if detail.publisher then table.insert(lines, T(_("Publisher: %1"), detail.publisher)) end
        if detail.publishedYear then table.insert(lines, T(_("Year: %1"), detail.publishedYear)) end
        if detail.language then table.insert(lines, T(_("Language: %1"), detail.language)) end
    end
    if detail.description then
        table.insert(lines, "")
        table.insert(lines, detail.description)
    end

    local buttons = {
        {
            {
                text = _("Download"),
                enabled = detail.files and #detail.files > 0,
                callback = function()
                    self:showFileChoices(detail)
                end,
            },
        },
    }

    UIManager:show(TextViewer:new{
        title = detail.title or _("Book details"),
        title_multilines = true,
        text = table.concat(lines, "\n"),
        text_type = "book_info",
        buttons_table = buttons,
    })
end

function BookOrbitCatalog:showFileChoices(detail)
    local files = {}
    for _, file in ipairs(detail.files or {}) do
        if isSupportedFormat(file.format) then
            table.insert(files, file)
        end
    end

    if #files == 0 then
        UIManager:show(InfoMessage:new{ text = _("No downloadable files found."), timeout = 3 })
        return
    end
    if #files == 1 then
        self:showDownloadDialog(detail, files[1])
        return
    end

    local dialog
    local buttons = {}
    for _, file in ipairs(files) do
        local label = string.upper(file.format or "file")
        local size = formatBytes(file.sizeBytes)
        if size ~= "" then
            label = label .. " - " .. size
        end
        table.insert(buttons, {
            {
                text = label,
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
    local previous = table.remove(self.stack)
    if previous then
        self.current_context = previous.context
        self.state_w = previous.state_w
        self:switchItemTable(previous.title, previous.item_table)
    else
        self.item_table = self:rootItems()
        self.current_context = { kind = "root", title = self.title }
        self.state_w = nil
        self:switchItemTable(self.title, self.item_table)
    end
    return true
end

function BookOrbitCatalog:onHoldReturn()
    self.stack = {}
    self.item_table = self:rootItems()
    self.current_context = { kind = "root", title = self.title }
    self.state_w = nil
    self:switchItemTable(self.title, self.item_table)
    return true
end

return BookOrbitCatalog
