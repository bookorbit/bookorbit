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
local Trapper = require("ui/trapper")
local UIManager = require("ui/uimanager")
local lfs = require("libs/libkoreader-lfs")
local logger = require("logger")
local T = require("ffi/util").template
local _ = require("gettext")

local BookOrbitBookSync = require("bookorbit_book_sync")
local BookOrbitApi = require("bookorbit_api")
local BookOrbitSweep = require("bookorbit_sweep")
local Transfer = require("bookorbit_download_transfer")

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

-- Names of the entries directly under `dir`, excluding "." and "..".
local function childNames(dir)
    local names = {}
    local ok, iterator, dir_obj = pcall(lfs.dir, dir)
    if not ok or not iterator then return names end
    for name in iterator, dir_obj do
        if name ~= "." and name ~= ".." then
            names[#names + 1] = name
        end
    end
    return names
end

-- Extracts every entry of `zip_path` below `raw_dir` with KOReader's Archiver.
-- Returns true, or nil + error string.
local function extractWithArchiver(Archiver, zip_path, raw_dir)
    local arc = Archiver.Reader:new()
    if not arc:open(zip_path) then
        local open_err = arc.err
        arc:close()
        return nil, tostring(open_err or "could not open update archive")
    end
    for entry in arc:iterate() do
        if not arc:extractToPath(entry.path, raw_dir .. "/" .. entry.path) then
            break
        end
    end
    local err = arc.err
    arc:close()
    if err then return nil, tostring(err) end
    return true
end

-- Renames the extracted tree to `staging`, dropping the archive's single
-- top-level directory when it has one. Returns true, or nil + error string.
local function stripRootInto(raw_dir, staging)
    local names = childNames(raw_dir)
    local root = names[1]
    if #names == 1 and lfs.attributes(raw_dir .. "/" .. root, "mode") == "directory" then
        if not os.rename(raw_dir .. "/" .. root, staging) then
            return nil, "could not move extracted plugin into place"
        end
        os.execute("rm -rf " .. sq(raw_dir))
        return true
    end
    if not os.rename(raw_dir, staging) then
        return nil, "could not move extracted plugin into place"
    end
    return true
end

-- Extracts the update zip into `staging`, stripping the zip's root folder.
--
-- KOReader dropped `Device:unpackArchive` in koreader/koreader@751b4978 (July
-- 2026) after its own callers moved to the `ffi/archiver` module, so prefer
-- Archiver and keep the old helper for readers that predate the module. Both
-- are probed at runtime: neither is guaranteed to exist on a given build.
local function unpackUpdate(zip_path, staging, raw_dir)
    local has_archiver, Archiver = pcall(require, "ffi/archiver")
    if has_archiver and type(Archiver) == "table" and Archiver.Reader then
        os.execute("rm -rf " .. sq(raw_dir))
        if not lfs.mkdir(raw_dir) and lfs.attributes(raw_dir, "mode") ~= "directory" then
            return nil, "could not create update staging directory"
        end
        local ok, err = extractWithArchiver(Archiver, zip_path, raw_dir)
        if ok then
            ok, err = stripRootInto(raw_dir, staging)
        end
        if not ok then
            os.execute("rm -rf " .. sq(raw_dir))
            return nil, err
        end
        return true
    end

    if type(Device.unpackArchive) ~= "function" then
        return nil, "this KOReader build provides no archive extraction support"
    end
    if not lfs.mkdir(staging) and lfs.attributes(staging, "mode") ~= "directory" then
        return nil, "could not create update staging directory"
    end
    local ok, err = Device:unpackArchive(zip_path, staging, true)
    if not ok then
        return nil, tostring(err or "archive extraction failed")
    end
    return true
end

-- Downloads the plugin zip from the server and atomically replaces `plugin_dir`.
--
-- Strategy: extract into a staging directory, backup the current plugin dir,
-- rename the new one into place, then clean up. On any failure after the backup
-- the original is restored so the user always has a working plugin.
--
-- `api`         BookOrbitApi instance (must be logged in)
-- `plugin_dir`  Absolute path of the running plugin directory
-- `opts`        Optional { on_progress = function(received, total) }. The
--               transfer runs in a subprocess when a Trapper coroutine is
--               driving, so progress arrives through polled snapshots.
--
-- Returns true on success, or nil + error string on failure.
function BookOrbitUpdater.apply(api, plugin_dir, opts)
    opts = opts or {}
    local dir = plugin_dir:gsub("/+$", "")
    local parent_dir = dir:match("^(.*)/[^/]+$")
    local plugin_name = dir:match("([^/]+)$")

    if not parent_dir or parent_dir == "" or not plugin_name then
        return nil, "cannot determine plugin parent directory"
    end

    local tmp_zip  = parent_dir .. "/bookorbit-update.zip"
    local staging  = parent_dir .. "/" .. plugin_name .. ".update"
    local raw_dir  = parent_dir .. "/" .. plugin_name .. ".unpack"
    local backup   = parent_dir .. "/" .. plugin_name .. ".bak"

    -- Remove any leftover staging dirs from a previous failed attempt.
    os.execute("rm -rf " .. sq(staging) .. " " .. sq(raw_dir))

    Transfer.sweepStale(parent_dir)
    local ok, err = Transfer.run{
        root = parent_dir,
        destination = tmp_zip,
        generation = opts.generation or 1,
        on_progress = opts.on_progress,
        is_current = opts.is_current,
        perform = function(download_opts)
            return api:downloadPluginUpdate(tmp_zip, download_opts)
        end,
    }
    if not ok then
        return nil, tostring(err or "download failed")
    end

    -- Extract into a staging directory so a partial unpack never touches the
    -- live plugin directory. Use KOReader's archive helpers instead of the
    -- platform unzip command: unzip warning exit codes vary by platform.
    local ok_unpack, unpack_err = unpackUpdate(tmp_zip, staging, raw_dir)
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
        self:runInSyncCoroutine(function()
            self:doCheckForUpdate()
        end)
    end)
