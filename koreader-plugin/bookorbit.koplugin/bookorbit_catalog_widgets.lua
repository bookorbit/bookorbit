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
local IconWidget = require("ui/widget/iconwidget")
local ImageWidget = require("ui/widget/imagewidget")
local InputContainer = require("ui/widget/container/inputcontainer")
local LeftContainer = require("ui/widget/container/leftcontainer")
local LineWidget = require("ui/widget/linewidget")
local OverlapGroup = require("ui/widget/overlapgroup")
local ProgressWidget = require("ui/widget/progresswidget")
local RightContainer = require("ui/widget/container/rightcontainer")
local Size = require("ui/size")
local TextBoxWidget = require("ui/widget/textboxwidget")
local VerticalGroup = require("ui/widget/verticalgroup")
local VerticalSpan = require("ui/widget/verticalspan")
local _ = require("gettext")

local CatalogUtil = require("bookorbit_catalog_util")

local Screen = Device.screen
local shortText = CatalogUtil.shortText
local firstAuthor = CatalogUtil.firstAuthor

local PROGRESS_BAR_HEIGHT = Screen:scaleBySize(3)
local SCALE_BY_SIZE = Screen:scaleBySize(1000000) * (1 / 1000000)
local READ_STATUS_BADGE_ICONS = {
    want_to_read = "bookmark",
    reading = "dogear.reading",
    on_hold = "dogear.abandoned",
    rereading = "cre.render.reload",
    read = "check",
    skimmed = "check",
    abandoned = "dogear.abandoned",
}

local CatalogWidgets = {}

local function hasProgress(book)
    return book and book.progressPercentage and book.progressPercentage > 0
end

local function readStatusBadgeIcon(book)
    local status = book and book.readStatus
    if not status or status == "" or status == "unread" then return nil end
    return READ_STATUS_BADGE_ICONS[status] or "dogear.reading"
end

local function rowFontSize(nominal, max_size, row_h)
    local size = math.floor(nominal * row_h * (1 / 64) / SCALE_BY_SIZE)
    if max_size and size > max_size then return max_size end
    return math.max(8, size)
end

