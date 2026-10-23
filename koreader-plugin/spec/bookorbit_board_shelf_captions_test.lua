package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path
package.loaded["gettext"] = function(value) return value end
package.loaded["datetime"] = {}
package.loaded["ffi/util"] = { template = function(value, replacement) return (value:gsub("%%1", tostring(replacement))) end }
package.loaded["ffi/blitbuffer"] = {}
package.loaded["ui/font"] = {}
package.loaded["device"] = { screen = {
    getWidth = function() return 1264 end,
    getHeight = function() return 1680 end,
    getDPI = function() return 300 end,
} }
package.loaded["bookorbit_board_store"] = { shelfKey = function(props) return props.source end }
package.loaded["bookorbit_board_data"] = {}
local Metrics = require("bookorbit_board_metrics")
local function node(w, h, children, label)
    return { w = w, h = h, children = children, label = label,
        getSize = function() return { w = w, h = h } end }
end
local function stack(options, items, vertical)
    local length, cross, count = 0, 0, 0
    for _, item in ipairs(items) do
        if item then
            length = length + (vertical and item.h or item.w)
            cross = math.max(cross, vertical and item.w or item.h)
            count = count + 1
        end
    end
    length = length + math.max(0, count - 1) * (options.gap or 0)
    local pad = options.pad or 0
    local w = (vertical and cross or length) + 2 * pad
    local h = (vertical and length or cross) + 2 * pad
    assert(not options.w or w <= options.w, "shelf content must fit its width")
    assert(not options.h or h <= options.h, "captions must fit above the bottom padding")
    return node(options.w or w, options.h or h, items)
end
package.loaded["bookorbit_board_ui"] = {
    text = function(value, options) return node(options.w or Metrics.px(#value * 6), Metrics.lh1(options.s), nil, value) end,
    icon = function(_, size) return node(size, size) end,
    space = function(w, h) return node(w or 0, h or 0) end,
    flex = function() return node(0, 0) end,
    cover = function(_, w, h) assert(w > 0 and h > 0) return node(w, h) end,
    hit = function(child) return child end,
    spread = function(w, left, right, h) return node(w, h, { left, right }) end,
    vstack = function(options, items) return stack(options, items, true) end,
    hstack = function(options, items) return stack(options, items, false) end,
}
local Widgets = require("bookorbit_board_widgets")
local sources = { "random", "recently-added", "want-to-read", "up-next-in-series", "pick-back-up", "finished", "in-progress" }
local book = { id = "book", title = "A visible book title", authors = { "An author" }, seriesName = "A series", seriesIndex = 2 }
for _, scale in ipairs(Metrics.UI_SCALES) do
    Metrics.setUserScale(scale)
    for _, size in ipairs({ { 580, 384, 2 }, { 580, 440, 2 }, { 1180, 440, 4 }, { 1180, 440, 2 }, { Metrics.px(240), Metrics.px(178), 2 } }) do
        for _, source in ipairs(sources) do
            local result = Widgets.W.shelf({ d = { online = true, goal = { year = 2026 },
                shelves = { [source] = { book, book, book, book } } } }, size[1], size[2], { source = source }, { cw = size[3] })
            local labels = {}
            local function visit(item)
                if not item then return end
                if item.label then labels[item.label] = (labels[item.label] or 0) + 1 end
                for _, child in ipairs(item.children or {}) do visit(child) end
            end
            visit(result)
            assert(labels[book.title], source .. " must retain book titles at " .. scale)
            local cards = result.children[3].children
            for _, card in ipairs(cards) do
                assert(#card.children == 3, "shelf cards contain only a cover, gap and title")
                assert(card.children[3].h == Metrics.lh1(11), "titles use the selected nominal size 11")
            end
            if size[3] <= 2 then
                assert(labels[book.title] <= 3, "medium shelves show at most three books at " .. scale)
                local cover = cards[1].children[1]
                local available_h = size[2] - 2 * Metrics.px(12) - Metrics.lh1(13) - Metrics.px(10)
                    - Metrics.px(6) - Metrics.lh1(11)
                local available_w = math.floor((size[1] - 2 * Metrics.px(12) - (#cards - 1) * Metrics.px(12)) / #cards)
                local expected_h = math.min(available_h, math.floor(available_w * 1.5 + 0.5))
                assert(cover.h >= expected_h - 1, "medium covers use the space available to at most three books")
            else
                assert(labels[book.title] == 4, "wide shelves are not capped at three books")
            end
            assert(not labels["An author"], "shelf cards omit author subtitles")
        end
    end
end
print("bookorbit_board_shelf_captions_test.lua: ok")
