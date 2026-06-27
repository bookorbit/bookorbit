--[[--
Cover and book-item widgets for the BookOrbit catalog browser.

`buildCoverWidget`/`buildFakeCover` render a real cover image or a text
placeholder. `MosaicItem`/`ListItem` are the tappable cells the catalog Menu
lays out; they read cached thumbnails and labels back from the owning menu.
]]

local BD = require("ui/bidi")
local Blitbuffer = require("ffi/blitbuffer")
local CenterContainer = require("ui/widget/container/centercontainer")
local Device = require("device")
local Font = require("ui/font")
local FrameContainer = require("ui/widget/container/framecontainer")
local Geom = require("ui/geometry")
local GestureRange = require("ui/gesturerange")
local HorizontalGroup = require("ui/widget/horizontalgroup")
local HorizontalSpan = require("ui/widget/horizontalspan")
local ImageWidget = require("ui/widget/imagewidget")
local InputContainer = require("ui/widget/container/inputcontainer")
local ProgressWidget = require("ui/widget/progresswidget")
local Size = require("ui/size")
local TextBoxWidget = require("ui/widget/textboxwidget")
local VerticalGroup = require("ui/widget/verticalgroup")
local VerticalSpan = require("ui/widget/verticalspan")
local _ = require("gettext")

local CatalogUtil = require("bookorbit_catalog_util")

local Screen = Device.screen
local shortText = CatalogUtil.shortText
local firstAuthor = CatalogUtil.firstAuthor

local PROGRESS_BAR_HEIGHT = Screen:scaleBySize(5)

local CatalogWidgets = {}

local function hasProgress(book)
    return book and book.progressPercentage and book.progressPercentage > 0
end

-- A slim solid progress bar, e-ink friendly (no animation), used to visualize
-- reading progress on cards and rows.
function CatalogWidgets.buildProgressBar(percentage, width)
    if not percentage or percentage <= 0 then return nil end
    local bar = ProgressWidget:new{
        width = width,
        height = PROGRESS_BAR_HEIGHT,
        percentage = math.min(1, percentage / 100),
        margin_h = 0,
        margin_v = 0,
        bordersize = Size.border.thin,
        bgcolor = Blitbuffer.COLOR_WHITE,
        fillcolor = Blitbuffer.COLOR_BLACK,
    }
    return bar
end

function CatalogWidgets.buildFakeCover(book, width, height, footer)
    local inner_w = math.max(1, width - 2 * Size.padding.default - 2 * Size.border.thin)
    local inner_h = math.max(1, height - 2 * Size.padding.default - 2 * Size.border.thin)
    local title_h = math.floor(inner_h * 0.58)
    local author_h = math.floor(inner_h * 0.22)
    local footer_h = math.max(1, inner_h - title_h - author_h)
    local author = book and firstAuthor(book) or nil

    local content = VerticalGroup:new{ align = "center" }
    table.insert(content, VerticalSpan:new{ width = Size.span.vertical_default })
    table.insert(content, TextBoxWidget:new{
        text = BD.auto(shortText(book and book.title or _("Untitled"), 60)),
        width = inner_w,
        height = title_h,
        alignment = "center",
        face = Font:getFace("smallinfofont", 16),
        height_overflow_show_ellipsis = true,
    })
    table.insert(content, TextBoxWidget:new{
        text = author and BD.auto(shortText(author, 44)) or "",
        width = inner_w,
        height = author_h,
        alignment = "center",
        face = Font:getFace("x_smallinfofont"),
        height_overflow_show_ellipsis = true,
    })
    table.insert(content, TextBoxWidget:new{
        text = footer or "",
        width = inner_w,
        height = footer_h,
        alignment = "center",
        face = Font:getFace("xx_smallinfofont"),
        height_overflow_show_ellipsis = true,
    })

    return FrameContainer:new{
        width = width,
        height = height,
        margin = 0,
        padding = Size.padding.default,
        bordersize = Size.border.thin,
        background = Blitbuffer.COLOR_WHITE,
        CenterContainer:new{
            dimen = Geom:new{ w = inner_w, h = inner_h },
            content,
        },
    }
end

function CatalogWidgets.buildCoverWidget(book, width, height, path, state)
    if path then
        return CenterContainer:new{
            dimen = Geom:new{ w = width, h = height },
            FrameContainer:new{
                margin = 0,
                padding = 0,
                bordersize = Size.border.thin,
                ImageWidget:new{
                    file = path,
                    width = width,
                    height = height,
                    scale_factor = 0,
                },
            },
        }
    end

    local footer
    if state == "loading" then
        footer = _("Loading cover")
    elseif state == "failed" then
        footer = _("Cover unavailable")
    else
        footer = _("No cover")
    end
    return CatalogWidgets.buildFakeCover(book, width, height, footer)
end

