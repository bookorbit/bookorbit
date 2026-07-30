local TempFilesystem = {}
TempFilesystem.__index = TempFilesystem

local function shellQuote(value)
    return "'" .. value:gsub("'", "'\\''") .. "'"
end

local function serializeValue(value, seen)
    local kind = type(value)
    if kind == "nil" then return "nil" end
    if kind == "boolean" or kind == "number" then return tostring(value) end
    if kind == "string" then return string.format("%q", value) end
    assert(kind == "table", "unsupported fixture value: " .. kind)
    assert(not seen[value], "fixture cannot serialize cycles")
    seen[value] = true
    local parts = { "{" }
    for key, item in pairs(value) do
        table.insert(parts, "[" .. serializeValue(key, seen) .. "]=" .. serializeValue(item, seen) .. ",")
    end
    table.insert(parts, "}")
    seen[value] = nil
    return table.concat(parts)
end

function TempFilesystem.new()
    local path = os.tmpname()
    os.remove(path)
    assert(path:match("^/tmp/") or path:match("^/var/folders/"), "unexpected temporary path")
    assert(os.execute("mkdir -p " .. shellQuote(path)) == 0)
    return setmetatable({
        path = path,
        directories = { [path] = true },
        fail_write = false,
        fail_rename = false,
    }, TempFilesystem)
end

function TempFilesystem:makePath(path)
    if self.fail_make_path then return false end
    local result = os.execute("mkdir -p " .. shellQuote(path))
    if result == 0 then self.directories[path] = true end
    return result == 0
end

function TempFilesystem:attributes(path, attribute)
    if self.directories[path] then
        return attribute == "mode" and "directory" or { mode = "directory" }
    end
    local file = io.open(path, "rb")
    if not file then return nil end
    local size = file:seek("end") or 0
    file:close()
    if attribute == "mode" then return "file" end
    if attribute == "size" then return size end
    return { mode = "file", size = size }
end

function TempFilesystem:list(path)
    local pipe = assert(io.popen(
        "find " .. shellQuote(path) .. " -mindepth 1 -maxdepth 1 -type f -print"))
    local names = {}
    for full_path in pipe:lines() do
        table.insert(names, full_path:match("([^/]+)$"))
    end
    pipe:close()
    local index = 0
    return function()
        index = index + 1
        return names[index]
    end
end

function TempFilesystem:write(content, path)
    if self.fail_write then return nil, "injected_write_failure" end
    local file = assert(io.open(path, "wb"))
    file:write(content)
    file:flush()
    file:close()
    return true
end

function TempFilesystem:rename(from, to)
    if self.fail_rename then return nil, "injected_rename_failure" end
    return os.rename(from, to)
end

function TempFilesystem:serialize(value)
    return "return " .. serializeValue(value, {}) .. "\n"
end

function TempFilesystem:cleanup()
    if not (self.path:match("^/tmp/") or self.path:match("^/var/folders/")) then return end
    os.execute("rm -rf " .. shellQuote(self.path))
end

return TempFilesystem
