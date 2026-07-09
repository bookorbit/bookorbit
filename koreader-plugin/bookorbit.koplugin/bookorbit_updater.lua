--[[--
Self-update support for the BookOrbit KOReader plugin.

Compares semver strings and, when an update is confirmed by the user, downloads
the plugin zip from the BookOrbit server and atomically replaces the current
plugin directory. KOReader must be restarted for the new files to load.
]]

local ConfirmBox = require("ui/widget/confirmbox")
local Device = require("device")
local InfoMessage = require("ui/widget/infomessage")
local NetworkMgr = require("ui/network/manager")
local UIManager = require("ui/uimanager")
local lfs = require("libs/libkoreader-lfs")
local logger = require("logger")
local T = require("ffi/util").template
local _ = require("gettext")

local BookOrbitBookSync = require("bookorbit_book_sync")
local BookOrbitSweep = require("bookorbit_sweep")

local BookOrbitUpdater = {}

-- Returns true if `candidate` is strictly newer than `current` (semver, optional "v" prefix).
function BookOrbitUpdater.isNewer(candidate, current)
    local function parse(v)
        if type(v) ~= "string" then return nil end
        local a, b, c = v:match("^v?(%d+)%.(%d+)%.(%d+)")
        if not a then return nil end
        return { tonumber(a), tonumber(b), tonumber(c) }
    end
    local c = parse(candidate)
    local cur = parse(current)
    if not c or not cur then return false end
    if c[1] ~= cur[1] then return c[1] > cur[1] end
    if c[2] ~= cur[2] then return c[2] > cur[2] end
    return c[3] > cur[3]
end

-- Wraps a path in POSIX single quotes, escaping any embedded single quotes.
local function sq(path)
    return "'" .. path:gsub("'", "'\\''") .. "'"
end

-- Downloads the plugin zip from the server and atomically replaces `plugin_dir`.
--
-- Strategy: extract into a staging directory, backup the current plugin dir,
-- rename the new one into place, then clean up. On any failure after the backup
-- the original is restored so the user always has a working plugin.
--
-- `api`         BookOrbitApi instance (must be logged in)
-- `plugin_dir`  Absolute path of the running plugin directory
-- `progress_cb` Optional function(bytes_received) called during download
--
-- Returns true on success, or nil + error string on failure.
function BookOrbitUpdater.apply(api, plugin_dir, progress_cb)
    local dir = plugin_dir:gsub("/+$", "")
    local parent_dir = dir:match("^(.*)/[^/]+$")
    local plugin_name = dir:match("([^/]+)$")

    if not parent_dir or parent_dir == "" or not plugin_name then
        return nil, "cannot determine plugin parent directory"
    end

    local tmp_zip  = parent_dir .. "/bookorbit-update.zip"
    local staging  = parent_dir .. "/" .. plugin_name .. ".update"
    local backup   = parent_dir .. "/" .. plugin_name .. ".bak"

    -- Remove any leftover staging dir from a previous failed attempt.
    os.execute("rm -rf " .. sq(staging))

    local ok, err = api:downloadPluginUpdate(tmp_zip, progress_cb)
    if not ok then
        return nil, tostring(err or "download failed")
    end

    if not lfs.mkdir(staging) and lfs.attributes(staging, "mode") ~= "directory" then
        os.remove(tmp_zip)
        return nil, "could not create update staging directory"
    end

    -- Extract into a staging directory so a partial unpack never touches the
    -- live plugin directory. Use KOReader's archive helper instead of the
    -- platform unzip command: unzip warning exit codes vary by platform.
    local ok_unpack, unpack_err = Device:unpackArchive(tmp_zip, staging, true)
    os.remove(tmp_zip)

    if not ok_unpack then
        os.execute("rm -rf " .. sq(staging))
        return nil, tostring(unpack_err or "archive extraction failed")
    end

    -- The zip must contain the plugin folder as its top-level entry. We strip
    -- that root during extraction, so the staging directory should now look
    -- like the plugin directory itself.
    if lfs.attributes(staging .. "/main.lua", "mode") ~= "file" then
        os.execute("rm -rf " .. sq(staging))
        return nil, "update zip does not contain expected plugin files: " .. plugin_name
    end

    -- Atomic-ish swap (all paths share the same filesystem):
    --   1. backup current plugin
    --   2. move new plugin into place
    --   3. clean up backup and staging
    os.execute("rm -rf " .. sq(backup))
    if not os.rename(dir, backup) then
        os.execute("rm -rf " .. sq(staging))
        return nil, "could not create plugin backup"
    end
    if not os.rename(staging, dir) then
        -- Restore backup so the plugin remains usable.
        os.rename(backup, dir)
        os.execute("rm -rf " .. sq(staging))
        return nil, "could not install updated plugin"
    end

    os.execute("rm -rf " .. sq(backup) .. " " .. sq(staging))
    return true
end

-- Update-check mixin: the menu-facing status line, the throttled automatic
-- check, the interactive check and the download-and-restart flow. Installed
-- onto the plugin controller as regular methods.

local UPDATE_CHECK_INTERVAL = 24 * 60 * 60

