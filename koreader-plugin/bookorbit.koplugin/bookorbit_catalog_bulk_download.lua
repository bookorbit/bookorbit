--[[--
Bulk download manager mixin for the BookOrbit catalog browser.

Runs explicit foreground queues for selected books, current pages and all books
matching the current list. Enumeration is page-at-a-time: on a manifest-capable
server one manifest page carries the file descriptors, device paths, sizes and
content hashes the run needs, so a bulk run performs no per-book detail request
and no per-file match request. Older servers keep the paged catalog listing with
bounded per-book detail calls instead of loading the whole result set.

A compact checkpoint records the source identity, the manifest snapshot, the
cursor of the page being processed and that page's completed destinations, so an
interrupted run resumes without re-transferring files it already published.
]]

local UIManager = require("ui/uimanager")
local lfs = require("libs/libkoreader-lfs")
local logger = require("logger")
local util = require("util")
local T = require("ffi/util").template
local _ = require("gettext")

local BookOrbitStateManager = require("bookorbit_state_manager")
local BulkCheckpoint = require("bookorbit_bulk_checkpoint")
local Capabilities = require("bookorbit_capabilities")
local CatalogUtil = require("bookorbit_catalog_util")
local Transfer = require("bookorbit_download_transfer")
-- Loaded on first use: specs load this module without KOReader's widgets.
local function lazy(name) return setmetatable({}, { __index = function(_t, key) return require(name)[key] end }) end
local BulkSheet = lazy("bookorbit_bulk_sheet")
local DialogUI = lazy("bookorbit_dialog_ui")
local Toast = lazy("bookorbit_toast")

local cloneParams = CatalogUtil.cloneParams
local formatBytes = CatalogUtil.formatBytes
local isSupportedFormat = CatalogUtil.isSupportedFormat
local safeFilenameBase = CatalogUtil.safeFilenameBase
local shortText = CatalogUtil.shortText

local STEP_DELAY = 0.15
local NEXT_ITEM_DELAY = 0.02
local PROGRESS_THROTTLE = 1
local FAILED_TITLES_LIMIT = 8

local MANIFEST_FEATURE = "catalogBulkManifest"
local PAGE_SIZE = 100
local ID_CHUNK_SIZE = 500
-- Every state flush rewrites the whole sync-state file, so links are applied in
-- batches rather than once per downloaded file.
local LINK_BATCH_SIZE = 25
local CHECKPOINT_EVERY = 5
-- Explicit ceiling: enumeration follows cursors to completion, and a run that
-- reaches this bound reports it instead of silently looking complete.
local MAX_ENUMERATION_PAGES = 5000
local MAX_EMPTY_PAGES = 50

-- The manifest route takes filters only; sort and paging inputs belong to the
-- interactive listing and are rejected by the endpoint.
local MANIFEST_FILTER_KEYS = {
    "q", "readStatus", "format", "libraryId", "collectionId", "smartScopeId", "author", "series", "seriesId",
}

local function pathKey(path)
    return tostring(path or ""):gsub("\\", "/"):lower()
end

local function appendPathIdentity(path, identity)
    local stem, extension = path:match("^(.*)(%.[^./]+)$")
    if not stem then
        stem, extension = path, ""
    end
    return stem .. " [" .. tostring(identity) .. "]" .. extension
end

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

-- Compact, order-independent identity for an id list, so a resumed run can tell
-- it is continuing the same selection without storing every id twice.
local function idListKey(ids)
    local count, sum, smallest, largest = 0, 0, nil, nil
    for _, id in ipairs(ids or {}) do
        local value = tonumber(id) or 0
        count = count + 1
        sum = sum + value
        if not smallest or value < smallest then smallest = value end
        if not largest or value > largest then largest = value end
    end
    return string.format("%d:%d:%d:%d", count, sum, smallest or 0, largest or 0)
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

local function chunkIds(ids, size)
    local chunks, current = {}, {}
    for _, id in ipairs(ids or {}) do
        table.insert(current, id)
        if #current >= size then
            table.insert(chunks, current)
            current = {}
        end
    end
    if #current > 0 then table.insert(chunks, current) end
    return chunks
end

local Delivery = require("bookorbit_delivery")

local CatalogBulkDownload = {}