end

function UpdateCheck:maybeCheckForUpdate(interactive)
    if not self:isLoggedIn() or self._checking_update or self._updating then return end
    if not interactive and not NetworkMgr:isConnected() then return end
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
    if self._checking_update or self._updating then return end
    self._checking_update = true
    local api_opts = self:apiOpts(false)
    local completed, result = Trapper:dismissableRunInSubprocess(function()
        local body, err = BookOrbitApi.new(api_opts):getPluginVersion()
        return { body = body, err = err }
    end, _("Checking for update..."))
    self._checking_update = false
    if not completed then return end
    result = result or {}
    local body, err = result.body, result.err

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
    local server_ver = tostring(body.serverVersion or "unknown"):gsub("^v", "")
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
    -- The transfer owns a background subprocess, so the whole flow needs a
    -- Trapper coroutine; the busy flag clears inside it, not when wrap returns.
    Trapper:wrap(function()
        local ok, err = pcall(function()
            self:_doApplyUpdate(new_version)
        end)
        self._updating = false
        if not ok then error(err, 0) end
    end)
end

function UpdateCheck:_doApplyUpdate(new_version)
    if not self.path then
        UIManager:show(InfoMessage:new{
            text = _("Cannot determine plugin path. Update aborted."),
            timeout = 3,
        })
        return
    end

    local progress
    local last_bucket = -1
    local function showProgress(text)
        if progress then UIManager:close(progress) end
        progress = InfoMessage:new{ text = text }
        UIManager:show(progress)
        UIManager:forceRePaint()
    end
    showProgress(T(_("Downloading BookOrbit v%1..."), new_version))

    local ok, err = BookOrbitUpdater.apply(self:newClient(), self.path, {
        on_progress = function(received, total)
            local bucket, text
            if total and total > 0 then
                local pct = math.min(100, math.floor(received / total * 100))
                bucket = math.floor(pct / 5)
                text = T(_("Downloading BookOrbit v%1...\n\n%2"), new_version, pct .. "%")
            else
                bucket = math.floor((received or 0) / (256 * 1024))
                text = T(_("Downloading BookOrbit v%1...\n\n%2 KB"), new_version, math.floor((received or 0) / 1024))
            end
            if bucket == last_bucket then return end
            last_bucket = bucket
            showProgress(text)
        end,
    })
    if progress then UIManager:close(progress) end

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
