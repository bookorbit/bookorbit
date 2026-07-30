-- Proves persistent plugin state is published atomically and retains the last
-- readable generation instead of relying on LuaSettings' unchecked flush.

local temp_root = os.tmpname()
os.remove(temp_root)
assert(os.execute("mkdir -p '" .. temp_root .. "'") == 0)

local function serialize(value)
    if type(value) == "string" then return string.format("%q", value) end
    if type(value) == "number" or type(value) == "boolean" then return tostring(value) end
    if type(value) ~= "table" then return "nil" end
    local parts = {}
    for key, item in pairs(value) do
        parts[#parts + 1] = "[" .. serialize(key) .. "]=" .. serialize(item)
    end
    return "{" .. table.concat(parts, ",") .. "}"
end

package.loaded["datastorage"] = {
    getSettingsDir = function() return temp_root end,
}
package.loaded["dump"] = function(value)
    return serialize(value)
end
package.loaded["ffi/util"] = {
    fsyncOpenedFile = function() end,
    fsyncDirectory = function() end,
}
package.loaded["libs/libkoreader-lfs"] = {
    attributes = function(path, attribute)
        local handle = io.open(path, "rb")
        if not handle then return nil end
        handle:close()
        return attribute == "mode" and "file" or { mode = "file" }
    end,
}
package.loaded["luasettings"] = {
    open = function(_, file)
        local data = {}
        local chunk = loadfile(file)
        if chunk then
            local ok, stored = pcall(chunk)
            if ok and type(stored) == "table" then data = stored end
        end
        return {
            file = file,
            data = data,
            readSetting = function(self, key, default)
                if self.data[key] == nil then self.data[key] = default end
                return self.data[key]
            end,
        }
    end,
}

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local BookOrbitState = require("bookorbit_state")
local state = BookOrbitState.open()
local state_path = temp_root .. "/bookorbit_sync_state.lua"

state.global.marker = "first"
state:flush()
assert(loadfile(state_path)().global.marker == "first", "first generation is readable")
assert(io.open(state_path .. ".bookorbit.tmp", "rb") == nil, "temporary state is consumed")

state.global.marker = "second"
state:flush()
assert(loadfile(state_path)().global.marker == "second", "new generation is published")
assert(loadfile(state_path .. ".old")().global.marker == "first", "previous generation is retained")

os.execute("rm -rf '" .. temp_root .. "'")

print("bookorbit_state_atomic_flush_test.lua: ok")
