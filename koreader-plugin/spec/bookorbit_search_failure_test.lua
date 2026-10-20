package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path
package.loaded["gettext"] = function(text) return text end
package.loaded["ffi/util"] = { template = function(text, value) return (text:gsub("%%1", value or "")) end }
package.loaded["document/documentregistry"] = {}
package.loaded["util"] = { trim = function(text) return text:match("^%s*(.-)%s*$") end }
for _, name in ipairs({ "device", "ui/widget/infomessage", "ui/network/manager", "ui/uimanager",
    "datetime", "logger", "bookorbit_board_data", "bookorbit_board_metrics",
    "bookorbit_capabilities", "bookorbit_list_cache", "bookorbit_list_data",
    "bookorbit_list_pages", "bookorbit_list_view" }) do package.loaded[name] = {} end
local Lists = require("bookorbit_catalog_lists")
local function run(failed_stage, failure, populated)
    local calls, retries, switched = 0, {}, nil
    local catalog = setmetatable({ client = {} }, { __index = Lists })
    function catalog:recordRecentSearch() end
    function catalog:runConnected(fn) fn() end
    function catalog:withLoading(_, fn) fn() end
    function catalog:listEnsureCapabilities() end
    function catalog:listsSupported() return true end
    function catalog.client:catalogSection() return { items = populated and { { id = 1 } } or {} } end
    function catalog.client:catalogBooks() return { items = populated and { { id = 2, title = "Book" } } or {}, total = populated and 5 or 0 } end
    function catalog:fetch(_, fn)
        calls = calls + 1
        if calls == failed_stage then return nil, failure end
        return fn()
    end
    function catalog:showRetry(err, retry) retries[#retries + 1] = { err = err, retry = retry } end
    function catalog:switchTo(_, _, context, push) switched = { context = context, push = push } end
    catalog:listSearch(" query ", { replace = true, scope = "books" })
    return calls, retries, switched
end
for stage = 1, 3 do
    for _, err in ipairs({ 401, 403, 404, 429, 503, "timeout", "invalid_json" }) do
        local calls, retries, switched = run(stage, err)
        assert(calls == stage and switched == nil, "failed search stage must stop without replacing the current page")
        assert(#retries == 1 and retries[1].err == err and type(retries[1].retry) == "function", "failure must retain its error and offer retry")
    end
    local calls, retries, switched = run(stage, "cancelled")
    assert(calls == stage and #retries == 0 and switched == nil, "cancelled stage must stop without retry or late navigation")
end
for _, populated in ipairs({ false, true }) do
    local calls, retries, switched = run(nil, nil, populated)
    assert(calls == 3 and #retries == 0 and switched, "successful search must finish all stages")
    assert(switched.context.query == "query" and switched.context.scope == "books" and switched.push == false, "successful retry must preserve query, scope and replacement behavior")
    assert(switched.context.results.books_total == (populated and 5 or 0), "successful empty and populated totals must come from the server")
end
print("bookorbit_search_failure_test.lua: ok")