local MosaicItem = InputContainer:extend{
    entry = nil,
    dimen = nil,
    menu = nil,
    text = nil,
}

function MosaicItem:init()
    self.ges_events = {
        TapSelect = {
            GestureRange:new{
                ges = "tap",
                range = self.dimen,
            },
        },
        HoldSelect = {
            GestureRange:new{
                ges = "hold",
                range = self.dimen,
            },
        },
    }

    local book = self.entry.book
    local bar_reserve = hasProgress(book) and (PROGRESS_BAR_HEIGHT + Size.span.vertical_default) or 0
    local label_h = math.max(Screen:scaleBySize(44), math.floor(self.dimen.h * 0.24))
    local cover_h = math.max(Screen:scaleBySize(60), self.dimen.h - label_h - Size.span.vertical_default - bar_reserve)
    local cover_w = math.min(self.dimen.w - 2 * Size.padding.default, math.floor(cover_h * 0.68))
    cover_h = math.min(cover_h, self.dimen.h - label_h - Size.span.vertical_default - bar_reserve)

    local path = self.menu:cachedThumbnailPath(book)
    local state = self.menu:thumbnailState(book)
    local content = VerticalGroup:new{ align = "center" }
    table.insert(content, CatalogWidgets.buildCoverWidget(book, cover_w, cover_h, path, state))
    local bar = CatalogWidgets.buildProgressBar(book and book.progressPercentage, cover_w)
    if bar then
        table.insert(content, VerticalSpan:new{ width = Size.span.vertical_default })
        table.insert(content, bar)
    end
    table.insert(content, VerticalSpan:new{ width = Size.span.vertical_default })
    table.insert(content, TextBoxWidget:new{
        text = self.menu:cellLabel(book),
        width = self.dimen.w - 2 * Size.padding.tiny,
        height = label_h,
        alignment = "center",
        face = Font:getFace("x_smallinfofont"),
        height_overflow_show_ellipsis = true,
    })

    self[1] = CenterContainer:new{
        dimen = Geom:new{ w = self.dimen.w, h = self.dimen.h },
        content,
    }
end

function MosaicItem:onTapSelect()
    self.menu:onMenuSelect(self.entry)
    return true
end

function MosaicItem:onHoldSelect()
    self.menu:onMenuSelect(self.entry)
    return true
end

local ListItem = InputContainer:extend{
    entry = nil,
    dimen = nil,
    menu = nil,
}

function ListItem:init()
    self.ges_events = {
        TapSelect = {
            GestureRange:new{
                ges = "tap",
                range = self.dimen,
            },
        },
        HoldSelect = {
            GestureRange:new{
                ges = "hold",
                range = self.dimen,
            },
        },
    }

    local book = self.entry.book
    local pad = Size.padding.default
    local inner_h = math.max(1, self.dimen.h - 2 * Size.border.thin)
    local cover_h = math.max(Screen:scaleBySize(40), inner_h - 2 * Size.padding.small)
    local cover_w = math.floor(cover_h * 0.68)
    local text_w = math.max(1, self.dimen.w - cover_w - 3 * pad)
    local bar_reserve = hasProgress(book) and (PROGRESS_BAR_HEIGHT + Size.span.vertical_default) or 0

    local path = self.menu:cachedThumbnailPath(book)
    local state = self.menu:thumbnailState(book)

    local text_col = VerticalGroup:new{ align = "left" }
    table.insert(text_col, TextBoxWidget:new{
        text = self.menu:listText(book),
        width = text_w,
        height = math.max(1, inner_h - 2 * Size.padding.small - bar_reserve),
        alignment = "left",
        face = Font:getFace("smallinfofont"),
        height_overflow_show_ellipsis = true,
    })
    local bar = CatalogWidgets.buildProgressBar(book and book.progressPercentage, text_w)
    if bar then
        table.insert(text_col, VerticalSpan:new{ width = Size.span.vertical_default })
        table.insert(text_col, bar)
    end

    local row = HorizontalGroup:new{ align = "center" }
    table.insert(row, HorizontalSpan:new{ width = pad })
    table.insert(row, CatalogWidgets.buildCoverWidget(book, cover_w, cover_h, path, state))
    table.insert(row, HorizontalSpan:new{ width = pad })
    table.insert(row, text_col)

    self[1] = FrameContainer:new{
        width = self.dimen.w,
        height = self.dimen.h,
        margin = 0,
        padding = 0,
        bordersize = Size.border.thin,
        background = Blitbuffer.COLOR_WHITE,
        row,
    }
end

function ListItem:onTapSelect()
    self.menu:onMenuSelect(self.entry)
    return true
end

function ListItem:onHoldSelect()
    self.menu:onMenuSelect(self.entry)
    return true
end

CatalogWidgets.MosaicItem = MosaicItem
CatalogWidgets.ListItem = ListItem

return CatalogWidgets
