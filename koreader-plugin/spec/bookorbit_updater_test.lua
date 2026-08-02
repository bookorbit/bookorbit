-- Update extraction and the atomic plugin swap. KOReader dropped
-- `Device:unpackArchive` in July 2026, so the updater probes for the newer
-- `ffi/archiver` module first and falls back to the old helper. Neither is
-- guaranteed to exist: a build that has no extraction support at all must
-- surface an error rather than crash the reader (bookorbit/bookorbit#827).

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;koreader-plugin/spec/?.lua;" .. package.path

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local function assertTruthy(value, label)
    if not value then
        error(string.format("%s: expected a truthy value, got %s", label, tostring(value)))
    end
end

local function shellQuote(value)
    return "'" .. value:gsub("'", "'\\''") .. "'"
end

local function dirname(path)
    return path:match("^(.*)/[^/]+$")
end

local function pathMode(path)
    if os.execute("test -d " .. shellQuote(path)) == 0 then return "directory" end
    if os.execute("test -f " .. shellQuote(path)) == 0 then return "file" end
    return nil
end

local function writeFile(path, content)
    os.execute("mkdir -p " .. shellQuote(dirname(path)))
    local file = assert(io.open(path, "wb"))
    file:write(content)
    file:close()
end

local function readFile(path)
    local file = io.open(path, "rb")
    if not file then return nil end
    local content = file:read("*a")
    file:close()
    return content
end

-- Minimal lfs backed by the real filesystem: the updater creates and renames
-- directories itself, so a table-tracked fake would not observe its writes.
local lfs = {}

function lfs.attributes(path, attribute)
    local mode = pathMode(path)
    if not mode then return nil end
    if attribute == "mode" then return mode end
    return { mode = mode }
end

function lfs.mkdir(path)
    if pathMode(path) then return nil, "File exists" end
    return os.execute("mkdir " .. shellQuote(path)) == 0 or nil
end

function lfs.dir(path)
    if pathMode(path) ~= "directory" then error("cannot open " .. path) end
    local pipe = assert(io.popen(
        "find " .. shellQuote(path) .. " -mindepth 1 -maxdepth 1 -print"))
    local names = { ".", ".." }
    for full_path in pipe:lines() do
        names[#names + 1] = full_path:match("([^/]+)$")
    end
    pipe:close()
    local index = 0
    return function()
        index = index + 1
        return names[index]
    end
end

local Device = {}
local Transfer = {}

package.loaded["ui/widget/confirmbox"] = {}
package.loaded["ui/widget/infomessage"] = {}
package.loaded["ui/network/manager"] = {}
package.loaded["ui/trapper"] = {}
package.loaded["ui/uimanager"] = {}
package.loaded["device"] = Device
package.loaded["libs/libkoreader-lfs"] = lfs
package.loaded["logger"] = { dbg = function() end, info = function() end, warn = function() end }
package.loaded["ffi/util"] = { template = function(text) return text end }
package.loaded["gettext"] = function(text) return text end
package.loaded["bookorbit_book_sync"] = {}
package.loaded["bookorbit_api"] = {}
package.loaded["bookorbit_sweep"] = {}
package.loaded["bookorbit_download_transfer"] = Transfer

local BookOrbitUpdater = require("bookorbit_updater")

-- Stands in for KOReader's `ffi/archiver`: walks the declared entries and
-- materializes them at the destination paths the updater asks for.
local function fakeArchiver(entries, opts)
    opts = opts or {}
    local Reader = {}
    Reader.__index = Reader

    function Reader:new()
        return setmetatable({ err = nil }, Reader)
    end

    function Reader:open(path)
        if opts.fail_open then
            self.err = "cannot open archive"
            return nil
        end
        self.opened = path
        return true
    end

    function Reader:iterate()
        local index = 0
        return function()
            index = index + 1
            local entry = entries[index]
            if entry then return { path = entry.path, mode = entry.mode } end
        end
    end

    function Reader:extractToPath(key, dest_path)
        if opts.fail_on and key == opts.fail_on then
            self.err = "extraction failed for " .. key
            return false
        end
        for _, entry in ipairs(entries) do
            if entry.path == key then
                if entry.mode == "directory" then
                    os.execute("mkdir -p " .. shellQuote(dest_path))
                else
                    writeFile(dest_path, entry.content or "")
                end
                return true
            end
        end
        self.err = "no such path"
        return false
    end

    function Reader:close() end

    return { Reader = Reader }
end

local ROOTED_ZIP = {
    { path = "bookorbit.koplugin/", mode = "directory" },
    { path = "bookorbit.koplugin/main.lua", mode = "file", content = "-- updated main\n" },
    { path = "bookorbit.koplugin/_meta.lua", mode = "file", content = "-- updated meta\n" },
}

local FLAT_ZIP = {
    { path = "main.lua", mode = "file", content = "-- updated main\n" },
    { path = "_meta.lua", mode = "file", content = "-- updated meta\n" },
}

-- Builds an installed plugin directory and the Transfer stub that "downloads"
-- into it. Returns the sandbox root and the live plugin directory.
local function setup()
    local root = os.tmpname()
    os.remove(root)
    assert(root:match("^/tmp/") or root:match("^/var/folders/"), "unexpected temporary path")
    assert(os.execute("mkdir -p " .. shellQuote(root)) == 0)

    local plugin_dir = root .. "/bookorbit.koplugin"
    writeFile(plugin_dir .. "/main.lua", "-- installed main\n")
    writeFile(plugin_dir .. "/_meta.lua", "-- installed meta\n")

    Transfer.sweepStale = function() return 0 end
    Transfer.run = function(spec)
        writeFile(spec.destination, "PK\003\004 fake zip payload")
        return true
    end

    return root, plugin_dir
end

local function cleanup(root)
    if root:match("^/tmp/") or root:match("^/var/folders/") then
        os.execute("rm -rf " .. shellQuote(root))
    end
end

local function useArchiver(archiver)
    package.loaded["ffi/archiver"] = archiver
end

local function withoutArchiver()
    package.loaded["ffi/archiver"] = nil
end

do -- semver comparison
    assertEqual(BookOrbitUpdater.isNewer("1.4.0", "1.3.1"), true, "a newer patch line is newer")
    assertEqual(BookOrbitUpdater.isNewer("v1.4.0", "1.4.0"), false, "an equal version is not newer")
    assertEqual(BookOrbitUpdater.isNewer("1.3.1", "1.4.0"), false, "an older version is not newer")
    assertEqual(BookOrbitUpdater.isNewer("1.10.0", "1.9.0"), true, "minor versions compare numerically")
    assertEqual(BookOrbitUpdater.isNewer(nil, "1.4.0"), false, "a missing candidate is not newer")
end

do -- the Archiver path strips the zip's single root directory
    local root, plugin_dir = setup()
    Device.unpackArchive = nil
    useArchiver(fakeArchiver(ROOTED_ZIP))

    local ok, err = BookOrbitUpdater.apply({}, plugin_dir)

    assertEqual(ok, true, "the update applies via Archiver")
    assertEqual(err, nil, "a successful update reports no error")
    assertEqual(readFile(plugin_dir .. "/main.lua"), "-- updated main\n", "the new main.lua is installed")
    assertEqual(readFile(plugin_dir .. "/_meta.lua"), "-- updated meta\n", "the new _meta.lua is installed")
    assertEqual(pathMode(root .. "/bookorbit.koplugin.unpack"), nil, "the raw extraction dir is removed")
    assertEqual(pathMode(root .. "/bookorbit.koplugin.update"), nil, "the staging dir is removed")
    assertEqual(pathMode(root .. "/bookorbit.koplugin.bak"), nil, "the backup is removed")
    assertEqual(pathMode(root .. "/bookorbit-update.zip"), nil, "the downloaded zip is removed")
    cleanup(root)
end

do -- a zip without a single root directory installs as-is
    local root, plugin_dir = setup()
    Device.unpackArchive = nil
    useArchiver(fakeArchiver(FLAT_ZIP))

    local ok = BookOrbitUpdater.apply({}, plugin_dir)

    assertEqual(ok, true, "a rootless zip still applies")
    assertEqual(readFile(plugin_dir .. "/main.lua"), "-- updated main\n", "the new main.lua is installed")
    assertEqual(pathMode(root .. "/bookorbit.koplugin.unpack"), nil, "the raw extraction dir is removed")
    cleanup(root)
end

do -- older readers without ffi/archiver still use Device:unpackArchive
    local root, plugin_dir = setup()
    withoutArchiver()
    local seen = {}
    Device.unpackArchive = function(_, archive, extract_to, with_stripped_root)
        seen = { archive = archive, extract_to = extract_to, stripped = with_stripped_root }
        writeFile(extract_to .. "/main.lua", "-- updated main\n")
        return true
    end

    local ok = BookOrbitUpdater.apply({}, plugin_dir)

    assertEqual(ok, true, "the legacy extraction path applies the update")
    assertEqual(seen.archive, root .. "/bookorbit-update.zip", "the downloaded zip is unpacked")
    assertEqual(seen.extract_to, root .. "/bookorbit.koplugin.update", "extraction targets the staging dir")
    assertEqual(seen.stripped, true, "the legacy helper is asked to strip the archive root")
    assertEqual(readFile(plugin_dir .. "/main.lua"), "-- updated main\n", "the new main.lua is installed")
    cleanup(root)
end

do -- regression: no extraction support at all must not crash the reader
    local root, plugin_dir = setup()
    withoutArchiver()
    Device.unpackArchive = nil

    local called, ok, err = pcall(BookOrbitUpdater.apply, {}, plugin_dir)

    assertEqual(called, true, "a reader without archive support does not raise")
    assertEqual(ok, nil, "the update reports failure")
    assertTruthy(err and err:find("archive extraction", 1, true), "the error names the missing support")
    assertEqual(readFile(plugin_dir .. "/main.lua"), "-- installed main\n", "the live plugin is left intact")
    cleanup(root)
end

do -- a failed extraction leaves the installed plugin untouched
    local root, plugin_dir = setup()
    Device.unpackArchive = nil
    useArchiver(fakeArchiver(ROOTED_ZIP, { fail_on = "bookorbit.koplugin/_meta.lua" }))

    local ok, err = BookOrbitUpdater.apply({}, plugin_dir)

    assertEqual(ok, nil, "a broken archive reports failure")
    assertTruthy(err, "a broken archive reports an error message")
    assertEqual(readFile(plugin_dir .. "/main.lua"), "-- installed main\n", "the live plugin is left intact")
    assertEqual(pathMode(root .. "/bookorbit.koplugin.unpack"), nil, "the raw extraction dir is cleaned up")
    assertEqual(pathMode(root .. "/bookorbit.koplugin.update"), nil, "the staging dir is cleaned up")
    cleanup(root)
end

do -- a zip missing main.lua is rejected before the swap
    local root, plugin_dir = setup()
    Device.unpackArchive = nil
    useArchiver(fakeArchiver({
        { path = "bookorbit.koplugin/", mode = "directory" },
        { path = "bookorbit.koplugin/_meta.lua", mode = "file", content = "-- only meta\n" },
    }))

    local ok, err = BookOrbitUpdater.apply({}, plugin_dir)

    assertEqual(ok, nil, "an incomplete zip reports failure")
    assertTruthy(err and err:find("expected plugin files", 1, true), "the error explains the rejection")
    assertEqual(readFile(plugin_dir .. "/main.lua"), "-- installed main\n", "the live plugin is left intact")
    cleanup(root)
end

print("bookorbit_updater_test.lua: ok")
