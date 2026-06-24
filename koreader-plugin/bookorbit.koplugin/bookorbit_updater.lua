--[[--
Self-update support for the BookOrbit KOReader plugin.

Compares semver strings and, when an update is confirmed by the user, downloads
the plugin zip from the BookOrbit server and atomically replaces the current
plugin directory. KOReader must be restarted for the new files to load.
]]

local lfs = require("libs/libkoreader-lfs")

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

    -- Extract into a staging directory so a partial unzip never touches the
    -- live plugin directory.
    local ret = os.execute("unzip -o " .. sq(tmp_zip) .. " -d " .. sq(staging))
    os.remove(tmp_zip)

    if ret ~= 0 then
        os.execute("rm -rf " .. sq(staging))
        return nil, "unzip failed with exit code " .. tostring(ret)
    end

    -- The zip must contain exactly the plugin folder as its top-level entry.
    local extracted = staging .. "/" .. plugin_name
    if lfs.attributes(extracted, "mode") ~= "directory" then
        os.execute("rm -rf " .. sq(staging))
        return nil, "update zip does not contain expected directory: " .. plugin_name
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
    if not os.rename(extracted, dir) then
        -- Restore backup so the plugin remains usable.
        os.rename(backup, dir)
        os.execute("rm -rf " .. sq(staging))
        return nil, "could not install updated plugin"
    end

    os.execute("rm -rf " .. sq(backup) .. " " .. sq(staging))
    return true
end

return BookOrbitUpdater
