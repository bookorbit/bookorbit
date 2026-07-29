--[[--
Download manager mixin for the BookOrbit catalog browser.

Installs the file-choice, download, link-to-sync and open-file methods onto the
catalog controller. Downloads stay foreground with live byte/percent progress
(a deliberate user action), unlike navigation which runs off the UI thread.
]]

local BD = require("ui/bidi")
local ButtonDialog = require("ui/widget/buttondialog")
local ConfirmBox = require("ui/widget/confirmbox")
local InfoMessage = require("ui/widget/infomessage")
local InputDialog = require("ui/widget/inputdialog")
local Notification = require("ui/widget/notification")
local UIManager = require("ui/uimanager")
local lfs = require("libs/libkoreader-lfs")
local logger = require("logger")
local util = require("util")
local T = require("ffi/util").template
local _ = require("gettext")

local BookOrbitStateManager = require("bookorbit_state_manager")
local CatalogUtil = require("bookorbit_catalog_util")
local Transfer = require("bookorbit_download_transfer")

local formatBytes = CatalogUtil.formatBytes
local safeFilenameBase = CatalogUtil.safeFilenameBase

local CatalogDownload = {}

local function sanitizeDevicePath(device_path)
    local normalized = tostring(device_path or ""):gsub("\\", "/"):gsub("^/+", "")
    local segments = {}
    for segment in normalized:gmatch("[^/]+") do
        if segment == ".." then return nil end
        if segment ~= "." then table.insert(segments, segment) end
    end
    if #segments == 0 then return nil end
    return table.concat(segments, "/")
end

local function joinDownloadPath(download_dir, relative_path)
    return (download_dir ~= "/" and download_dir or "") .. "/" .. relative_path
end

