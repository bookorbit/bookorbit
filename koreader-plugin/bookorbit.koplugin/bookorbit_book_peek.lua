--[[--
The sheet a long-press on a book opens, anywhere in the catalog.

The book's cover, where it stands and whether it is on this device, then the
two things a long-press is for (Read or Download, and Details), then About,
Genres & tags and either Download options or Remove from this device. Book
info is not a separate door: Details opens the detail page, whose second page
holds those facts.
]]

local UIManager = require("ui/uimanager")
local T = require("ffi/util").template
local _ = require("gettext")

local BoardMetrics = require("bookorbit_board_metrics")
local CatalogUtil = require("bookorbit_catalog_util")
local DetailData = require("bookorbit_detail_data")
local DialogUI = require("bookorbit_dialog_ui")
local MenuUI = require("bookorbit_menu_ui")

local INK = BoardMetrics.INK

local BookPeek = {}

-- "Books › Standalone": the last two folders of where a download lands.
function BookPeek.folderLabel(path)
    if type(path) ~= "string" or path == "" then return nil end
    local parts = {}
    for part in path:gmatch("[^/]+") do table.insert(parts, part) end
    if #parts == 0 then return "/" end
    return table.concat(parts, " › ", math.max(1, #parts - 1))
end

-- What the page knows about the book, as plain data the sheet draws.
function BookPeek.data(catalog, detail, opts)
    opts = opts or {}
    catalog:refreshOnDevice()
    local supported = catalog:supportedFiles(detail)
    local read_path = catalog:detailReadPath(detail)
    local file = #supported > 0 and catalog:nextDownloadFile(supported) or nil
    local authors = {}
    for _i, a in ipairs(detail.authors or {}) do
        local name = CatalogUtil.cleanInlineText(a)
        if name then table.insert(authors, name) end
    end
    local description = DetailData.cleanDescription(detail.description)
    local status = detail.readStatus or "unread"
    local pct = tonumber(detail.progressPercentage)
    local d = {
        detail = detail,
        title = detail.title or _("Untitled"),
        author = table.concat(authors, ", "),
        cover_path = catalog:cachedThumbnailPath(detail),
        read_path = read_path,
        on_device = read_path ~= nil,
        supported = supported,
        file = file,
        about = description and (description:match("^[^\n]+") or description) or nil,
        chips = DetailData.chips(detail),
        status = status,
        status_label = DetailData.statusLabel(status),
        pct = (status == "reading" or status == "rereading") and pct and pct > 0 and pct or nil,
        allow_select = opts.allow_select == true,
        selected = opts.allow_select and catalog.bulkIsBookSelected and catalog:bulkIsBookSelected(detail) or false,
    }
    if file and not read_path then
        local folder = catalog:getLocalDownloadPreview(CatalogUtil.safeFilenameBase(detail), string.lower(file.format or "bin"), file.devicePath, false)
        local size = CatalogUtil.formatBytes(catalog:fileDisplaySize(file))
        d.file_note = T(_("%1, to %2"), catalog:fileFormatLabel(file) .. (size ~= "" and (", " .. size) or ""), BookPeek.folderLabel(folder) or folder)
    end
    return d
end

local function body(page, w)
    local d = page.peek
    local chips = {}
    if d.pct then
        table.insert(chips, MenuUI.chip(T(_("%1 · %2%"), d.status_label, math.floor(d.pct + 0.5)), { icon = "book-open" }))
    elseif d.status ~= "unread" then
        table.insert(chips, MenuUI.chip(d.status_label, { icon = d.status == "read" and "book-check" or "bookmark" }))
    end
    table.insert(chips, d.on_device and MenuUI.chip(_("On this device"), { icon = "bo-device" }) or MenuUI.chip(_("Not on this device"), { icon = "cloud" }))
    local items = {
        DialogUI.bookHead(w, { title = d.title, author = d.author }, { cover_path = d.cover_path, chips = chips }),
    }
    local pills = {}
    if d.on_device then
        table.insert(pills, { label = _("Read"), icon = "book-open", action = { kind = "read" } })
    elseif d.file then
        table.insert(pills, { label = _("Download"), icon = "download", action = { kind = "download" } })
    end
    table.insert(pills, { label = _("Details"), icon = "book-open-text", kind = "outline", action = { kind = "details" } })
    table.insert(items, DialogUI.pillRow(w, pills))
    if d.file_note then
        table.insert(items, DialogUI.note(w, "file-text", d.file_note, { col = INK.g4, data = true, lines = 1 }))
    end
    local iw = MenuUI.rowsIn(w)
    local rows = {}
    if d.about then
        table.insert(rows, MenuUI.row(iw, { icon = "file-text", label = _("About this book"), sub = d.about, sub_data = true, chevron = true, action = { kind = "about" } }))
    end
    if #d.chips > 0 then
        table.insert(rows, MenuUI.row(iw, { icon = "tag", label = _("Genres & tags"), sub = table.concat(d.chips, ", "), sub_data = true, chevron = true, action = { kind = "tags" } }))
    end
    if d.on_device then
        table.insert(rows, MenuUI.row(iw, { icon = "trash", label = _("Remove from this device"), sub = _("Stays in your library"), chevron = true, action = { kind = "remove" } }))
    elseif #d.supported > 0 then
        table.insert(rows, MenuUI.row(iw, { icon = "folder-open", label = _("Download options"), sub = _("Edition, folder and file name"), chevron = true, action = { kind = "download-options" } }))
    end
    if d.allow_select then
        table.insert(rows, MenuUI.row(iw, { icon = "list-checks", label = d.selected and _("Unselect") or _("Select"), sub = _("Pick books to download or mark read together"), chevron = true, action = { kind = "select" } }))
    end
    if #rows > 0 then table.insert(items, MenuUI.group(w, rows)) end
    return items
end

local function build(page, sw, sh)
    return DialogUI.sheet(page, sw, sh, function(w) return body(page, w) end, { pop_w = 460 })
end

local function onAction(page, action)
    local catalog, d = page.catalog, page.peek
    local detail = d.detail
    local kind = action.kind
    page:close()
    -- The sheet's backdrop is restored first, so the next page or sheet
    -- copies a clean screen.
    UIManager:tickAfterNext(function()
        if kind == "read" then
            catalog:openDownloadedFile(d.read_path)
        elseif kind == "download" then
            catalog:downloadDefaultFile(detail, d.file)
        elseif kind == "details" then
            catalog:showBookDetail(detail)
        elseif kind == "about" then
            catalog:showFullText(_("About this book"), detail.description, detail)
        elseif kind == "tags" then
            catalog:showGenresAndTags(detail)
        elseif kind == "download-options" then
            catalog:showDownloadOptions(detail)
        elseif kind == "remove" then
            BookPeek.remove(catalog, d.read_path)
        elseif kind == "select" then
            if catalog:isBulkSelectionActive() then
                catalog:bulkToggleBook(detail)
            else
                catalog:bulkEnterSelectionMode({ kind = "book", book = detail })
            end
        end
    end)
    return true
end

-- Deletes the file and its sidecar through KOReader's file manager, which
-- asks first. The book stays in the library.
function BookPeek.remove(catalog, path)
    local fm = require("apps/filemanager/filemanager").instance
    if not fm or not fm.showDeleteFileDialog then
        require("bookorbit_toast").error(_("Open the file browser to remove this book."))
        return
    end
    fm:showDeleteFileDialog(path, function()
        catalog:refreshOnDevice()
        catalog:markStackDirty()
        catalog:updateItems(nil, true)
    end)
end

function BookPeek.open(catalog, detail, opts)
    return DialogUI.open{
        name = "bookorbit_book_peek",
        build = build,
        on_action = onAction,
        catalog = catalog,
        peek = BookPeek.data(catalog, detail, opts),
    }
end

return BookPeek
