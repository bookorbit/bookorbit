--[[--
Download manager mixin for the BookOrbit catalog browser.

Installs the file-choice, download, link-to-sync and open-file methods onto the
catalog controller. Downloads stay foreground with live byte/percent progress
(a deliberate user action), unlike navigation which runs off the UI thread.
]]

local UIManager = require("ui/uimanager")
local lfs = require("libs/libkoreader-lfs")
local logger = require("logger")
local util = require("util")
local T = require("ffi/util").template
local _ = require("gettext")

local BookOrbitStateManager = require("bookorbit_state_manager")
local CatalogUtil = require("bookorbit_catalog_util")
local DownloadRoot = require("bookorbit_download_root")
local Transfer = require("bookorbit_download_transfer")
local Delivery = require("bookorbit_delivery")
local DownloadSheet = setmetatable({}, { __index = function(_t, key) return require("bookorbit_download_sheet")[key] end })
-- Loaded on first use: specs load this module without KOReader's widgets.
local Toast = setmetatable({}, { __index = function(_t, key) return require("bookorbit_toast")[key] end })

local formatBytes = CatalogUtil.formatBytes
local safeFilenameBase = CatalogUtil.safeFilenameBase

local CatalogDownload = {}

local function sanitizeDevicePath(device_path, download_dir)
    local normalized = tostring(device_path or ""):gsub("\\", "/"):gsub("^/+", "")
    local segments = {}
    for segment in normalized:gmatch("[^/]+") do
        if segment == ".." then return nil end
        if segment ~= "." then
            local safe_segment = util.getSafeFilename(segment, download_dir)
            if not safe_segment or safe_segment == "" or safe_segment == "." or safe_segment == ".." then return nil end
            table.insert(segments, safe_segment)
        end
    end
    if #segments == 0 then return nil end
    return table.concat(segments, "/")
end

local function joinDownloadPath(download_dir, relative_path)
    return (download_dir ~= "/" and download_dir or "") .. "/" .. relative_path
end

local function resolveRelativeDownloadPath(download_dir, filename, filetype, device_path, filename_override)
    local relative = sanitizeDevicePath(device_path, download_dir)
    if relative and not filename_override then return relative end

    local parent = relative and relative:match("^(.*)/[^/]+$")
    local safe_filename = util.getSafeFilename(filename .. "." .. string.lower(filetype or "bin"), download_dir)
    return parent and parent ~= "" and parent .. "/" .. safe_filename or safe_filename
end