function CatalogBulkDownload.install(Catalog)
    function Catalog:initBulkDownloadState()
        self.bulk_selection_mode = false
        self.bulk_selection_scope_key = nil
        self.bulk_selected_books = {}
        self.bulk_selected_order = {}
        self.bulk_select_all = false
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

    function Catalog:bulkManifestParams(params)
        local manifest = {}
        for _, key in ipairs(MANIFEST_FILTER_KEYS) do
            local value = (params or {})[key]
            if value ~= nil and value ~= "" then manifest[key] = value end
        end
        return manifest
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
        if self.bulk_select_all then return (self.current_context or {}).total or 0 end
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
        self.bulk_select_all = false
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
        self.bulk_select_all = false
        self.bulk_selection_mode = true
        self.bulk_selection_scope_key = self:bulkListScopeKey(self.current_context)
        for _, book in ipairs(self:bulkCurrentPageBooks()) do
            self:bulkSelectBook(book)
        end
        self:updateItems()
    end

    function Catalog:showBulkSelectionActions()
        local count = self:bulkSelectedCount()
        DialogUI.actions{
            title = T(_.ngettext("%1 book selected", "%1 books selected", count), count),
            rows = {
                count > 0 and { icon = "download", label = _("Download selected"), opens = true, run = function()
                    if self.bulk_select_all then return self:confirmBulkAllMatching() end
                    self:confirmBulkBooks(self:bulkSelectedBooks(), _("Selected books"), { clear_selection = true })
                end } or false,
                { icon = "list-checks", label = _("Select this page"), run = function() self:bulkSelectCurrentPage() end },
                count > 0 and { icon = "x", label = _("Clear the selection"), run = function() self:bulkClearSelectedBooks(true) end } or false,
                { icon = "check", label = _("Done selecting"), run = function() self:bulkExitSelectionMode() end },
            },
        }
    end

    -- How read-aloud EPUBs arrive on this device, in a word.
    function Catalog:bulkDeliveryLabel()
        local server_settings = self.client and self.client.delivery_settings
        if not server_settings or server_settings.deviceOverride == nil then return _("BookOrbit default") end
        if server_settings.deviceOverride == "original" then return _("With narration") end
        return _("Text only")
    end

    -- on_done: called once a choice is saved (the sheet that asked redraws).
    function Catalog:showDeliveryPreferenceDialog(on_done)
        self:runConnected(function()
            local current, err = self:fetchDeliveryPreference()
            if err then Toast.error(err); return end
            local server_settings = self.client.delivery_settings
            local selected = server_settings and server_settings.deviceOverride or current
            local uses_default = server_settings and server_settings.deviceOverride == nil
            local variants = { nil, "audioless_epub", "original" }
            DialogUI.choose{
                title = _("Read-aloud EPUBs"),
                sub = _("Saved in BookOrbit for this device. Books already here stay as they are."),
                options = {
                    { label = _("BookOrbit default"), sub = _("Whatever your BookOrbit settings say"), selected = uses_default },
                    { label = _("Text only"), sub = _("Narration taken out, so books stay small"), selected = not uses_default and selected == "audioless_epub" },
                    { label = _("With narration"), sub = _("The audio comes too"), selected = not uses_default and selected == "original" },
                },
                on_pick = function(index)
                    self:runConnected(function()
                        local resolved, save_err = self:fetchDeliveryPreference(variants[index], true)
                        if not resolved then Toast.error(save_err); return end
                        if on_done then on_done() end
                    end)
                end,
            }
        end)
    end

    function Catalog:showBulkDownloadSettings()
        BulkSheet.openPlan(self, { settings_only = true })
    end

    function Catalog:showBulkFormatPresetDialog(on_done)
        local current = self:bulkFormatPreset().id
        local options = {}
        for _, preset in ipairs(FORMAT_PRESETS) do
            table.insert(options, { label = preset.label, selected = current == preset.id })
        end
        DialogUI.choose{
            title = _("Format"),
            sub = _("Which file to take when a book has several"),
            options = options,
            on_pick = function(index)
                self:persistSetting("catalog_bulk_format_preset", FORMAT_PRESETS[index].id)
                if on_done then on_done() end
            end,
        }
    end

    function Catalog:showBulkExistingPolicyDialog(on_done)
        local current = self:bulkExistingPolicy().id
        local options = {}
        for _, policy in ipairs(EXISTING_POLICIES) do
            table.insert(options, { label = policy.label, sub = policy.id == "overwrite" and _("Can move a book's place and highlights") or nil, selected = current == policy.id })
        end
        DialogUI.choose{
            title = _("Files already there"),
            options = options,
            on_pick = function(index)
                self:persistSetting("catalog_bulk_existing_policy", EXISTING_POLICIES[index].id)
                if on_done then on_done() end
            end,
        }
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
        local capabilities = Capabilities.cached(self.client)
        local legacy = capabilities and not capabilities.readAloudDeliveryVariants
        for _, book in ipairs(books or {}) do
            if legacy and self:isOnDevice(book) then
                counts.on_device = counts.on_device + 1
            elseif not self:bulkSupportedFormatHint(book) then
                counts.unsupported = counts.unsupported + 1
            end
        end
        return counts
    end

    -- "Download 345 books".
    function Catalog:bulkDownloadLabel(total)
        return T(_.ngettext("Download %1 book", "Download %1 books", total), total)
    end

    -- The plan sheet for one source: where the books go and how, then Download.
    function Catalog:confirmBulkSource(source)
        if self.bulk_running then
            Toast.show(_("A bulk download is already running."), { icon = "hourglass" })
            return
        end
        if (source.total or 0) == 0 then
            Toast.show(_("No books to download."), { icon = "info" })
            return
        end
        BulkSheet.openPlan(self, {
            sub = source.label,
            scopes = { { label = source.label, source = source } },
            on_download = function(chosen) self:bulkStart(chosen) end,
        })
    end

    -- Download, from the plan sheet: the run starts in this process.
    function Catalog:bulkStart(source)
        self:runConnected(function()
            self:startBulkSource(source)
        end)
    end

    function Catalog:confirmBulkBooks(books, label, opts)
        books = dedupeBooks(books)
        local ids = {}
        for _, book in ipairs(books) do table.insert(ids, book.id) end
        self:refreshOnDevice()
        self:confirmBulkSource({
            kind = "ids",
            label = label,
            total = #books,
            ids = ids,
            books = books,
            known_skips = self:bulkCountKnownSkips(books),
            clear_selection = opts and opts.clear_selection == true,
        })
    end

    function Catalog:confirmBulkCurrentPage()
        self:confirmBulkBooks(self:bulkCurrentPageBooks(), _("Current page"))
    end

    function Catalog:confirmBulkAllMatching()
        if not self:bookMode() then return end
        local context = self.current_context or {}
        self:confirmBulkSource({
            kind = "filter",
            label = context.title or _("Current list"),
            total = context.total or #(context.books or {}),
            params = self:bulkListParams(context),
        })
    end

    function Catalog:bulkSourceKey(source)
        local prefix = source.account_key and (source.account_key .. "|" .. tostring(source.variant) .. "|") or ""
        if source.kind == "ids" then
            return prefix .. "ids|" .. idListKey(source.ids)
        end
        return prefix .. "filter|" .. sortedParamKey(source.params or {})
    end

    function Catalog:startBulkSource(source)
        if self.bulk_running then
            Toast.show(_("A bulk download is already running."), { icon = "hourglass" })
            return
        end

        source.account_key = Delivery.key(self.client)
        local checkpoint = self:bulkOpenCheckpoint():load()
        local pinned_variant
        if checkpoint then
            for _, candidate in ipairs({ "original", "audioless_epub" }) do
                source.variant = candidate
                if checkpoint.source_key == self:bulkSourceKey(source) then pinned_variant = candidate; break end
            end
        end
        local variant, variant_err = self:fetchDeliveryPreference(pinned_variant)
        if variant_err then Toast.error(variant_err); return end
        source.variant = variant
        local ctx = {
            source = source,
            source_key = self:bulkSourceKey(source),
            label = source.label or _("Books"),
            total = source.total or 0,
            page = {},
            page_position = 0,
            position = { page = 1, chunk = 1 },
            next_position = nil,
            id_chunks = source.kind == "ids" and chunkIds(source.ids, ID_CHUNK_SIZE) or nil,
            has_next = true,
            pages_loaded = 0,
            index = 0,
            counts = {
                downloaded = 0,
                linked = 0,
                skipped_on_device = 0,
                skipped_unsupported = 0,
                skipped_existing = 0,
                skipped_present = 0,
                path_conflicts = 0,
                failed = 0,
            },
            pending_links = {},
            pending_matches = {},
            completed = {},
            linked_paths = {},
            failed_books = {},
            failed_titles = {},
            existing_files = {},
            path_conflicts = {},
            destination_paths = {},
            since_checkpoint = 0,
            cancel_requested = false,
            cancelled = false,
            progress_sheet = nil,
            progress_status = nil,
            progress_book = nil,
            progress_shown_at = 0,
        }
        self.bulk_running = true
        self.bulk_ctx = ctx
        UIManager:preventStandby()
        ctx.standby_prevented = true
        if source.clear_selection then
            self:bulkClearSelection(true)
        end
        self:bulkSetProgress(ctx, _("Getting ready…"), true)
        -- Enumeration runs off the UI thread; every continuation stays inside
        -- that boundary so the next step never starts before it finishes.
        UIManager:scheduleIn(STEP_DELAY, function()
            self:runOffThread(function()
                local ok, err = pcall(function()
                    self:bulkPrepare(ctx)
                end)
                if not ok then
                    logger.warn("BookOrbit: bulk download preparation failed", err)
                    self:bulkAbort(ctx, _("Could not prepare bulk download."))
                end
            end)
        end)
    end

    function Catalog:bulkOpenCheckpoint()
        return BulkCheckpoint.open()
    end

    function Catalog:bulkPrepare(ctx)
        Transfer.sweepStale(self:getCurrentDownloadDir())

        local supported = Capabilities.supports(self.client, MANIFEST_FEATURE)
        ctx.use_manifest = supported == true
        if supported == nil then
            logger.dbg("BookOrbit: bulk manifest support unknown, using paged catalog enumeration")
        end

        ctx.checkpoint = self:bulkOpenCheckpoint()
        local resumed = ctx.checkpoint:load()
        if resumed and resumed.source_key == ctx.source_key then
            ctx.resumed = true
            ctx.resumed_completed = resumed.completed or {}
            ctx.linked_paths = resumed.linked_paths or {}
            ctx.position = {
                cursor = resumed.cursor,
                chunk = resumed.chunk_index or 1,
                page = resumed.page_number or 1,
            }
            ctx.manifest_version = resumed.manifest_version
            ctx.index = resumed.processed or 0
            for key, value in pairs(resumed.counts or {}) do
                if ctx.counts[key] ~= nil then ctx.counts[key] = value end
            end
            for _, failure in ipairs(resumed.failures or {}) do
                if #ctx.failed_titles < FAILED_TITLES_LIMIT then
                    table.insert(ctx.failed_titles, failure.title or _("Untitled"))
                end
            end
            self:bulkSetProgress(ctx, _("Resuming previous bulk download..."), true)
        else
            ctx.checkpoint:clear()
        end

        local loaded, err = self:bulkLoadPage(ctx, ctx.position)
        if not loaded then
            logger.warn("BookOrbit: bulk enumeration failed", err)
            self:bulkAbort(ctx, _("Could not load the selected books."))
            return
        end
        if #ctx.page == 0 then
            self:bulkAbort(ctx, _("No books to download."))
            return
        end
        self:bulkQueueStep(ctx)
    end

    -- Loads one page of the run. Returns true on success, or nil plus an error.
    --
    -- ctx.position always names the page currently being processed, and only
    -- ctx.next_position moves ahead, so a checkpoint written mid-page resumes at
    -- that same page instead of skipping past it. Empty pages are followed until
    -- items arrive or enumeration ends, so a page whose rows were all filtered
    -- out cannot end the run early.
    function Catalog:bulkLoadPage(ctx, position)
        local empty_pages = 0
        while true do
            if ctx.pages_loaded >= MAX_ENUMERATION_PAGES then
                ctx.limit_reached = true
                ctx.has_next = false
                ctx.page = {}
                ctx.page_position = 0
                return true
            end
            self:bulkSetProgress(ctx, T(_("Loading list page %1..."), ctx.pages_loaded + 1), true)

            ctx.position = position
            local items, err
            if ctx.use_manifest then
                items, err = self:bulkFetchManifestPage(ctx, position)
            else
                items, err = self:bulkFetchLegacyPage(ctx, position)
            end
            if not items then return nil, err end

            ctx.pages_loaded = ctx.pages_loaded + 1
            ctx.page = dedupeBooks(items)
            ctx.page_position = 0
            if #ctx.page > 0 then return true end

            if not ctx.has_next then return true end
            empty_pages = empty_pages + 1
            if empty_pages >= MAX_EMPTY_PAGES then
                ctx.has_next = false
                return true
            end
            position = ctx.next_position
        end
    end

    function Catalog:bulkFetchManifestPage(ctx, position)
        local params = {}
        if ctx.source.kind == "ids" then
            local chunk = (ctx.id_chunks or {})[position.chunk or 1]
            if not chunk then
                ctx.has_next = false
                return {}
            end
            params.ids = table.concat(chunk, ",")
        else
            params = self:bulkManifestParams(ctx.source.params)
        end
        params.size = PAGE_SIZE
        params.cursor = position.cursor

        params.variant = ctx.source.variant
        local body, err = self.client:catalogManifest(params)
        if not body then
            -- A server that answers the route with "not found" is a confirmed
            -- downgrade; anything else stays a transient failure.
            if err == 404 then
                Capabilities.markUnsupported(self.client, MANIFEST_FEATURE)
                ctx.use_manifest = false
                return self:bulkFetchLegacyPage(ctx, { page = 1 })
            end
            return nil, err
        end

        if body.restartRequired == true then
            -- The server rejected the cursor contract itself; a library change
            -- during the run keeps the cursor and only carries a new version.
            -- Restarting enumeration is safe: books already downloaded are on
            -- device, and files already published validate against the new
            -- manifest, so neither is transferred again.
            logger.dbg("BookOrbit: bulk manifest cursor rejected, restarting enumeration")
            ctx.manifest_version = body.manifestVersion
            BookOrbitStateManager.applyLibraryVersion(body.manifestVersion)
            ctx.restarted = true
            return self:bulkFetchManifestPage(ctx, { chunk = position.chunk })
        end

        ctx.manifest_version = body.manifestVersion
        -- manifestVersion and matchCheck's libraryVersion are the same
        -- server-side token under two names, so the manifest feeds the same
        -- invalidation path instead of only living in the bulk checkpoint.
        BookOrbitStateManager.applyLibraryVersion(body.manifestVersion)
        local has_next = body.hasNext == true and body.nextCursor ~= nil
        if has_next then
            ctx.next_position = { cursor = body.nextCursor, chunk = position.chunk }
        elseif ctx.source.kind == "ids" and (ctx.id_chunks or {})[(position.chunk or 1) + 1] then
            -- Continue with the next bounded id chunk before declaring the run
            -- complete.
            ctx.next_position = { chunk = (position.chunk or 1) + 1 }
            has_next = true
        end
        ctx.has_next = has_next
        return body.items or {}
    end

    -- Legacy enumeration for servers without the manifest capability. Still
    -- page-at-a-time: only the current page is retained.
    function Catalog:bulkFetchLegacyPage(ctx, position)
        local page_number = position.page or 1
        ctx.position = { page = page_number }
        ctx.next_position = { page = page_number + 1 }

        if ctx.source.kind == "ids" then
            local books = ctx.source.books or {}
            local start_index = (page_number - 1) * PAGE_SIZE
            local page = {}
            for offset = 1, PAGE_SIZE do
                local book = books[start_index + offset]
                if not book then break end
                table.insert(page, book)
            end
            ctx.has_next = books[start_index + PAGE_SIZE + 1] ~= nil
            return page
        end

        local query = cloneParams(ctx.source.params or {})
        query.page = page_number
        query.size = PAGE_SIZE
        local body, err = self.client:catalogBooks(query)
        if not body then return nil, err end
        ctx.has_next = body.hasNext == true
        return body.items or {}
    end

    function Catalog:bulkReleaseStandby(ctx)
        if not ctx or not ctx.standby_prevented then return end
        ctx.standby_prevented = false
        UIManager:allowStandby()
    end

    function Catalog:bulkAbort(ctx, message)
        if ctx.progress_sheet then
            ctx.progress_sheet:close()
            ctx.progress_sheet = nil
        end
        self.bulk_running = false
        self.bulk_ctx = nil
        self:bulkReleaseStandby(ctx)
        Toast.error(message)
    end

    -- The run's sheet follows ctx; status is the line under the book, or the
    -- title before the first book. Redraws at most every PROGRESS_THROTTLE
    -- seconds unless forced, so a long run does not flood the e-ink screen.
    function Catalog:bulkSetProgress(ctx, status, force)
        if not ctx then return end
        if status ~= nil then ctx.progress_status = status end
        if not ctx.progress_sheet then
            ctx.progress_sheet = BulkSheet.openProgress(self, ctx)
            ctx.progress_shown_at = os.time()
            UIManager:forceRePaint()
            return
        end
        if not force and os.time() - (ctx.progress_shown_at or 0) < PROGRESS_THROTTLE then return end
        ctx.progress_shown_at = os.time()
        ctx.progress_sheet:update()
        UIManager:forceRePaint()
    end

    function Catalog:bulkShowStatus(ctx, status, book, force)
        ctx.progress_book = book
        self:bulkSetProgress(ctx, status, force == true)
    end

    -- Stop after this book: the run finishes the file it is on.
    function Catalog:bulkRequestStop(ctx)
        if not ctx or ctx.cancel_requested then return end
        ctx.cancel_requested = true
        self:bulkSetProgress(ctx, _("Stopping after this book…"), true)
    end

    function Catalog:bulkQueueStep(ctx)
        if ctx ~= self.bulk_ctx then return end
        if ctx.cancel_requested then
            ctx.cancelled = true
            self:bulkFinishRun(ctx)
            return
        end

        local book = ctx.page[ctx.page_position + 1]
        if not book then
            self:bulkAdvancePage(ctx)
            return
        end
        ctx.page_position = ctx.page_position + 1
        ctx.index = ctx.index + 1

        -- Detail, match and transfer requests inside bulkProcessBook run in a
        -- subprocess, so the whole item, including scheduling the next one, has
        -- to complete inside this off-thread boundary.
        self:runOffThread(function()
            local ok, err = pcall(function()
                self:bulkProcessBook(ctx, book)
            end)
            if not ok then
                logger.warn("BookOrbit: bulk download item failed", err)
                self:bulkRecordFailure(ctx, book)
            end

            if ctx ~= self.bulk_ctx then return end
            self:bulkFlushLinks(ctx, false)
            self:bulkMaybeCheckpoint(ctx)

            if ctx.cancel_requested then
                ctx.cancelled = true
                self:bulkFinishRun(ctx)
                return
            end

            UIManager:scheduleIn(NEXT_ITEM_DELAY, function()
                self:bulkQueueStep(ctx)
            end)
        end)
    end

    -- A page boundary is the natural commit point: links flush, the on-device
    -- maps reconcile once, and the checkpoint advances to the next cursor.
    function Catalog:bulkAdvancePage(ctx)
        self:runOffThread(function()
            self:bulkFlushLinks(ctx, true)
            ctx.completed = {}
            ctx.linked_paths = {}
            ctx.resumed_completed = nil
            ctx.position = ctx.next_position or {}
            self:bulkCommitCheckpoint(ctx)

            if not ctx.has_next then
                self:bulkFinishRun(ctx)
                return
            end

            local loaded, err = self:bulkLoadPage(ctx, ctx.position)
            if not loaded then
                logger.warn("BookOrbit: bulk enumeration failed", err)
                self:bulkRecordEnumerationFailure(ctx, err)
                self:bulkFinishRun(ctx)
                return
            end
            if #ctx.page == 0 then
                self:bulkFinishRun(ctx)
                return
            end
            if ctx ~= self.bulk_ctx then return end
            UIManager:scheduleIn(NEXT_ITEM_DELAY, function()
                self:bulkQueueStep(ctx)
            end)
        end)
    end

    function Catalog:bulkRecordEnumerationFailure(ctx, err)
        ctx.enumeration_error = err or true
    end

    function Catalog:bulkResolveDestination(ctx, detail, file, book_id)
        local filename = safeFilenameBase(detail)
        local filetype = string.lower(file.format or "bin")
        local local_path = self:getLocalDownloadPath(filename, filetype, file.devicePath)
        local original_path = local_path
        local owner = ctx.destination_paths[pathKey(local_path)]
        if owner and owner.book_id ~= book_id then
            local identity = book_id or file.id
            local candidate = appendPathIdentity(local_path, identity)
            local suffix = 2
            while ctx.destination_paths[pathKey(candidate)] or lfs.attributes(candidate) do
                candidate = appendPathIdentity(local_path, tostring(identity) .. "-" .. tostring(suffix))
                suffix = suffix + 1
            end
            local_path = candidate
            ctx.counts.path_conflicts = ctx.counts.path_conflicts + 1
            table.insert(ctx.path_conflicts, {
                book_id = book_id,
                title = bookTitle(detail),
                original_path = original_path,
                resolved_path = local_path,
                conflicting_book_id = owner.book_id,
            })
            logger.warn("BookOrbit: bulk destination path conflict renamed", book_id, owner.book_id, original_path, local_path)
            self:bulkShowStatus(ctx, _("Path conflict - using unique filename"), detail, true)
        end
        return local_path
    end

    -- Restart validation: a destination this run already published is accepted
    -- only when its size and content hash still match the manifest.
    function Catalog:bulkValidatePublished(ctx, path, file, book_id, recorded)
        if not path then return false end
        local size = lfs.attributes(path, "size")
        if not size then return false end
        local expected_size, expected_hash = file.sizeBytes, file.fileHash
        if type(recorded) == "table" then
            if recorded.selection ~= file.selection or recorded.file_id ~= file.id then return false end
            expected_size, expected_hash = recorded.size, recorded.hash
        end
        if expected_size and expected_size > 0 and size ~= expected_size then return false end
        if not expected_hash then return false end
        local hashed, digest = pcall(util.partialMD5, path)
        if not hashed or digest ~= expected_hash then return false end
        self:bulkQueueLink(ctx, {
            digest = digest,
            bookId = book_id,
            bookFileId = file.id,
            file = path,
        })
        return true
    end

    function Catalog:bulkProcessBook(ctx, book)
        self:bulkShowStatus(ctx, _("Checking book..."), book, ctx.index % 5 == 0)

        if not (ctx.source and ctx.source.variant) and self:isOnDevice(book) then
            ctx.counts.skipped_on_device = ctx.counts.skipped_on_device + 1
            self:bulkShowStatus(ctx, _("Already on device - skipping"), book, ctx.index % 5 == 0)
            return
        end
        if not self:bulkSupportedFormatHint(book) then
            ctx.counts.skipped_unsupported = ctx.counts.skipped_unsupported + 1
            self:bulkShowStatus(ctx, _("No supported format - skipping"), book, true)
            return
        end

        local detail = book
        if not book.files then
            -- Only reached on a server without the manifest capability.
            self:bulkShowStatus(ctx, _("Loading book details..."), book, true)
            local body, err = self.client:catalogBook(book.id, ctx.source.variant)
            if not body then
                logger.warn("BookOrbit: bulk detail fetch failed", book.id, err)
                self:bulkRecordFailure(ctx, book)
                self:bulkShowStatus(ctx, _("Could not load book details"), book, true)
                return
            end
            detail = body
            if not (ctx.source and ctx.source.variant) and self:isOnDevice(detail) then
                ctx.counts.skipped_on_device = ctx.counts.skipped_on_device + 1
                self:bulkShowStatus(ctx, _("Already on device - skipping"), detail, true)
                return
            end
        end

        local file = self:bulkChooseFile(detail, ctx.resumed)
        if not file and #self:supportedFiles(detail) > 0 then
            ctx.counts.skipped_on_device = ctx.counts.skipped_on_device + 1
            self:bulkShowStatus(ctx, _("Already on device - skipping"), detail, true)
            return
        end
        if not file then
            ctx.counts.skipped_unsupported = ctx.counts.skipped_unsupported + 1
            self:bulkShowStatus(ctx, _("No supported format - skipping"), detail, true)
            return
        end

        local book_id = detail.id or book.id
        local local_path = self:bulkResolveDestination(ctx, detail, file, book_id)

        if ctx.resumed then
            local recorded = ctx.resumed_completed and ctx.resumed_completed[tostring(book_id)]
            local recorded_path = type(recorded) == "table" and recorded.path or recorded
            for candidate_index, candidate in ipairs({ recorded_path or local_path, local_path }) do
                if self:bulkValidatePublished(ctx, candidate, file, book_id, candidate == recorded_path and recorded or nil) then
                    ctx.counts.skipped_present = ctx.counts.skipped_present + 1
                    ctx.destination_paths[pathKey(candidate)] = { book_id = book_id, file_id = file.id }
                    ctx.completed[tostring(book_id)] = recorded or candidate
                    self:bulkShowStatus(ctx, _("Already downloaded - skipping"), detail, true)
                    return
                end
            end
        end

        if lfs.attributes(local_path) and self:bulkExistingPolicy().id == "skip" then
            ctx.counts.skipped_existing = ctx.counts.skipped_existing + 1
            table.insert(ctx.existing_files, { book_id = book_id, title = bookTitle(detail), path = local_path })
            logger.warn("BookOrbit: existing destination skipped", book_id, local_path)
            self:bulkShowStatus(ctx, _("File already exists - skipping"), detail, true)
            return
        end

        local ok = self:bulkDownloadFile(ctx, detail, file, local_path, book_id)
        if not ok then
            self:bulkRecordFailure(ctx, book)
            self:bulkShowStatus(ctx, _("Download failed"), detail, true)
            return
        end
        ctx.counts.downloaded = ctx.counts.downloaded + 1
        ctx.destination_paths[pathKey(local_path)] = { book_id = book_id, file_id = file.id }
        if file.selection then
            local hashed, digest = pcall(util.partialMD5, local_path)
            ctx.completed[tostring(book_id)] = {
                path = local_path, selection = file.selection, file_id = file.id,
                size = lfs.attributes(local_path, "size"), hash = hashed and digest or nil,
            }
        else
            ctx.completed[tostring(book_id)] = local_path
        end
        self:bulkShowStatus(ctx, _("Download complete"), detail, true)
    end

    function Catalog:bulkChooseFile(detail, validate_present)
        local files = self:supportedFiles(detail)
        if #files == 0 then return nil end

        for _, format in ipairs(self:bulkFormatPreset().order) do
            local wanted = string.lower(format)
            for _, file in ipairs(files) do
                local file_format = string.lower(file.format or "")
                if file_format == wanted and (validate_present or not self:onDeviceFilePath(file)) then
                    return file
                end
            end
        end
        for _, file in ipairs(files) do
            if validate_present or not self:onDeviceFilePath(file) then
                return file
            end
        end
        return nil
    end

    function Catalog:bulkDownloadFile(ctx, detail, file, local_path, book_id)
        local total = file.sizeBytes
        local last_bucket = -1
        local function onProgress(received)
            if ctx ~= self.bulk_ctx then return end
            local status, bucket
            if total and total > 0 then
                local pct = math.min(100, math.floor((received or 0) / total * 100))
                bucket = math.floor(pct / 5)
                if bucket == last_bucket then return end
                status = T(_("Downloading - %1"), pct .. "%")
            else
                bucket = math.floor((received or 0) / (256 * 1024))
                if bucket == last_bucket then return end
                status = T(_("Downloading - %1"), formatBytes(received or 0))
            end
            last_bucket = bucket
            self:bulkShowStatus(ctx, status, detail, true)
        end

        self:bulkShowStatus(ctx, _("Downloading..."), detail, true)
        -- The shared counter only supplies a unique progress generation here;
        -- Stopping after the current file still publishes that file. Only a
        -- finished or replaced run must discard an outstanding result.
        local generation = self:nextDownloadGeneration()
        local ok, err, result = Transfer.run{
            root = self:getCurrentDownloadDir(),
            destination = local_path,
            generation = generation,
            expected_bytes = total,
            expected_hash = file.fileHash,
            hash = "partial_md5",
            on_progress = onProgress,
            is_current = function()
                return ctx == self.bulk_ctx
            end,
            perform = function(download_opts)
                download_opts.variant = file.selection and (file.requestedVariant or file.downloadVariant) or nil
                download_opts.selection = file.selection
                return self.client:downloadCatalogFile(file.id, local_path, download_opts)
            end,
        }
        if not ok then
            logger.warn("BookOrbit: bulk file download failed", book_id, file.id, err)
            return false
        end

        if file.selection then
            local variants = self.settings.catalog_downloaded_variants or {}
            variants[Delivery.key(self.client) .. "|" .. tostring(file.id) .. "|" .. file.downloadVariant] = { path = local_path, selection = file.selection }
            self.settings.catalog_downloaded_variants = variants
            ctx.delivery_markers_dirty = true
        end
        local digest = result and result.hash
        if digest and file.fileHash and digest == file.fileHash then
            -- The manifest hash is the digest local match state keys on, so a
            -- verified download needs no match request at all.
            self:bulkQueueLink(ctx, {
                digest = digest,
                bookId = book_id,
                bookFileId = file.id,
                file = local_path,
            })
            return true
        end

        self:bulkQueueMatch(ctx, { digest = digest, file = local_path, bookFileId = file.id })
        return true
    end

    function Catalog:bulkQueueLink(ctx, entry)
        table.insert(ctx.pending_links, entry)
    end

    function Catalog:bulkQueueMatch(ctx, entry)
        local digest = entry.digest
        if not digest then
            local hashed, computed = pcall(util.partialMD5, entry.file)
            digest = hashed and computed or nil
        end
        if not digest then
            logger.warn("BookOrbit: downloaded file partial MD5 failed", entry.file)
            return
        end
        table.insert(ctx.pending_matches, {
            digest = digest,
            file = entry.file,
            bookFileId = entry.bookFileId,
        })
    end

    -- Applies queued links in one state flush and resolves the remainder with a
    -- single bounded match check, instead of one request and one flush per file.
    function Catalog:bulkFlushLinks(ctx, force)
        local pending = #ctx.pending_links + #ctx.pending_matches
        if not force and pending < LINK_BATCH_SIZE then return end
        if ctx.delivery_markers_dirty then
            self:persistSetting("catalog_downloaded_variants", self.settings.catalog_downloaded_variants)
            ctx.delivery_markers_dirty = false
        end
        if pending == 0 then return end

        local links = ctx.pending_links
        local matches = ctx.pending_matches
        ctx.pending_links = {}
        ctx.pending_matches = {}

        if #matches > 0 then
            local hashes, candidates = {}, {}
            for _, entry in ipairs(matches) do
                table.insert(hashes, entry.digest)
                candidates[entry.digest] = {
                    source = "file",
                    book_file_id = entry.bookFileId,
                }
            end
            local body, err = self.client:matchCheck(hashes, candidates)
            if not body then
                logger.warn("BookOrbit: bulk match check failed", err)
            else
                BookOrbitStateManager.applyLibraryVersion(body.libraryVersion)
            end
            local matched = {}
            for _, match in ipairs((body or {}).matches or {}) do
                matched[match.hash] = match
            end
            local unmatched_digests, unmatched_files = {}, {}
            for _, entry in ipairs(matches) do
                local match = matched[entry.digest]
                if match then
                    table.insert(links, {
                        digest = entry.digest,
                        bookId = match.bookId,
                        bookFileId = match.bookFileId,
                        file = entry.file,
                    })
                elseif body then
                    table.insert(unmatched_digests, entry.digest)
                    table.insert(unmatched_files, entry.file)
                end
            end
            if #unmatched_digests > 0 then
                BookOrbitStateManager.mutateScoped({
                    digests = unmatched_digests,
                    files = unmatched_files,
                    global = false,
                }, function(state)
                    for index, digest in ipairs(unmatched_digests) do
                        state:rememberFile(unmatched_files[index], digest)
                        state:setUnmatched(digest)
                    end
                end)
            end
        end

        if #links > 0 then
            BookOrbitStateManager.linkFiles(links)
            ctx.linked_paths = ctx.linked_paths or {}
            for _, link in ipairs(links) do
                if not ctx.linked_paths[link.file] then
                    ctx.counts.linked = ctx.counts.linked + 1
                    ctx.linked_paths[link.file] = true
                end
            end
            self:refreshOnDevice()
            if self.markStackDirty then self:markStackDirty() end
        end
    end

    function Catalog:bulkMaybeCheckpoint(ctx)
        ctx.since_checkpoint = (ctx.since_checkpoint or 0) + 1
        if ctx.since_checkpoint < CHECKPOINT_EVERY then return end
        self:bulkCommitCheckpoint(ctx)
    end

    function Catalog:bulkCommitCheckpoint(ctx)
        if not ctx.checkpoint then return end
        ctx.since_checkpoint = 0
        local position = ctx.position or {}
        local failures = {}
        for index, book in ipairs(ctx.failed_books) do
            if index > BulkCheckpoint.MAX_FAILURES then break end
            table.insert(failures, { id = book.id, title = shortText(bookTitle(book), 60) })
        end
        local saved, err = ctx.checkpoint:save({
            source_key = ctx.source_key,
            label = ctx.label,
            manifest_version = ctx.manifest_version,
            cursor = position.cursor,
            chunk_index = position.chunk,
            page_number = position.page,
            processed = ctx.index,
            completed = ctx.completed,
            linked_paths = ctx.linked_paths,
            counts = ctx.counts,
            failures = failures,
        })
        if not saved then
            logger.warn("BookOrbit: bulk checkpoint save failed", err)
        end
    end

    function Catalog:bulkRecordFailure(ctx, book)
        ctx.counts.failed = ctx.counts.failed + 1
        table.insert(ctx.failed_books, book)
        if #ctx.failed_titles < FAILED_TITLES_LIMIT then
            table.insert(ctx.failed_titles, shortText(bookTitle(book), 60))
        end
    end

    function Catalog:bulkFinishRun(ctx)
        local ok, err = pcall(function()
            self:bulkFlushLinks(ctx, true)
        end)
        if not ok then
            logger.warn("BookOrbit: bulk link flush failed", err)
        end
        if ctx.checkpoint then
            if ctx.cancelled or ctx.enumeration_error then
                self:bulkCommitCheckpoint(ctx)
            else
                ctx.checkpoint:clear()
            end
        end
        self:bulkFinish(ctx)
    end

    -- What a run came to, as plain data for the sheet: the counts that are
    -- not zero, what needs attention, and the books that failed.
    function Catalog:bulkSummary(ctx)
        local counts = ctx.counts
        local summary = {
            stopped = ctx.cancelled == true,
            title = ctx.cancelled and _("Bulk download stopped") or _("Bulk download complete"),
            sub = ctx.label,
            rows = { { label = _("Downloaded"), value = counts.downloaded } },
            notes = {},
            failed_titles = ctx.failed_titles or {},
            more_failed = math.max(0, #(ctx.failed_books or {}) - #(ctx.failed_titles or {})),
            can_retry = #(ctx.failed_books or {}) > 0,
        }
        local function add(label, value)
            if (value or 0) > 0 then table.insert(summary.rows, { label = label, value = value }) end
        end
        add(_("Linked for sync"), counts.linked)
        add(_("Already on this device"), counts.skipped_on_device)
        add(_("Already downloaded"), counts.skipped_present)
        add(_("Kept a file not from BookOrbit"), counts.skipped_existing)
        add(_("Saved under a new name"), counts.path_conflicts)
        add(_("No format this reader opens"), counts.skipped_unsupported)
        add(_("Failed"), counts.failed)
        if ctx.limit_reached then
            table.insert(summary.notes, T(_("Stopped at the %1 page enumeration limit. Run it again to continue."), MAX_ENUMERATION_PAGES))
        end
        if ctx.enumeration_error then
            table.insert(summary.notes, _("The book list could not be loaded to the end. Run it again to continue."))
        end
        if #(ctx.path_conflicts or {}) > 0 then
            table.insert(summary.notes, _("Books whose file names clashed were saved with their BookOrbit ID added."))
        end
        local existing = ctx.existing_files or {}
        if #existing > 0 then
            local titles = {}
            for index, entry in ipairs(existing) do
                if index > 3 then break end
                table.insert(titles, shortText(entry.title, 40))
            end
            local list = table.concat(titles, ", ")
            if #existing > 3 then list = T(_("%1, and %2 more"), list, #existing - 3) end
            table.insert(summary.notes, T(_("Files not from BookOrbit were already there and were kept: %1"), list))
        end
        return summary
    end

    function Catalog:bulkFinish(ctx)
        self:bulkReleaseStandby(ctx)
        self.bulk_running = false
        self.bulk_ctx = nil
        self:refreshOnDevice()
        if self.markStackDirty then self:markStackDirty() end
        if self.updateItems and (self:bookMode() or self:dashboardMode()) then
            self:updateItems()
        end

        local summary = self:bulkSummary(ctx)
        summary.on_retry = function() self:confirmBulkBooks(ctx.failed_books, _("Failed downloads")) end
        local sheet = ctx.progress_sheet
        ctx.progress_sheet = nil
        if not sheet or sheet.closed then sheet = BulkSheet.openProgress(self, ctx) end
        sheet:finished(summary)
    end
end

return CatalogBulkDownload