-- Assigned from the plugin class on install (the version literal lives in
-- main.lua, where the server's package endpoint parses it from).
local PLUGIN_VERSION

local UpdateCheck = {}

function UpdateCheck:hasKnownUpdate()
    return BookOrbitUpdater.isNewer(self.settings.update_latest_version, PLUGIN_VERSION) == true
end

function UpdateCheck:updateCheckMenuText()
    if self:hasKnownUpdate() then
        return T(_("Plugin update available: v%1 -> v%2"), PLUGIN_VERSION, self.settings.update_latest_version)
    end
    if self:isLoggedIn() then
        return T(_("Installed plugin: v%1 (Check for update)"), PLUGIN_VERSION)
    end
    return T(_("Installed plugin: v%1 (Login required)"), PLUGIN_VERSION)
end

function UpdateCheck:checkForUpdate()
    if self.requestUpdateCheck then
        self:requestUpdateCheck(true, "manual")
        return
    end
    if not self:isLoggedIn() then
        self:promptLogin()
        return
    end
    NetworkMgr:runWhenConnected(function()
        self:doCheckForUpdate()
    end)
end

function UpdateCheck:maybeCheckForUpdate(interactive)
    if not self:isLoggedIn() or self._checking_update or self._updating then return end
    if BookOrbitSweep.isRunning() or BookOrbitBookSync.isRunning() then return end

    local now = os.time()
    if not interactive and now - (self.settings.update_check_last_at or 0) < UPDATE_CHECK_INTERVAL then
        return
    end

    self._checking_update = true
    local body, err = self:newClient():getPluginVersion()
    self._checking_update = false

    if not body then
        if self.recordSyncError then
            self:recordSyncError("update_check", err)
        end
        if interactive then
            UIManager:show(InfoMessage:new{
                text = T(_("Could not check for update: %1"), tostring(err or "network error")),
                timeout = 4,
            })
        else
            logger.dbg("BookOrbit: plugin update check failed:", err)
        end
        return
    end

    self:handleUpdateVersionResponse(body, interactive, interactive or self.catalog_browser == nil)
end

function UpdateCheck:doCheckForUpdate()
    local checking = InfoMessage:new{ text = _("Checking for update...") }
    UIManager:show(checking)

    local body, err = self:newClient():getPluginVersion()
    UIManager:close(checking)

    if not body then
        if self.recordSyncError then
            self:recordSyncError("update_check", err)
        end
        UIManager:show(InfoMessage:new{
            text = T(_("Could not check for update: %1"), tostring(err or "network error")),
            timeout = 4,
        })
        return
    end

    self:handleUpdateVersionResponse(body, true, true)
end

function UpdateCheck:handleUpdateVersionResponse(body, interactive, prompt_allowed)
    local server_ver = body.serverVersion or "unknown"
    local plugin_latest = body.pluginVersion
    self.settings.update_check_last_at = os.time()

    if type(plugin_latest) ~= "string" or plugin_latest == "unknown" then
        G_reader_settings:flush()
        if self.recordSyncError then
            self:recordSyncError("update_check", "unsupported_server", _("latest plugin version unavailable"))
        end
        if interactive then
            UIManager:show(InfoMessage:new{
                text = _("Could not determine the latest plugin version from the server."),
                timeout = 4,
            })
        end
        return
    end

    self.settings.update_latest_version = plugin_latest
    G_reader_settings:flush()

    if BookOrbitUpdater.isNewer(plugin_latest, PLUGIN_VERSION) ~= true then
        if interactive then
            UIManager:show(InfoMessage:new{
                text = T(_("Plugin is up to date (v%1).\nServer: v%2"), PLUGIN_VERSION, server_ver),
                timeout = 4,
            })
        end
        return
    end

    if not prompt_allowed then
        return
    end

    if not interactive and self.settings.update_dismissed_version == plugin_latest then
        return
    end
    if not interactive then
        self.settings.update_dismissed_version = plugin_latest
        G_reader_settings:flush()
    end

    UIManager:show(ConfirmBox:new{
        text = T(_("Update available: v%1 -> v%2\nServer: v%3\n\nDownload and apply the update now?"),
            PLUGIN_VERSION, plugin_latest, server_ver),
        ok_text = _("Update"),
        ok_callback = function()
            self:applyUpdate(plugin_latest)
        end,
    })
end

function UpdateCheck:applyUpdate(new_version)
    if self._updating then
        UIManager:show(InfoMessage:new{ text = _("An update is already in progress."), timeout = 3 })
        return
    end
    self._updating = true
    self:_doApplyUpdate(new_version)
    self._updating = false
end

function UpdateCheck:_doApplyUpdate(new_version)
    if not self.path then
        UIManager:show(InfoMessage:new{
            text = _("Cannot determine plugin path. Update aborted."),
            timeout = 3,
        })
        return
    end

    local progress = InfoMessage:new{ text = T(_("Downloading BookOrbit v%1..."), new_version) }
    UIManager:show(progress)
    UIManager:forceRePaint()

    local ok, err = BookOrbitUpdater.apply(self:newClient(), self.path)
    UIManager:close(progress)

    if not ok then
        local msg
        if type(err) == "number" and err == 503 then
            msg = _("Update failed: the server does not have the plugin package available.")
        else
            msg = T(_("Update failed: %1"), tostring(err or "unknown error"))
        end
        UIManager:show(InfoMessage:new{ text = msg, timeout = 6 })
        return
    end

    UIManager:show(ConfirmBox:new{
        text = T(_("BookOrbit v%1 installed. KOReader needs to restart to apply the update."), new_version),
        ok_text = _("Restart now"),
        ok_callback = function()
            -- Exit code 85 triggers an app restart on Kobo and most e-ink platforms.
            -- On other platforms KOReader exits cleanly; reopen it to apply the update.
            UIManager:quit(UIManager.RETURN_CODE_REBOOT or 85)
        end,
        cancel_text = _("Later"),
    })
end

function BookOrbitUpdater.install(BookOrbit)
    PLUGIN_VERSION = BookOrbit.PLUGIN_VERSION
    for name, fn in pairs(UpdateCheck) do
        BookOrbit[name] = fn
    end
end

return BookOrbitUpdater