-- A slim borderless progress bar, e-ink friendly (no animation): a light-gray
-- track with a solid black fill, used to visualize reading progress on cards.
function CatalogWidgets.buildProgressBar(percentage, width)
    if not percentage or percentage <= 0 then return nil end
    local bar = ProgressWidget:new{
        width = width,
        height = PROGRESS_BAR_HEIGHT,
        percentage = math.min(1, percentage / 100),
        margin_h = 0,
        margin_v = 0,
        bordersize = 0,
        bgcolor = Blitbuffer.COLOR_LIGHT_GRAY,
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

function CatalogWidgets.buildReadStatusBadge(book, max_width)
    local icon = readStatusBadgeIcon(book)
    if not icon then return nil end

    local size = math.max(Screen:scaleBySize(12), math.min(max_width, Screen:scaleBySize(20)))
    return IconWidget:new{
        icon = icon,
        rotation_angle = 270,
        width = size,
        height = size,
    }
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
    local pad = Size.padding.small
    local gap = Size.span.horizontal_default
    local separator_h = Size.line.medium
    local inner_h = math.max(1, self.dimen.h - separator_h)
    local content_h = math.max(1, inner_h - 2 * Size.padding.small)
    local cover_h = math.max(Screen:scaleBySize(38), math.min(Screen:scaleBySize(74), content_h))
    local cover_w = math.floor(cover_h * 0.68)
    local bar_reserve = hasProgress(book) and (PROGRESS_BAR_HEIGHT + Size.span.vertical_default) or 0
    local left_w = cover_w + 2 * pad
    local side_meta_text = self.menu:listSideMetaText(book)
    local show_side_meta = side_meta_text ~= "" and self.dimen.w >= Screen:scaleBySize(520)
    local right_w = show_side_meta and math.min(Screen:scaleBySize(168), math.floor(self.dimen.w * 0.20)) or 0
    local right_pad = show_side_meta and pad or 0
    local main_x = left_w + gap
    local main_w = math.max(1, self.dimen.w - main_x - right_w - right_pad - gap)
    local text_h = math.max(1, content_h - bar_reserve)
    local title_font = rowFontSize(18, 20, inner_h)
    local subtitle_font = rowFontSize(14, 16, inner_h)
    local side_font = rowFontSize(13, 15, inner_h)
    local title_h = math.max(1, math.floor(text_h * 0.52))
    local subtitle_h = math.max(1, text_h - title_h)

    local path = self.menu:cachedThumbnailPath(book)
    local state = self.menu:thumbnailState(book)

    local text_col = VerticalGroup:new{ align = "left" }
    table.insert(text_col, TextBoxWidget:new{
        text = BD.auto(shortText(book and book.title or _("Untitled"), 58)),
        width = main_w,
        height = title_h,
        height_adjust = true,
        alignment = "left",
        bold = true,
        face = Font:getFace("cfont", title_font),
        height_overflow_show_ellipsis = true,
    })
    local subtitle = self.menu:listSubtitleLine(book)
    if subtitle then
        table.insert(text_col, TextBoxWidget:new{
            text = BD.auto(subtitle),
            width = main_w,
            height = subtitle_h,
            height_adjust = true,
            alignment = "left",
            face = Font:getFace("cfont", subtitle_font),
            height_overflow_show_ellipsis = true,
        })
    end

    local body_col = VerticalGroup:new{ align = "left" }
    table.insert(body_col, text_col)
    local bar = CatalogWidgets.buildProgressBar(book and book.progressPercentage, main_w)
    if bar then
        table.insert(body_col, VerticalSpan:new{ width = Size.span.vertical_default })
        table.insert(body_col, bar)
    end

    local row_dimen = Geom:new{ w = self.dimen.w, h = inner_h }
    local row = OverlapGroup:new{
        dimen = row_dimen:copy(),
        LeftContainer:new{
            dimen = row_dimen:copy(),
            CenterContainer:new{
                dimen = Geom:new{ w = left_w, h = inner_h },
                CatalogWidgets.buildCoverWidget(book, cover_w, cover_h, path, state),
            },
        },
        LeftContainer:new{
            dimen = row_dimen:copy(),
            HorizontalGroup:new{
                HorizontalSpan:new{ width = main_x },
                body_col,
            },
        },
    }
    if show_side_meta then
        table.insert(row, RightContainer:new{
            dimen = row_dimen:copy(),
            HorizontalGroup:new{
                TextBoxWidget:new{
                    text = side_meta_text,
                    width = right_w,
                    height = text_h,
                    height_adjust = true,
                    alignment = "right",
                    face = Font:getFace("cfont", side_font),
                    height_overflow_show_ellipsis = true,
                },
                HorizontalSpan:new{ width = right_pad },
            },
        })
    end

    local content = VerticalGroup:new{ align = "left" }
    table.insert(content, row)
    table.insert(content, LineWidget:new{
        background = Blitbuffer.COLOR_LIGHT_GRAY,
        dimen = Geom:new{ w = self.dimen.w, h = separator_h },
    })

    self[1] = FrameContainer:new{
        width = self.dimen.w,
        height = self.dimen.h,
        margin = 0,
        padding = 0,
        bordersize = 0,
        background = Blitbuffer.COLOR_WHITE,
        content,
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

-- Shared card chrome for dashboard tiles: thin rounded border on a white fill.
local CARD_BORDER = Size.border.thin
local CARD_RADIUS = Size.radius.window
local COVER_CARD_PAD = Size.padding.small
-- Typical book-cover aspect ratio (width / height); covers are sized to this so
-- the card hugs the cover with no horizontal whitespace.
local COVER_ASPECT = 0.66

local function cardFrame(width, height, padding, child)
    return FrameContainer:new{
        width = width,
        height = height,
        margin = 0,
        padding = padding,
        bordersize = CARD_BORDER,
        radius = CARD_RADIUS,
        background = Blitbuffer.COLOR_WHITE,
        child,
    }
end

-- The cover height a cover card derives from its total height (mirrors
-- DashboardCoverCard:init), reserving room for a progress bar when present.
local function coverCardCoverHeight(card_h, with_progress)
    local inner_h = math.max(1, card_h - 2 * COVER_CARD_PAD - 2 * CARD_BORDER)
    local bar_h = with_progress and (PROGRESS_BAR_HEIGHT + Size.span.vertical_default) or 0
    return math.max(Screen:scaleBySize(60), inner_h - bar_h)
end

-- The width a cover card occupies for a given height, so the layout can lay out
-- a row of cards that tightly wrap their covers.
function CatalogWidgets.coverCardWidth(card_h, with_progress)
    local cover_w = math.floor(coverCardCoverHeight(card_h, with_progress) * COVER_ASPECT)
    return cover_w + 2 * COVER_CARD_PAD + 2 * CARD_BORDER
end

function CatalogWidgets.buildDashboardCoverWidget(book, width, height, path, state)
    local cover = CatalogWidgets.buildCoverWidget(book, width, height, path, state)
    local badge = CatalogWidgets.buildReadStatusBadge(book, math.floor(math.min(width, height) * 0.18))
    if not badge then return cover end
    badge.overlap_align = "right"

    local dimen = Geom:new{ w = width, h = height }
    return OverlapGroup:new{
        dimen = dimen:copy(),
        allow_mirroring = false,
        cover,
        badge,
    }
end

-- A thin horizontal rule used to separate dashboard sections.
function CatalogWidgets.buildDivider(width)
    return LineWidget:new{
        background = Blitbuffer.COLOR_GRAY,
        dimen = Geom:new{ w = width, h = Size.line.medium },
    }
end

-- A bold section header (Continue reading / Browse).
function CatalogWidgets.buildSectionHeader(text, width, height)
    return TextBoxWidget:new{
        text = text,
        width = width,
        height = height,
        alignment = "left",
        bold = true,
        face = Font:getFace("cfont", 18),
        height_overflow_show_ellipsis = true,
    }
end

-- A muted status line (Updated / offline cache / unavailable).
function CatalogWidgets.buildStatusLabel(text, width, height, alignment)
    return TextBoxWidget:new{
        text = text,
        width = width,
        height = height,
        alignment = alignment or "left",
        fgcolor = Blitbuffer.COLOR_DARK_GRAY,
        face = Font:getFace("xx_smallinfofont"),
        height_overflow_show_ellipsis = true,
    }
end

-- A cover-only book card: the cover fills the card, with an optional slim
-- progress bar pinned at the bottom. Used in the Continue reading / Discover rows.
local DashboardCoverCard = InputContainer:extend{
    entry = nil,
    dimen = nil,
    menu = nil,
}

function DashboardCoverCard:init()
    self.ges_events = {
        TapSelect = { GestureRange:new{ ges = "tap", range = self.dimen } },
        HoldSelect = { GestureRange:new{ ges = "hold", range = self.dimen } },
    }

    local book = self.entry.book
    local pad = COVER_CARD_PAD
    local inner_w = math.max(1, self.dimen.w - 2 * pad - 2 * CARD_BORDER)
    local inner_h = math.max(1, self.dimen.h - 2 * pad - 2 * CARD_BORDER)

    local bar_h = hasProgress(book) and (PROGRESS_BAR_HEIGHT + Size.span.vertical_default) or 0
    local cover_h = math.max(Screen:scaleBySize(60), inner_h - bar_h)
    local cover_w = math.min(inner_w, math.floor(cover_h * COVER_ASPECT))

    local path = self.menu:cachedThumbnailPath(book)
    local state = self.menu:thumbnailState(book)

    local col = VerticalGroup:new{ align = "center" }
    table.insert(col, CenterContainer:new{
        dimen = Geom:new{ w = inner_w, h = cover_h },
        CatalogWidgets.buildDashboardCoverWidget(book, cover_w, cover_h, path, state),
    })
    if bar_h > 0 then
        table.insert(col, VerticalSpan:new{ width = Size.span.vertical_default })
        table.insert(col, CatalogWidgets.buildProgressBar(book.progressPercentage, cover_w))
    end

    self[1] = cardFrame(self.dimen.w, self.dimen.h, pad, CenterContainer:new{
        dimen = Geom:new{ w = inner_w, h = inner_h },
        col,
    })
end

function DashboardCoverCard:onTapSelect()
    self.menu:onMenuSelect(self.entry)
    return true
end

function DashboardCoverCard:onHoldSelect()
    self.menu:onMenuSelect(self.entry)
    return true
end

-- A browse-grid tile: centred icon over a label, with an optional count.
local DashboardBrowseTile = InputContainer:extend{
    entry = nil,
    dimen = nil,
    menu = nil,
}

function DashboardBrowseTile:init()
    self.ges_events = {
        TapSelect = { GestureRange:new{ ges = "tap", range = self.dimen } },
        HoldSelect = { GestureRange:new{ ges = "hold", range = self.dimen } },
    }

    local entry = self.entry
    local pad = Size.padding.small
    local inner_w = math.max(1, self.dimen.w - 2 * pad - 2 * CARD_BORDER)
    local inner_h = math.max(1, self.dimen.h - 2 * pad - 2 * CARD_BORDER)
    local icon_size = math.min(Screen:scaleBySize(22), math.floor(inner_h * 0.45))

    local label = entry.text or ""
    if entry.mandatory then
        label = label .. " (" .. tostring(entry.mandatory) .. ")"
    end

    local col = VerticalGroup:new{ align = "center" }
    if entry.icon then
        table.insert(col, IconWidget:new{ icon = entry.icon, width = icon_size, height = icon_size })
        table.insert(col, VerticalSpan:new{ width = Size.span.vertical_default })
    end
    table.insert(col, TextBoxWidget:new{
        text = BD.auto(shortText(label, 22)),
        width = inner_w,
        alignment = "center",
        face = Font:getFace("x_smallinfofont"),
        height_overflow_show_ellipsis = true,
    })

    self[1] = cardFrame(self.dimen.w, self.dimen.h, pad, CenterContainer:new{
        dimen = Geom:new{ w = inner_w, h = inner_h },
        col,
    })
end

function DashboardBrowseTile:onTapSelect()
    self.menu:onMenuSelect(self.entry)
    return true
end

function DashboardBrowseTile:onHoldSelect()
    self.menu:onMenuSelect(self.entry)
    return true
end

-- A small tappable icon button, used for the Discover section's reroll control.
local DashboardIconButton = InputContainer:extend{
    entry = nil,
    dimen = nil,
    menu = nil,
}

function DashboardIconButton:init()
    self.ges_events = {
        TapSelect = { GestureRange:new{ ges = "tap", range = self.dimen } },
        HoldSelect = { GestureRange:new{ ges = "hold", range = self.dimen } },
    }
    local icon_size = math.max(1, math.min(self.dimen.w, self.dimen.h) - Size.padding.tiny)
    self[1] = CenterContainer:new{
        dimen = Geom:new{ w = self.dimen.w, h = self.dimen.h },
        IconWidget:new{ icon = self.entry.icon, width = icon_size, height = icon_size },
    }
end

function DashboardIconButton:onTapSelect()
    self.menu:onMenuSelect(self.entry)
    return true
end

function DashboardIconButton:onHoldSelect()
    self.menu:onMenuSelect(self.entry)
    return true
end

CatalogWidgets.MosaicItem = MosaicItem
CatalogWidgets.ListItem = ListItem
CatalogWidgets.DashboardCoverCard = DashboardCoverCard
CatalogWidgets.DashboardBrowseTile = DashboardBrowseTile
CatalogWidgets.DashboardIconButton = DashboardIconButton

return CatalogWidgets
