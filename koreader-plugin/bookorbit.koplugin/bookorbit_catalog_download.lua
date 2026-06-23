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

local BookOrbitState = require("bookorbit_state")
local CatalogUtil = require("bookorbit_catalog_util")

local formatBytes = CatalogUtil.formatBytes
local safeFilenameBase = CatalogUtil.safeFilenameBase

local CatalogDownload = {}

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
                self:showDownloadDialog(detail, files[1])
            end
            return
        end

        local dialog
        local buttons = {}
        local open_tpl = _("Open - %1")
        local download_tpl = _("Download - %1")
        for _, file in ipairs(files) do
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
                            self:showDownloadDialog(detail, file)
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

    function Catalog:getLocalDownloadPath(filename, filetype)
        local download_dir = self:getCurrentDownloadDir()
        filename = filename .. "." .. string.lower(filetype or "bin")
        filename = util.getSafeFilename(filename, download_dir)
        return (download_dir ~= "/" and download_dir or "") .. "/" .. filename
    end

    function Catalog:showDownloadDialog(detail, file)
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
                            UIManager:close(dialog)
                            require("ui/downloadmgr"):new{
                                onConfirm = function(path)
                                    logger.dbg("BookOrbit: download folder set to", path)
                                    if self._manager and self._manager.ui and self._manager.ui.folder_shortcuts then
                                        self._manager.ui.folder_shortcuts:updateShortcut("download_dir", path)
                                    end
                                    G_reader_settings:saveSetting("download_dir", path)
                                    UIManager:nextTick(function()
                                        self:showDownloadDialog(detail, file)
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

    function Catalog:downloadFile(local_path, detail, file)
        local total = file.sizeBytes
        local info = InfoMessage:new{ text = _("Downloading...") }
        UIManager:show(info)
        UIManager:forceRePaint()

        local last_bucket = -1
        local function on_progress(received)
            local text, bucket
            if total and total > 0 then
                local pct = math.min(100, math.floor(received / total * 100))
                bucket = math.floor(pct / 5)
                if bucket == last_bucket then return end
                text = T(_("Downloading... %1"), pct .. "%")
            else
                bucket = math.floor(received / (256 * 1024))
                if bucket == last_bucket then return end
                text = T(_("Downloading... %1"), formatBytes(received))
            end
            last_bucket = bucket
            UIManager:close(info)
            info = InfoMessage:new{ text = text }
            UIManager:show(info)
            UIManager:forceRePaint()
        end

        local ok, err = self.client:downloadCatalogFile(file.id, local_path, on_progress)
        UIManager:close(info)
        if not ok then
            self:showRetry(err, function()
                self:downloadFile(local_path, detail, file)
            end)
            return
        end

        local linked = self:linkDownloadedFile(local_path)
        if linked then
            self:refreshOnDevice()
        end
        self:showDownloadedDialog(local_path, linked)
    end

    function Catalog:linkDownloadedFile(local_path)
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