local function splitDownloadPreview(download_dir, relative_path, filetype)
    local parent, filename = relative_path:match("^(.*)/([^/]+)$")
    local folder = parent and parent ~= "" and joinDownloadPath(download_dir, parent) or download_dir
    filename = filename or relative_path
    local extension = "." .. string.lower(filetype or "bin")
    if filename:sub(-#extension):lower() == extension then
        filename = filename:sub(1, #filename - #extension)
    end
    return folder, filename
end

function CatalogDownload.install(Catalog)
    function Catalog:fetchDeliveryPreference(variant, update)
        local message = update and _("Saving EPUB delivery preference...") or _("Loading EPUB delivery preference...")
        local body, err = self:fetch(message, function()
            local resolved, resolve_err
            if update then resolved, resolve_err = Delivery.update(self.settings, self.client, variant)
            else resolved, resolve_err = Delivery.resolve(self.settings, self.client, variant) end
            if resolve_err then return nil, resolve_err end
            -- Only returned values cross the fork; apply settings and caches in the parent.
            return {
                variant = resolved,
                delivery_settings = self.client.delivery_settings,
                profiles = self.settings.catalog_delivery_profiles,
                server_profiles = self.settings.catalog_delivery_server_profiles,
            }
        end)
        if not body then return nil, err end
        self.client.delivery_settings = body.delivery_settings
        if body.profiles then self:persistSetting("catalog_delivery_profiles", body.profiles) end
        if body.server_profiles then self:persistSetting("catalog_delivery_server_profiles", body.server_profiles) end
        return body.variant
    end

    function Catalog:fetchDeliveryBook(book_id, override, message)
        local variant, err = self:fetchDeliveryPreference(override)
        if err then return nil, err end
        return self:fetch(message or _("Loading book..."), function()
            return self.client:catalogBook(book_id, variant)
        end)
    end

    function Catalog:changeDownloadVariant(detail, file, use_default)
        local variant = file.downloadVariant == "original" and "audioless_epub" or "original"
        if use_default then variant = nil end
        DownloadSheet.open(self, detail, { file = file, variant = variant })
    end

    -- A book with several files: the download sheet lists them. One file
    -- opens or downloads straight away.
    function Catalog:showFileChoices(detail)
        local files = self:supportedFiles(detail)
        if #files == 0 then
            Toast.error(_("No file this reader can open"))
            return
        end
        if #files == 1 then
            local path = self:onDeviceFilePath(files[1])
            if path then
                self:openDownloadedFile(path)
            else
                self:downloadDefaultFile(detail, files[1])
            end
            return
        end
        DownloadSheet.open(self, detail)
    end

    function Catalog:getCurrentDownloadDir()
        return DownloadRoot.get()
    end

    -- Single and bulk downloads share one destination, KOReader's own
    -- download_dir, so the chooser is shared too rather than each dialog
    -- keeping its own idea of where files land.
    function Catalog:chooseDownloadDir(on_chosen)
        require("ui/downloadmgr"):new{
            onConfirm = function(path)
                logger.dbg("BookOrbit: download folder set to", path)
                if self._manager and self._manager.ui and self._manager.ui.folder_shortcuts
                    and self._manager.ui.folder_shortcuts.updateShortcut then
                    self._manager.ui.folder_shortcuts:updateShortcut("download_dir", path)
                end
                G_reader_settings:saveSetting("download_dir", path)
                G_reader_settings:flush()
                if on_chosen then
                    UIManager:nextTick(function()
                        on_chosen(path)
                    end)
                end
            end,
        }:chooseDir(self:getCurrentDownloadDir())
    end

    function Catalog:getLocalDownloadPath(filename, filetype, device_path, filename_override)
        local download_dir = self:getCurrentDownloadDir()
        local relative = resolveRelativeDownloadPath(download_dir, filename, filetype, device_path, filename_override)
        local parent = relative:match("^(.*)/[^/]+$")
        if parent and parent ~= "" then util.makePath(joinDownloadPath(download_dir, parent)) end
        return joinDownloadPath(download_dir, relative)
    end

    function Catalog:getLocalDownloadPreview(filename, filetype, device_path, filename_override)
        local download_dir = self:getCurrentDownloadDir()
        local relative = resolveRelativeDownloadPath(download_dir, filename, filetype, device_path, filename_override)
        return splitDownloadPreview(download_dir, relative, filetype)
    end

    function Catalog:downloadDefaultFile(detail, file)
        local filename = safeFilenameBase(detail)
        local filetype = string.lower(file.format or "bin")
        local local_path = self:getLocalDownloadPath(filename, filetype, file.devicePath)
        self:checkDownloadFile(local_path, detail, file)
    end

    function Catalog:showDownloadOptions(detail)
        DownloadSheet.open(self, detail)
    end

    function Catalog:showDownloadDialog(detail, file, initial_filename_override)
        DownloadSheet.open(self, detail, { file = file, filename = initial_filename_override })
    end

    -- A file already at the path opens the download sheet, which says so and
    -- asks before replacing it.
    function Catalog:checkDownloadFile(local_path, detail, file)
        if lfs.attributes(local_path) then
            DownloadSheet.open(self, detail, { file = file })
            return
        end
        UIManager:nextTick(function()
            self:downloadFile(local_path, detail, file)
        end)
    end

    -- Cancelling bumps the generation. The child keeps running until its socket
    -- work ends, but its result is discarded and its temporary file removed, so
    -- a late completion can never publish over a cancelled download.
    function Catalog:nextDownloadGeneration()
        self.download_generation = (self.download_generation or 0) + 1
        return self.download_generation
    end

    function Catalog:downloadProgressText(filename, received, total)
        if total and total > 0 then
            local pct = math.min(100, math.floor(received / total * 100))
            return T(_("Downloading:\n%1\n\n%2"), filename, pct .. "%"), math.floor(pct / 5)
        end
        return T(_("Downloading:\n%1\n\n%2"), filename, formatBytes(received)),
            math.floor(received / (256 * 1024))
    end

    -- ui: the download sheet's reporter. Without one, a download started
    -- from the book's own page fills that page's button; anywhere else the
    -- download sheet opens to show it.
    function Catalog:downloadFile(local_path, detail, file, ui)
        local total = file.sizeBytes
        local root = self:getCurrentDownloadDir()
        local generation = self:nextDownloadGeneration()
        Transfer.sweepStale(root)

        local in_button = not ui and self.detailShowDownloadProgress ~= nil and self:detailShowDownloadProgress(detail, 0, total) == true
        if not ui and not in_button then
            local sheet = DownloadSheet.open(self, detail, { file = file, progress = true })
            ui = sheet and DownloadSheet.reporter(sheet) or nil
        end

        local last_bucket = -1
        local function onProgress(received)
            -- A poll that lands after cancellation must not resurrect the
            -- progress the user just dismissed.
            if self.download_generation ~= generation then return end
            local bucket = select(2, self:downloadProgressText("", received or 0, total))
            if bucket == last_bucket then return end
            last_bucket = bucket
            if in_button then
                -- The page moved on: the download goes on, and says when it is done.
                if not self:detailShowDownloadProgress(detail, received or 0, total) then in_button = false end
                return
            end
            if ui then ui.progress(received or 0, total) end
        end

        self:runOffThread(function()
            local ok, err = Transfer.run{
                root = root,
                destination = local_path,
                generation = generation,
                expected_bytes = total,
                expected_hash = file.fileHash,
                hash = "partial_md5",
                on_progress = onProgress,
                is_current = function()
                    return self.download_generation == generation
                end,
                perform = function(download_opts)
                    download_opts.variant = file.selection and (file.requestedVariant or file.downloadVariant) or nil
                    download_opts.selection = file.selection
                    return self.client:downloadCatalogFile(file.id, local_path, download_opts)
                end,
            }
            if in_button then self:detailShowDownloadProgress(detail, nil, nil, true) end
            if not ok then
                if ui then return ui.finished(false, err) end
                if err == "cancelled" then return end
                self:showRetry(err, function()
                    if err == 409 and file.selection then
                        return self:runConnected(function()
                            local selected, refresh_err = self:fetchDeliveryBook(detail.id, file.requestedVariant or file.downloadVariant)
                            if not selected then
                                if refresh_err ~= "cancelled" then self:showWriteError(refresh_err) end
                                return
                            end
                            for _, candidate in ipairs(selected.files or {}) do
                                if candidate.id == file.id then
                                    if self.current_context and self.current_context.detail
                                            and self.current_context.detail.id == detail.id then
                                        self.current_context.detail = selected
                                        self:refreshDetailView()
                                    end
                                    return self:checkDownloadFile(local_path, selected, candidate)
                                end
                            end
                            self:showWriteError(404)
                        end)
                    end
                    self:downloadFile(local_path, detail, file)
                end)
                return
            end

            if file.selection then
                local variants = self.settings.catalog_downloaded_variants or {}
                variants[Delivery.key(self.client) .. "|" .. tostring(file.id) .. "|" .. file.downloadVariant] = { path = local_path, selection = file.selection }
                self:persistSetting("catalog_downloaded_variants", variants)
            end
            local linked = self:linkDownloadedFile(local_path, file)
            if linked then
                self:refreshOnDevice()
                if self.markStackDirty then self:markStackDirty() end
                local on_catalog_page = (self.bookMode and self:bookMode())
                    or (self.dashboardMode and self:dashboardMode())
                if self.detailMode and self:detailMode() then
                    self:refreshDetailView()
                elseif self.updateItems and on_catalog_page then
                    self:updateItems()
                end
            end
            if ui then return ui.finished(true, nil, local_path, linked) end
            -- The page itself turns to Start reading; a short note is enough.
            if self.detailMode and self:detailMode() and not linked then
                self:refreshOnDevice()
                self:refreshDetailView()
            end
            Toast.show(_("Downloaded"))
        end)
    end

    function Catalog:linkDownloadedFile(local_path, file)
        local ok, digest = pcall(util.partialMD5, local_path)
        if not ok or not digest then
            logger.warn("BookOrbit: downloaded file partial MD5 failed", local_path)
            return false
        end

        local candidate = { source = "file" }
        if file and file.id then
            candidate.book_file_id = file.id
        end
        local body, err = self.client:matchCheck({ digest }, { [digest] = candidate })
        if not body then
            logger.warn("BookOrbit: downloaded file match-check failed", err)
            return false
        end
        BookOrbitStateManager.applyLibraryVersion(body.libraryVersion)

        for _, match in ipairs(body.matches or {}) do
            if match.hash == digest then
                -- Patches the cached on-device maps forward instead of forcing
                -- a full matched-library rescan per downloaded file.
                BookOrbitStateManager.linkFile(digest, match.bookFileId, match.bookId, local_path)
                return true
            end
        end
        BookOrbitStateManager.mutateScoped({
            digests = { digest },
            files = { local_path },
            global = false,
        }, function(state)
            state:rememberFile(local_path, digest)
            state:setUnmatched(digest)
        end)
        return false
    end

    function Catalog:openDownloadedFile(local_path)
        if type(local_path) ~= "string" or lfs.attributes(local_path, "mode") ~= "file" then
            self:updateItems(nil, true)
            Toast.error(_("This book is not on this device. Connect to BookOrbit to download it."))
            return
        end
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
            Toast.show(_("Downloaded"))
        end
    end
end

return CatalogDownload
