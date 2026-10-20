--[[--
One sheet for downloading a book: what used to be Choose file, Download
options, the folder and file name dialog, Overwrite? and Open now?

Choose: the editions the server offers, then where it goes (folder and file
name), then Download. A file already at that path shows a warning in the
sheet and the button says Replace. The same sheet then shows the download's
progress, and ends on Start reading or on what went wrong.
]]

local UIManager = require("ui/uimanager")
local lfs = require("libs/libkoreader-lfs")
local T = require("ffi/util").template
local _ = require("gettext")

local BoardMetrics = require("bookorbit_board_metrics")
local BoardUI = require("bookorbit_board_ui")
local CatalogUtil = require("bookorbit_catalog_util")
local DialogUI = require("bookorbit_dialog_ui")
local MenuUI = require("bookorbit_menu_ui")

local INK = BoardMetrics.INK
local px = BoardMetrics.px
local text, vstack, hstack, space = BoardUI.text, BoardUI.vstack, BoardUI.hstack, BoardUI.space

local DownloadSheet = {}

local formatBytes = CatalogUtil.formatBytes

local FORMAT_WORDS = {
    epub = _("The ebook"),
    kepub = _("The ebook, for Kobo"),
    pdf = _("Fixed pages"),
    cbz = _("The comic"),
    cbr = _("The comic"),
    mobi = _("The ebook"),
    azw3 = _("The ebook"),
    fb2 = _("The ebook"),
    djvu = _("Scanned pages"),
}

-- The editions a book offers: each supported file, and for a read-along
-- EPUB both of its forms, text only and with its narration. Pure, for specs.
-- Each edition: { file, variant, label, sub }.
function DownloadSheet.editions(files)
    local out = {}
    for _i, file in ipairs(files or {}) do
        local format = string.lower(file.format or "")
        if file.sourceMediaOverlayAvailable == true then
            local text_size = file.downloadVariant == "audioless_epub" and file.sizeBytes or nil
            local full_size = file.downloadVariant == "original" and file.sizeBytes or file.sourceSizeBytes
            table.insert(out, {
                file = file, variant = "audioless_epub",
                label = _("Read-along EPUB, text only"),
                sub = text_size and T(_("Narration taken out, %1"), formatBytes(text_size)) or _("Narration taken out, so it stays small"),
            })
            table.insert(out, {
                file = file, variant = "original",
                label = _("Read-along EPUB with narration"),
                sub = full_size and T(_("Includes the audio, %1"), formatBytes(full_size)) or _("Includes the audio"),
            })
        else
            local size = file.sizeBytes or file.sourceSizeBytes
            local words = FORMAT_WORDS[format] or string.upper(format)
            table.insert(out, {
                file = file, variant = file.downloadVariant,
                label = string.upper(format),
                sub = size and (words .. ", " .. formatBytes(size)) or words,
            })
        end
    end
    return out
end

-- Which edition a file and variant pick.
function DownloadSheet.indexOf(editions, file_id, variant)
    for index, e in ipairs(editions) do
        if e.file.id == file_id and (variant == nil or e.variant == variant or e.variant == nil) then return index end
    end
    return 1
end

-- The size the download will be, when it is known.
local function editionSize(e)
    local f = e.file
    if e.variant == f.downloadVariant and f.sizeBytes then return f.sizeBytes end
    if f.sourceMediaOverlayAvailable == true then
        return e.variant == "original" and f.sourceSizeBytes or nil
    end
    return f.sizeBytes or f.sourceSizeBytes
end

-- Where the chosen edition would land: the folder, the name without its
-- extension, the extension, and the full path.
local function target(page)
    local e = page.editions[page.choice]
    local f = e.file
    local ext = string.lower(f.format or "bin")
    local folder, name = page.catalog:getLocalDownloadPreview(page.filename or CatalogUtil.safeFilenameBase(page.detail), ext, f.devicePath, page.filename ~= nil)
    return folder, name, ext, folder .. "/" .. name .. "." .. ext
end

local function head(page, w, close)
    local d = page.detail
    local authors = {}
    for _i, a in ipairs(d.authors or {}) do table.insert(authors, a) end
    return DialogUI.bookHead(w, { title = d.title, author = table.concat(authors, ", ") }, { cover_path = page.catalog:cachedThumbnailPath(d), close = close })
end

