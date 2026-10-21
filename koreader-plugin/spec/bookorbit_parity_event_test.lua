local container = {}
function container:extend(definition)
    return setmetatable(definition, { __index = self })
end
function container:handleEvent(event)
    return self[1]:handleEvent(event)
end
function container:free()
    self[1]:free()
end
local function check(path)
    local file = assert(io.open(path))
    local source = file:read('*a')
    file:close()
    local block = assert(source:match('(local Mark =.-)\nlocal function mark'))
    local chunk = assert(loadstring(block .. '\nreturn Mark'))
    setfenv(chunk, { WidgetContainer = container, Geom = { new = function(_, value) return value end } })
    local mark = chunk()
    local calls, released = 0, false
    local child = {
        handleEvent = function(_, event)
            assert(event.kind == 'tap')
            calls = calls + 1
            return true
        end,
        getSize = function() return { w = 100, h = 50 } end,
        paintTo = function() end,
        free = function() released = true end,
    }
    local wrapped = setmetatable({ child }, { __index = mark })
    wrapped:paintTo({}, 10, 20)
    assert(wrapped.dimen.x == 10 and wrapped.dimen.y == 20)
    assert(wrapped:handleEvent({ kind = 'tap' }) and calls == 1,
        'parity instrumentation must preserve child touch events')
    wrapped:free()
    assert(released, 'parity instrumentation must release child resources')
end
check('koreader-plugin/bookorbit.koplugin/bookorbit_list_view.lua')
check('koreader-plugin/bookorbit.koplugin/bookorbit_detail_view.lua')
local function checkNestedRegion(path)
    local file = assert(io.open(path))
    local source = file:read('*a')
    file:close()
    local block = assert(source:match('(local Region =.-)\nlocal [a-z_]+ = nil'))
    local chunk = assert(loadstring(block .. '\nreturn Region'))
    local input = container:extend{}
    local widget = { handleEvent = function(self, event) return self[event.handler](self) end }
    setfenv(chunk, { InputContainer = input, Widget = widget })
    local region = chunk()
    local selected, child_events = nil, 0
    local wrapped = setmetatable({
        { handleEvent = function() child_events = child_events + 1; return true end },
        action = 'edit', run = function(action) selected = action end,
    }, { __index = region })
    wrapped:handleEvent({ handler = 'onTapSelect' })
    assert(selected == 'edit' and child_events == 0,
        'parent synthetic tap must not run its nested clear control')
    wrapped:handleEvent({ handler = 'onGesture' })
    assert(child_events == 1, 'ordinary gestures still reach nested controls first')
    selected = nil
    wrapped:handleEvent({ handler = 'onHoldSelect' })
    assert(selected == 'edit' and child_events == 1,
        'parent synthetic hold must remain scoped to its matching region')
end
checkNestedRegion('koreader-plugin/bookorbit.koplugin/bookorbit_list_view.lua')
checkNestedRegion('koreader-plugin/bookorbit.koplugin/bookorbit_detail_view.lua')
print('bookorbit_parity_event_test.lua: ok')
