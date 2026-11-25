-- os.execute returns 0 on success under KOReader's LuaJIT but true under builds
-- with Lua 5.2 compatibility, such as the OpenResty LuaJIT that Ubuntu ships, so
-- specs never compare its result directly.
return function(command)
    local result = os.execute(command)
    return result == 0 or result == true
end