local function chooseBody(page, w, two_col)
    local folder, name, ext, path = target(page)
    local BookPeek = require("bookorbit_book_peek")
    local exists = lfs.attributes(path, "mode") == "file"
    local iw = MenuUI.rowsIn(w)
    local rows = {}
    for index, e in ipairs(page.editions) do
        table.insert(rows, MenuUI.row(iw, { label = e.label, sub = e.sub, radio = index == page.choice, action = { kind = "edition", index = index } }))
    end
    local editions = DialogUI.section(w, _("Edition"), MenuUI.group(w, rows))
    local save = DialogUI.section(w, _("Save to"), MenuUI.group(w, {
        MenuUI.row(iw, { icon = "folder-open", label = _("Folder"), sub = BookPeek.folderLabel(folder) or folder, sub_data = true, chevron = true, action = { kind = "folder" } }),
        MenuUI.row(iw, { icon = "pen-line", label = _("File name"), sub = name .. "." .. ext, sub_data = true, sublines = 2, chevron = true, action = { kind = "rename" } }),
    }))
    local size = formatBytes(editionSize(page.editions[page.choice]))
    local label = exists and _("Replace") or _("Download")
    if size ~= "" then label = T(_("%1, %2"), label, size) end
    local button = MenuUI.pill(label, { icon = "download", w = w, action = { kind = "start" } })
    local warn = exists and DialogUI.warn(w, _("Already on this device"), _("Replacing it can move your place and highlights. The old copy stays until the new one is complete.")) or nil
    if two_col then
        return { left = editions, right = { save, warn or false, button } }
    end
    return { head(page, w), editions, save, warn or false, button }
end

local function progressBody(page, w)
    local p = page.progress or {}
    local folder = target(page)
    local BookPeek = require("bookorbit_book_peek")
    local pct = (p.total and p.total > 0) and math.floor((p.received or 0) * 100 / p.total) or nil
    local sub = (p.total and p.total > 0) and T(_("%1 of %2"), formatBytes(p.received or 0), formatBytes(p.total)) or formatBytes(p.received or 0)
    if sub == "" then sub = _("Starting…") end
    return {
        head(page, w, false),
        vstack({ w = w }, {
            BoardUI.spread(w, text(_("Downloading"), { s = 16, b = true }), pct and text(T(_("%1%"), math.min(99, pct)), { s = 16, b = true }) or nil),
            space(nil, px(8)),
            BoardUI.bar(w, px(8), pct or 0, { r = px(4), track = INK.gd }),
            space(nil, px(8)),
            text(T(_("%1, to %2"), sub, BookPeek.folderLabel(folder) or folder), { s = 13, col = INK.g4, w = w, data = true }),
        }),
        MenuUI.pill(_("Cancel"), { kind = "outline", w = w, action = { kind = "cancel" } }),
    }
end

local function doneBody(page, w)
    local r = page.result or {}
    local folder = target(page)
    local BookPeek = require("bookorbit_book_peek")
    local tw = w - px(24) - px(12)
    local lines = r.linked and _("Linked to BookOrbit, so your place and highlights sync.")
        or _("Saved, but not linked for sync yet. Open it, then use Sync now in the BookOrbit menu.")
    return {
        head(page, w),
        hstack({ w = w, gap = px(12), valign = "top" }, {
            MenuUI.check(),
            vstack({ w = tw }, {
                text(T(_("Saved to %1"), BookPeek.folderLabel(folder) or folder), { s = 16, b = true, w = tw, data = true }),
                text(lines, { s = 13, col = INK.g4, w = tw, lines = 2 }),
            }),
        }),
        DialogUI.pillRow(w, {
            { label = _("Start reading"), icon = "book-open", action = { kind = "read" } },
            { label = _("Done"), kind = "outline", action = { kind = "close" } },
        }),
    }
end

local function errorBody(page, w)
    return {
        head(page, w),
        DialogUI.warn(w, _("The download did not finish"), page.error_text),
        DialogUI.pillRow(w, {
            { label = _("Try again"), icon = "refresh-cw", action = { kind = "start" } },
            { label = _("Close"), kind = "outline", action = { kind = "close" } },
        }),
    }
end

local function build(page, sw, sh)
    local state = page.state
    if state == "choose" then
        -- Wide and short (landscape): the book and its editions beside where
        -- it goes, when one column would not fit.
        local W = BoardMetrics.get().W
        local one = DialogUI.sheet(page, sw, sh, function(w) return chooseBody(page, w) end, { pop_w = 500 })
        local rect = page.panel_rect
        if W < 760 or (rect.y >= px(8) and rect.y + rect.h <= sh) then return one end
        one:free()
        return DialogUI.sheet(page, sw, sh, function(w)
            local gap = px(24)
            local cw = math.floor((w - gap) / 2)
            local parts = chooseBody(page, cw, true)
            local left = vstack({ w = cw }, { head(page, cw, false), space(nil, px(14)), parts.left })
            local right_items = {}
            for _i, item in ipairs(parts.right) do
                if item then
                    if #right_items > 0 then table.insert(right_items, space(nil, px(14))) end
                    table.insert(right_items, item)
                end
            end
            local right = vstack({ w = cw }, right_items)
            local close = DialogUI.closeButton()
            local inset = MenuUI.tapInset(23)
            local h = math.max(left:getSize().h, right:getSize().h)
            return { BoardUI.overlay(w, h, {
                { widget = hstack({ w = w, gap = gap, valign = "top" }, { left, right }), x = 0, y = 0 },
                { widget = close, x = w - close:getSize().w + inset, y = -inset },
            }) }
        end, { pop_w = 880 })
    end
    local body = state == "progress" and progressBody or state == "done" and doneBody or errorBody
    return DialogUI.sheet(page, sw, sh, function(w) return body(page, w) end, { pop_w = 500 })
