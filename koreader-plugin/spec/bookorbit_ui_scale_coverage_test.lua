local function read(path)
    local file = assert(io.open(path, "rb"))
    local source = file:read("*a")
    file:close()
    return source
end

local function assertAbsent(source, pattern, label)
    if source:find(pattern, 1, true) then
        error(label .. " bypasses BookOrbit interface scaling")
    end
end

for _, name in ipairs({ "bookorbit_catalog.lua", "bookorbit_catalog_widgets.lua" }) do
    local source = read("koreader-plugin/bookorbit.koplugin/" .. name)
    assertAbsent(source, "Screen:scaleBySize", name)
    assertAbsent(source, "Size.padding", name)
    assertAbsent(source, "Size.span", name)
    assertAbsent(source, "Size.line", name)
    assertAbsent(source, "Size.border", name)
    assertAbsent(source, "Size.radius", name)
    assertAbsent(source, "Font:getFace", name)
end

local settings = read("koreader-plugin/bookorbit.koplugin/bookorbit_settings_page.lua")
if not settings:find("catalog:interfaceScaleChanged()", 1, true) then
    error("changing interface size does not rebuild catalog density")
end

print("bookorbit_ui_scale_coverage_test.lua: ok")
