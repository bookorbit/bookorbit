--[[--
Bulk download manager mixin for the BookOrbit catalog browser.

Runs explicit foreground queues for selected books, current pages and all books
matching the current list. The queue deliberately reuses the catalog's existing
download and local sync-link primitives.
]]

local BD = require("ui/bidi")
local ButtonDialog = require("ui/widget/buttondialog")
local InfoMessage = require("ui/widget/infomessage")
local UIManager = require("ui/uimanager")
local lfs = require("libs/libkoreader-lfs")
local logger = require("logger")
local T = require("ffi/util").template
local _ = require("gettext")

local CatalogUtil = require("bookorbit_catalog_util")

local cloneParams = CatalogUtil.cloneParams
local formatBytes = CatalogUtil.formatBytes
local isSupportedFormat = CatalogUtil.isSupportedFormat
local safeFilenameBase = CatalogUtil.safeFilenameBase
local shortText = CatalogUtil.shortText

local STEP_DELAY = 0.15
local PROGRESS_THROTTLE = 1
local FAILED_TITLES_LIMIT = 8

local FORMAT_PRESETS = {
    {
        id = "epub",
        label = _("EPUB first"),
        order = { "epub", "kepub", "azw3", "mobi", "fb2", "txt", "pdf", "djvu", "cbz", "cbr" },
    },
    {
        id = "pdf",
        label = _("PDF first"),
        order = { "pdf", "djvu", "epub", "kepub", "azw3", "mobi", "fb2", "txt", "cbz", "cbr" },
    },
    {
        id = "comics",
        label = _("Comics first"),
        order = { "cbz", "cbr", "pdf", "djvu", "epub", "kepub", "azw3", "mobi", "fb2", "txt" },
    },
}

local EXISTING_POLICIES = {
    { id = "skip", label = _("Skip existing") },
    { id = "overwrite", label = _("Overwrite existing") },
}

local function presetById(id)
    for _, preset in ipairs(FORMAT_PRESETS) do
        if preset.id == id then return preset end
    end
    return FORMAT_PRESETS[1]
end

local function policyById(id)
    for _, policy in ipairs(EXISTING_POLICIES) do
        if policy.id == id then return policy end
    end
    return EXISTING_POLICIES[1]
end

local function bookTitle(book)
    return book and book.title or _("Untitled")
end

local function sortedParamKey(params)
    local keys = {}
    for key in pairs(params or {}) do
        if key ~= "page" and key ~= "size" then
            table.insert(keys, key)
        end
    end
    table.sort(keys)

    local parts = {}
    for _, key in ipairs(keys) do
        table.insert(parts, tostring(key) .. "=" .. tostring(params[key]))
    end
    return table.concat(parts, "&")
end

local function dedupeBooks(books)
    local seen = {}
    local result = {}
    for _, book in ipairs(books or {}) do
        local id = book and book.id
        if id and not seen[id] then
            seen[id] = true
            table.insert(result, book)
        end
    end
    return result
end

local CatalogBulkDownload = {}