local function resolveRelativeDownloadPath(download_dir, filename, filetype, device_path, filename_override)
    local relative = sanitizeDevicePath(device_path)
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
    function Catalog:showFileChoices(detail)
        local files = self:supportedFiles(detail)

        if #files == 0 then
            UIManager:show(InfoMessage:new{ text = _("No KOReader-supported file found."), timeout = 3 })
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

        local dialog
        local buttons = {}
        local open_tpl = _("Open - %1")
        local download_tpl = _("Download - %1")
        for index, file in ipairs(files) do
            local path = self:onDeviceFilePath(file)
            local label = self:fileLabel(file, false)
            table.insert(buttons, {
                {
                    text = path and T(open_tpl, label) or T(download_tpl, label),
                    callback = function()
                        UIManager:close(dialog)
                        if path then
                            self:openDownloadedFile(path)
                        else
                            self:downloadDefaultFile(detail, file)
                        end
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

    function Catalog:getCurrentDownloadDir()
        return G_reader_settings:readSetting("download_dir") or G_reader_settings:readSetting("lastdir")
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
        for index, file in ipairs(files) do
            local label = self:fileLabel(file, false)
            table.insert(buttons, {
                {
                    text = T(_("Options - %1"), label),
                    callback = function()
                        UIManager:close(dialog)
                        self:showDownloadDialog(detail, file)
                    end,
                },
            })
        end
        dialog = ButtonDialog:new{
            title = _("Download options"),
            buttons = buttons,
        }
        UIManager:show(dialog)
    end

    function Catalog:showDownloadDialog(detail, file, initial_filename_override)
        local filename = initial_filename_override or safeFilenameBase(detail)
        local filetype = string.lower(file.format or "bin")
        local filename_overridden = initial_filename_override ~= nil

        local folder
        folder, filename = self:getLocalDownloadPreview(filename, filetype, file.devicePath, filename_overridden)

        local function createTitle(path, name)
            return T(_("Download folder:\n%1\n\nDownload filename:\n%2\n\nDownload file type:\n%3"),
                BD.dirpath(path), name, string.upper(filetype))
        end

        local dialog
        dialog = ButtonDialog:new{
            title = createTitle(folder, filename),
            buttons = {
                {
                    {
                        text = _("Download"),
                        callback = function()
                            UIManager:close(dialog)
                            local local_path = self:getLocalDownloadPath(filename, filetype, file.devicePath, filename_overridden)
                            self:checkDownloadFile(local_path, detail, file)
                        end,
                    },
                },
                {},
                {
                    {
                        text = _("Choose folder"),
                        callback = function()
                            UIManager:close(dialog)
                            require("ui/downloadmgr"):new{
                                onConfirm = function(path)
                                    logger.dbg("BookOrbit: download folder set to", path)
                                    if self._manager and self._manager.ui and self._manager.ui.folder_shortcuts
                                        and self._manager.ui.folder_shortcuts.updateShortcut then
                                        self._manager.ui.folder_shortcuts:updateShortcut("download_dir", path)
                                    end
                                    G_reader_settings:saveSetting("download_dir", path)
                                    UIManager:nextTick(function()
                                        self:showDownloadDialog(detail, file, filename_overridden and filename or nil)
                                    end)
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
                                                if value ~= "" then
                                                    filename_overridden = true
                                                    folder, filename = self:getLocalDownloadPreview(value, filetype, file.devicePath, true)
                                                end
                                                UIManager:close(input_dialog)
                                                dialog:setTitle(createTitle(folder, filename))
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

    function Catalog:checkDownloadFile(local_path, detail, file)
        local function download()
            UIManager:nextTick(function()
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

    function Catalog:downloadFile(local_path, detail, file)
        local filename = local_path:match("[^/]+$") or safeFilenameBase(detail)
        local total = file.sizeBytes
        local root = self:getCurrentDownloadDir()
        local generation = self:nextDownloadGeneration()
        Transfer.sweepStale(root)

        local dialog
        local function closeDialog()
            if not dialog then return end
            UIManager:close(dialog)
            dialog = nil
        end
        local function showStatus(text)
            if dialog then
                dialog:setTitle(text)
            else
                dialog = ButtonDialog:new{
                    title = text,
                    buttons = {
                        {
                            {
                                text = _("Cancel"),
                                callback = function()
                                    self:nextDownloadGeneration()
                                    closeDialog()
                                    UIManager:show(InfoMessage:new{ text = _("Download cancelled."), timeout = 2 })
                                end,
                            },
                        },
                    },
                }
                UIManager:show(dialog)
            end
            UIManager:forceRePaint()
        end

        local last_bucket = -1
        local function onProgress(received)
            -- A poll that lands after cancellation must not resurrect the
            -- dialog the user just dismissed.
            if self.download_generation ~= generation then return end
            local text, bucket = self:downloadProgressText(filename, received or 0, total)
            if bucket == last_bucket then return end
            last_bucket = bucket
            showStatus(text)
        end

        showStatus(T(_("Downloading:\n%1"), filename))
        self:runOffThread(function()
            local ok, err = Transfer.run{
                root = root,
                destination = local_path,
                generation = generation,
                expected_bytes = total,
                on_progress = onProgress,
                is_current = function()
                    return self.download_generation == generation
                end,
                perform = function(download_opts)
                    return self.client:downloadCatalogFile(file.id, local_path, download_opts)
                end,
            }
            closeDialog()
            if not ok then
                if err == "cancelled" then return end
                self:showRetry(err, function()
                    self:downloadFile(local_path, detail, file)
                end)
                return
            end

            local linked = self:linkDownloadedFile(local_path)
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
            self:showDownloadedDialog(local_path, linked)
        end)
    end

    function Catalog:linkDownloadedFile(local_path)
        local ok, digest = pcall(util.partialMD5, local_path)
        if not ok or not digest then
            logger.warn("BookOrbit: downloaded file partial MD5 failed", local_path)
            return false
        end

        local body, err = self.client:matchCheck({ digest }, { [digest] = { source = "file" } })
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

    function Catalog:showDownloadedDialog(local_path, linked)
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

    function Catalog:openDownloadedFile(local_path)
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
end

return CatalogDownload