end

-- Hands the catalog's download the sheet to report to.
local function reporter(page)
    return {
        progress = function(received, total)
            if page.closed then return end
            page.progress = { received = received, total = total }
            page:refresh()
        end,
        finished = function(ok, err, path, linked)
            if page.closed then
                local Toast = require("bookorbit_toast")
                if ok then Toast.show(_("Downloaded")) elseif err ~= "cancelled" then Toast.error(page.catalog:errorText(err)) end
                return
            end
            if ok then
                page.state, page.result = "done", { path = path, linked = linked }
            elseif err == "cancelled" then
                return
            else
                page.state, page.error_text = "error", page.catalog:errorText(err)
                -- The file's selection expired: the next try asks for a new one.
                if err == 409 then page.needs_refresh = true end
            end
            page.dismiss_outside = true
            page:refresh()
        end,
    }
end

local function start(page)
    local catalog = page.catalog
    local e = page.editions[page.choice]
    local function go(detail, file)
        page.detail = detail
        local path = select(4, target(page))
        page.state, page.progress = "progress", nil
        page.dismiss_outside = false
        page.local_path = path
        page:refresh()
        catalog:downloadFile(catalog:getLocalDownloadPath(page.filename or CatalogUtil.safeFilenameBase(detail), string.lower(file.format or "bin"), file.devicePath, page.filename ~= nil), detail, file, reporter(page))
    end
    if not page.needs_refresh and (e.variant == nil or e.variant == e.file.downloadVariant) then
        return go(page.detail, e.file)
    end
    page.needs_refresh = nil
    -- The other form of a read-along EPUB comes from the server as its own
    -- selection, so it is asked for first.
    catalog:runConnected(function()
        local selected, err = catalog:fetchDeliveryBook(page.detail.id, e.variant or e.file.requestedVariant or e.file.downloadVariant, _("Getting that edition…"))
        if not selected then
            if err ~= "cancelled" then require("bookorbit_toast").error(catalog:errorText(err)) end
            return
        end
        for _i, candidate in ipairs(selected.files or {}) do
            if candidate.id == e.file.id then
                page.editions = DownloadSheet.editions(catalog:supportedFiles(selected))
                page.choice = DownloadSheet.indexOf(page.editions, candidate.id, e.variant)
                return go(selected, candidate)
            end
        end
        require("bookorbit_toast").error(catalog:errorText(404))
    end)
end

local function rename(page)
    local TextEntry = require("bookorbit_text_entry")
    local folder, name, ext = target(page)
    local BookPeek = require("bookorbit_book_peek")
    TextEntry.open{
        title = _("File name"),
        value = name,
        icon = "pen-line",
        below = function(_page, w)
            return {
                text(T(_("Saved as .%1 in %2"), ext, BookPeek.folderLabel(folder) or folder), { s = 13, col = INK.g4, w = w, data = true }),
                DialogUI.pillRow(w, {
                    { label = _("Cancel"), kind = "outline", action = { kind = "close" } },
                    { label = _("Save"), icon = "check", action = { kind = "submit" } },
                }),
            }
        end,
        on_submit = function(value)
            if page.closed then return end
            page.filename = value
            page:refresh()
        end,
    }
end

local function onAction(page, action)
    local kind = action.kind
    local catalog = page.catalog
    if kind == "edition" then
        page.choice = action.index
        page:refresh()
    elseif kind == "folder" then
        catalog:chooseDownloadDir(function() if not page.closed then page:refresh() end end)
    elseif kind == "rename" then
        rename(page)
    elseif kind == "start" then
        start(page)
    elseif kind == "cancel" then
        catalog:nextDownloadGeneration()
        page:close()
        require("bookorbit_toast").show(_("Download cancelled"), { icon = "x" })
    elseif kind == "read" then
        local path = page.result and page.result.path
        page:close()
        UIManager:tickAfterNext(function() catalog:openDownloadedFile(path) end)
    end
    return true
end

DownloadSheet.reporter = reporter

-- opts: file (preselected), variant, filename (a name already chosen),
-- start (begin downloading at once), progress (show a download the caller
-- has already started; report to DownloadSheet.reporter(page)).
function DownloadSheet.open(catalog, detail, opts)
    opts = opts or {}
    local editions = DownloadSheet.editions(catalog:supportedFiles(detail))
    if #editions == 0 then
        require("bookorbit_toast").error(_("No file this reader can open"))
        return nil
    end
    local first = opts.file or catalog:nextDownloadFile(catalog:supportedFiles(detail))
    local page = DialogUI.open{
        name = "bookorbit_download_sheet",
        build = build,
        on_action = onAction,
        catalog = catalog,
        detail = detail,
        editions = editions,
        choice = DownloadSheet.indexOf(editions, first and first.id, opts.variant or (first and first.downloadVariant)),
        filename = opts.filename,
        state = opts.progress and "progress" or "choose",
        dismiss_outside = not opts.progress,
    }
    if opts.start then start(page) end
    return page
end

return DownloadSheet