function CatalogBulkDownload.install(Catalog)
    function Catalog:initBulkDownloadState()
        self.bulk_selection_mode = false
        self.bulk_selection_scope_key = nil
        self.bulk_selected_books = {}
        self.bulk_selected_order = {}
        self.bulk_running = false
        self.bulk_ctx = nil
    end

    function Catalog:bulkFormatPreset()
        return presetById(self.settings.catalog_bulk_format_preset)
    end

    function Catalog:bulkExistingPolicy()
        return policyById(self.settings.catalog_bulk_existing_policy)
    end

    function Catalog:bulkListParams(context)
        local params = cloneParams((context or {}).params or {})
        params.page = nil
        params.size = nil
        return params
    end

    function Catalog:bulkListScopeKey(context)
        if not context or context.kind ~= "books" then return nil end
        return tostring(context.title or "") .. "|" .. sortedParamKey(context.params or {})
    end

    function Catalog:bulkHandleContextChange(context)
        local key = self:bulkListScopeKey(context)
        if self.bulk_selection_scope_key and self.bulk_selection_scope_key ~= key then
            self:bulkClearSelection(false)
        elseif self.bulk_selection_mode and not key then
            self:bulkClearSelection(false)
        end
    end

    function Catalog:bulkDecorateTitle(title, subtitle)
        if not self.bulk_selection_mode then return title, subtitle end
        local count = self:bulkSelectedCount()
        local selected_text = count == 1 and _("1 selected") or T(_("%1 selected"), count)
        if subtitle and subtitle ~= "" then
            subtitle = selected_text .. " - " .. subtitle
        else
            subtitle = selected_text
        end
        return _("Select books"), subtitle
    end

    function Catalog:bulkSelectedCount()
        local count = 0
        for _ in pairs(self.bulk_selected_books or {}) do
            count = count + 1
        end
        return count
    end

    function Catalog:bulkIsBookSelected(book)
        return book and book.id and self.bulk_selected_books and self.bulk_selected_books[book.id] ~= nil
    end

    function Catalog:bulkEnterSelectionMode(entry)
        if not self:bookMode() then return end
        self.bulk_selection_mode = true
        self.bulk_selection_scope_key = self:bulkListScopeKey(self.current_context)
        if entry and entry.book then
            self:bulkSelectBook(entry.book)
        end
        self:updateItems()
    end

    function Catalog:bulkClearSelectedBooks(redraw)
        self.bulk_selected_books = {}
        self.bulk_selected_order = {}
        if redraw then self:updateItems() end
    end

    function Catalog:bulkClearSelection(redraw)
        self.bulk_selection_mode = false
        self.bulk_selection_scope_key = nil
        self:bulkClearSelectedBooks(redraw)
    end

    function Catalog:bulkExitSelectionMode()
        self:bulkClearSelection(true)
    end

    function Catalog:bulkSelectBook(book)
        if not book or not book.id then return end
        if not self.bulk_selected_books[book.id] then
            table.insert(self.bulk_selected_order, book.id)
        end
        self.bulk_selected_books[book.id] = book
    end

    function Catalog:bulkToggleBook(book)
        if not book or not book.id then return end
        if self.bulk_selected_books[book.id] then
            self.bulk_selected_books[book.id] = nil
        else
            self:bulkSelectBook(book)
        end
        self:updateItems()
    end

    function Catalog:bulkToggleEntry(entry)
        if not self:bookMode() or not entry or entry.kind ~= "book" then return false end
        if not self.bulk_selection_mode then
            self:bulkEnterSelectionMode(entry)
        else
            self:bulkToggleBook(entry.book)
        end
        return true
    end

    function Catalog:bulkSelectedBooks()
        local books = {}
        local retained_order = {}
        for _, book_id in ipairs(self.bulk_selected_order or {}) do
            local book = self.bulk_selected_books[book_id]
            if book then
                table.insert(books, book)
                table.insert(retained_order, book_id)
            end
        end
        self.bulk_selected_order = retained_order
        return books
    end

    function Catalog:bulkCurrentPageBooks()
        local books = {}
        for _, entry in ipairs(self.item_table or {}) do
            if entry.kind == "book" and entry.book then
                table.insert(books, entry.book)
            end
        end
        return books
    end

    function Catalog:bulkSelectCurrentPage()
        if not self:bookMode() then return end
        self.bulk_selection_mode = true
        self.bulk_selection_scope_key = self:bulkListScopeKey(self.current_context)
        for _, book in ipairs(self:bulkCurrentPageBooks()) do
            self:bulkSelectBook(book)
        end
        self:updateItems()
    end

    function Catalog:showBulkSelectionActions()
        local dialog
        dialog = ButtonDialog:new{
            title = T(_("Selected books: %1"), self:bulkSelectedCount()),
            buttons = {
                {
                    {
                        text = _("Download selected"),
                        enabled = self:bulkSelectedCount() > 0,
                        callback = function()
                            UIManager:close(dialog)
                            self:confirmBulkBooks(
                                self:bulkSelectedBooks(), _("Selected books"), { clear_selection = true })
                        end,
                    },
                },
                {
                    {
                        text = _("Select page"),
                        callback = function()
                            UIManager:close(dialog)
                            self:bulkSelectCurrentPage()
                        end,
                    },
                    {
                        text = _("Clear"),
                        enabled = self:bulkSelectedCount() > 0,
                        callback = function()
                            UIManager:close(dialog)
                            self:bulkClearSelectedBooks(true)
                        end,
                    },
                },
                {
                    {
                        text = _("Exit selection"),
                        callback = function()
                            UIManager:close(dialog)
                            self:bulkExitSelectionMode()
                        end,
                    },
                },
                {
                    {
                        text = _("Close BookOrbit"),
                        callback = function()
                            UIManager:close(dialog)
                            self:onCloseAllMenus()
                        end,
                    },
                },
            },
        }
        UIManager:show(dialog)
    end

    function Catalog:showBulkDownloadSettings()
        local dialog
        local preset = self:bulkFormatPreset()
        local policy = self:bulkExistingPolicy()
        dialog = ButtonDialog:new{
            title = _("Bulk download settings"),
            buttons = {
                {
                    {
                        text = T(_("Format: %1"), preset.label),
                        callback = function()
                            UIManager:close(dialog)
                            self:showBulkFormatPresetDialog()
                        end,
                    },
                },
                {
                    {
                        text = T(_("Existing files: %1"), policy.label),
                        callback = function()
                            UIManager:close(dialog)
                            self:showBulkExistingPolicyDialog()
                        end,
                    },
                },
            },
        }
        UIManager:show(dialog)
    end

    function Catalog:showBulkFormatPresetDialog()
        local current = self:bulkFormatPreset().id
        local dialog
        local buttons = {}
        for _, preset in ipairs(FORMAT_PRESETS) do
            table.insert(buttons, {
                {
                    text = preset.label .. (current == preset.id and " *" or ""),
                    callback = function()
                        UIManager:close(dialog)
                        self:persistSetting("catalog_bulk_format_preset", preset.id)
                    end,
                },
            })
        end
        dialog = ButtonDialog:new{ title = _("Bulk format preference"), buttons = buttons }
        UIManager:show(dialog)
    end

    function Catalog:showBulkExistingPolicyDialog()
        local current = self:bulkExistingPolicy().id
        local dialog
        local buttons = {}
        for _, policy in ipairs(EXISTING_POLICIES) do
            table.insert(buttons, {
                {
                    text = policy.label .. (current == policy.id and " *" or ""),
                    callback = function()
                        UIManager:close(dialog)
                        self:persistSetting("catalog_bulk_existing_policy", policy.id)
                    end,
                },
            })
        end
        dialog = ButtonDialog:new{ title = _("Existing files"), buttons = buttons }
        UIManager:show(dialog)
    end

    function Catalog:bulkSupportedFormatHint(book)
        if not book or not book.formats or #book.formats == 0 then return true end
        for _, format in ipairs(book.formats) do
            if isSupportedFormat(format) then return true end
        end
        return false
    end

    function Catalog:bulkCountKnownSkips(books)
        local counts = { on_device = 0, unsupported = 0 }
        for _, book in ipairs(books or {}) do
            if self:isOnDevice(book) then
                counts.on_device = counts.on_device + 1
            elseif not self:bulkSupportedFormatHint(book) then
                counts.unsupported = counts.unsupported + 1
            end
        end
        return counts
    end

    function Catalog:bulkConfirmationTitle(source)
        local total = source.total or #(source.books or {})
        local lines = {
            T(_("Download %1 books?"), total),
            T(_("Scope: %1"), source.label or _("Books")),
            T(_("Folder: %1"), BD.dirpath(self:getCurrentDownloadDir())),
            T(_("Format: %1"), self:bulkFormatPreset().label),
            T(_("Existing files: %1"), self:bulkExistingPolicy().label),
        }
        if source.known_skips then
            if source.known_skips.on_device > 0 then
                table.insert(lines, T(_("Already on device: %1"), source.known_skips.on_device))
            end
            if source.known_skips.unsupported > 0 then
                table.insert(lines, T(_("No supported format: %1"), source.known_skips.unsupported))
            end
        end
        return table.concat(lines, "\n")
    end

    function Catalog:confirmBulkSource(source)
        if self.bulk_running then
            UIManager:show(InfoMessage:new{ text = _("A bulk download is already running."), timeout = 3 })
            return
        end
        if (source.total or #(source.books or {})) == 0 then
            UIManager:show(InfoMessage:new{ text = _("No books to download."), timeout = 2 })
            return
        end
        local dialog
        dialog = ButtonDialog:new{
            title = self:bulkConfirmationTitle(source),
            buttons = {
                {
                    {
                        text = _("Download"),
                        callback = function()
                            UIManager:close(dialog)
                            self:startBulkSource(source)
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

    function Catalog:confirmBulkBooks(books, label, opts)
        books = dedupeBooks(books)
        self:refreshOnDevice()
        self:confirmBulkSource({
            label = label,
            total = #books,
            books = books,
            known_skips = self:bulkCountKnownSkips(books),
            clear_selection = opts and opts.clear_selection == true,
            resolve = function()
                return books
            end,
        })
    end

    function Catalog:confirmBulkCurrentPage()
        self:confirmBulkBooks(self:bulkCurrentPageBooks(), _("Current page"))
    end

    function Catalog:confirmBulkAllMatching()
        if not self:bookMode() then return end
        local context = self.current_context or {}
        local total = context.total or #(context.books or {})
        local params = self:bulkListParams(context)
        self:confirmBulkSource({
            label = context.title or _("Current list"),
            total = total,
            resolve = function(ctx)
                return self:bulkLoadAllMatchingBooks(params, total, ctx)
            end,
        })
    end

    function Catalog:bulkLoadAllMatchingBooks(params, expected_total, ctx)
        local MAX_PAGES = 200
        local books = {}
        local page = 1
        local has_next = true
        while has_next and page <= MAX_PAGES do
            if ctx.cancel_requested then return nil, "cancelled" end
            local query = cloneParams(params)
            query.page = page
            query.size = 100
            self:bulkSetProgress(ctx, T(_("Loading list page %1..."), page), true)
            local body, err = self.client:catalogBooks(query)
            if not body then return nil, err end
            for _, book in ipairs(body.items or {}) do
                table.insert(books, book)
            end
            has_next = body.hasNext == true and #books < (expected_total or body.total or #books)
            page = page + 1
        end
        return dedupeBooks(books)
    end

    function Catalog:startBulkSource(source)
        if self.bulk_running then
            UIManager:show(InfoMessage:new{ text = _("A bulk download is already running."), timeout = 3 })
            return
        end

        local ctx = {
            label = source.label or _("Books"),
            total = source.total or 0,
            books = {},
            index = 0,
            counts = {
                downloaded = 0,
                linked = 0,
                skipped_on_device = 0,
                skipped_unsupported = 0,
                skipped_existing = 0,
                failed = 0,
            },
            failed_books = {},
            failed_titles = {},
            cancel_requested = false,
            cancelled = false,
            progress_dialog = nil,
            progress_shown_text = nil,
            progress_shown_at = 0,
        }
        self.bulk_running = true
        self.bulk_ctx = ctx
        if source.clear_selection then
            self:bulkClearSelection(true)
        end
        self:bulkSetProgress(ctx, _("Preparing bulk download..."), true)
        UIManager:scheduleIn(STEP_DELAY, function()
            local ok, result, resolve_err = pcall(function()
                return source.resolve(ctx)
            end)
            if not ok then
                logger.warn("BookOrbit: bulk download preparation failed", result)
                self:bulkAbort(ctx, _("Could not prepare bulk download."))
                return
            end
            if not result then
                logger.warn("BookOrbit: bulk download list request failed", resolve_err)
                self:bulkAbort(ctx, _("Could not load the selected books."))
                return
            end
            ctx.books = dedupeBooks(result)
            ctx.total = #ctx.books
            if ctx.total == 0 then
                self:bulkAbort(ctx, _("No books to download."))
                return
            end
            self:bulkQueueStep(ctx)
        end)
    end

    function Catalog:bulkAbort(ctx, message)
        if ctx.progress_dialog then
            UIManager:close(ctx.progress_dialog)
            ctx.progress_dialog = nil
        end
        self.bulk_running = false
        self.bulk_ctx = nil
        UIManager:show(InfoMessage:new{ text = message, timeout = 4 })
    end

    function Catalog:bulkSetProgress(ctx, text, force)
        if not ctx then return end
        if not force then
            if text == ctx.progress_shown_text then return end
            if ctx.progress_dialog and os.time() - (ctx.progress_shown_at or 0) < PROGRESS_THROTTLE then
                return
            end
        end
        ctx.progress_shown_text = text
        ctx.progress_shown_at = os.time()
        if ctx.progress_dialog then
            ctx.progress_dialog:setTitle(text)
        else
            ctx.progress_dialog = ButtonDialog:new{
                title = text,
                buttons = {
                    {
                        {
                            text = _("Cancel after current file"),
                            callback = function()
                                ctx.cancel_requested = true
                                self:bulkSetProgress(ctx, _("Stopping after current file..."), true)
                            end,
                        },
                    },
                },
            }
            UIManager:show(ctx.progress_dialog)
        end
        UIManager:forceRePaint()
    end

    function Catalog:bulkQueueStep(ctx)
        if ctx ~= self.bulk_ctx then return end
        if ctx.cancel_requested then
            ctx.cancelled = true
            self:bulkFinish(ctx)
            return
        end

        local book = ctx.books[ctx.index + 1]
        if not book then
            self:bulkFinish(ctx)
            return
        end
        ctx.index = ctx.index + 1

        local ok, err = pcall(function()
            self:bulkProcessBook(ctx, book)
        end)
        if not ok then
            logger.warn("BookOrbit: bulk download item failed", err)
            self:bulkRecordFailure(ctx, book)
        end

        UIManager:scheduleIn(STEP_DELAY, function()
            self:bulkQueueStep(ctx)
        end)
    end

    function Catalog:bulkProcessBook(ctx, book)
        if self:isOnDevice(book) then
            ctx.counts.skipped_on_device = ctx.counts.skipped_on_device + 1
            return
        end
        if not self:bulkSupportedFormatHint(book) then
            ctx.counts.skipped_unsupported = ctx.counts.skipped_unsupported + 1
            return
        end

        self:bulkSetProgress(ctx, T(_("Preparing %1/%2..."), ctx.index, ctx.total), true)
        local detail, err = self.client:catalogBook(book.id)
        if not detail then
            logger.warn("BookOrbit: bulk detail fetch failed", book.id, err)
            self:bulkRecordFailure(ctx, book)
            return
        end
        if self:isOnDevice(detail) then
            ctx.counts.skipped_on_device = ctx.counts.skipped_on_device + 1
            return
        end

        local file = self:bulkChooseFile(detail)
        if not file then
            ctx.counts.skipped_unsupported = ctx.counts.skipped_unsupported + 1
            return
        end

        local filename = safeFilenameBase(detail)
        local filetype = string.lower(file.format or "bin")
        local local_path = self:getLocalDownloadPath(filename, filetype)
        if lfs.attributes(local_path) and self:bulkExistingPolicy().id == "skip" then
            ctx.counts.skipped_existing = ctx.counts.skipped_existing + 1
            return
        end

        local ok, linked = self:bulkDownloadFile(ctx, detail, file, local_path)
        if not ok then
            self:bulkRecordFailure(ctx, book)
            return
        end
        ctx.counts.downloaded = ctx.counts.downloaded + 1
        if linked then ctx.counts.linked = ctx.counts.linked + 1 end
    end

    function Catalog:bulkChooseFile(detail)
        local files = self:supportedFiles(detail)
        if #files == 0 then return nil end

        for _, format in ipairs(self:bulkFormatPreset().order) do
            local wanted = string.lower(format)
            for _, file in ipairs(files) do
                local file_format = string.lower(file.format or "")
                if file_format == wanted and not self:onDeviceFilePath(file) then
                    return file
                end
            end
        end
        for _, file in ipairs(files) do
            if not self:onDeviceFilePath(file) then
                return file
            end
        end
        return nil
    end

    function Catalog:bulkDownloadFile(ctx, detail, file, local_path)
        local filename = local_path:match("[^/]+$") or safeFilenameBase(detail)
        local total = file.sizeBytes
        local last_bucket = -1
        local function on_progress(received)
            local text, bucket
            if total and total > 0 then
                local pct = math.min(100, math.floor(received / total * 100))
                bucket = math.floor(pct / 5)
                if bucket == last_bucket then return end
                text = T(_("Downloading %1/%2:\n%3\n\n%4"), ctx.index, ctx.total, filename, pct .. "%")
            else
                bucket = math.floor(received / (256 * 1024))
                if bucket == last_bucket then return end
                text = T(_("Downloading %1/%2:\n%3\n\n%4"), ctx.index, ctx.total, filename, formatBytes(received))
            end
            last_bucket = bucket
            self:bulkSetProgress(ctx, text, true)
        end

        self:bulkSetProgress(ctx, T(_("Downloading %1/%2:\n%3"), ctx.index, ctx.total, filename), true)
        local ok, err = self.client:downloadCatalogFile(file.id, local_path, on_progress)
        if not ok then
            logger.warn("BookOrbit: bulk file download failed", detail.id, file.id, err)
            return false, false
        end

        local linked = self:linkDownloadedFile(local_path)
        if linked then
            self:refreshOnDevice()
            if self.markStackDirty then self:markStackDirty() end
        end
        return true, linked
    end

    function Catalog:bulkRecordFailure(ctx, book)
        ctx.counts.failed = ctx.counts.failed + 1
        table.insert(ctx.failed_books, book)
        if #ctx.failed_titles < FAILED_TITLES_LIMIT then
            table.insert(ctx.failed_titles, shortText(bookTitle(book), 60))
        end
    end

    function Catalog:bulkFinish(ctx)
        if ctx.progress_dialog then
            UIManager:close(ctx.progress_dialog)
            ctx.progress_dialog = nil
        end
        self.bulk_running = false
        self.bulk_ctx = nil
        self:refreshOnDevice()
        if self.markStackDirty then self:markStackDirty() end
        if self.updateItems and (self:bookMode() or self:dashboardMode()) then
            self:updateItems()
        end

        local counts = ctx.counts
        local lines = {
            ctx.cancelled and _("Bulk download stopped.") or _("Bulk download complete."),
            T(_("Downloaded: %1"), counts.downloaded),
            T(_("Linked: %1"), counts.linked),
            T(_("Skipped on device: %1"), counts.skipped_on_device),
            T(_("Skipped existing: %1"), counts.skipped_existing),
            T(_("No supported format: %1"), counts.skipped_unsupported),
            T(_("Failed: %1"), counts.failed),
        }
        if #ctx.failed_titles > 0 then
            table.insert(lines, "")
            table.insert(lines, _("Failed books:"))
            for _, title in ipairs(ctx.failed_titles) do
                table.insert(lines, title)
            end
            if #ctx.failed_books > #ctx.failed_titles then
                table.insert(lines, T(_("+%1 more"), #ctx.failed_books - #ctx.failed_titles))
            end
        end

        local dialog
        local buttons = {}
        if #ctx.failed_books > 0 then
            table.insert(buttons, {
                {
                    text = _("Retry failed"),
                    callback = function()
                        UIManager:close(dialog)
                        self:confirmBulkBooks(ctx.failed_books, _("Failed downloads"))
                    end,
                },
            })
        end
        table.insert(buttons, {
            {
                text = _("View On device"),
                callback = function()
                    UIManager:close(dialog)
                    self:loadOnDevice()
                end,
            },
            {
                text = _("Close"),
                callback = function()
                    UIManager:close(dialog)
                end,
            },
        })

        dialog = ButtonDialog:new{
            title = table.concat(lines, "\n"),
            buttons = buttons,
        }
        UIManager:show(dialog)
    end
end

return CatalogBulkDownload
