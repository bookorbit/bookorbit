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
local TextWidget = require("ui/widget/textwidget")
local VerticalGroup = require("ui/widget/verticalgroup")
local VerticalSpan = require("ui/widget/verticalspan")
local _ = require("gettext")

local CatalogUtil = require("bookorbit_catalog_util")

local Screen = Device.screen
local shortText = CatalogUtil.shortText
local firstAuthor = CatalogUtil.firstAuthor
local formatProgress = CatalogUtil.formatProgress

local PROGRESS_BAR_HEIGHT = Screen:scaleBySize(3)
local SCALE_BY_SIZE = Screen:scaleBySize(1000000) * (1 / 1000000)
local SELECTED_BACKGROUND = Blitbuffer.COLOR_LIGHT_GRAY
local SELECTED_TEXT = Blitbuffer.COLOR_DARK_GRAY
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

local function longestLineLength(text)
    local longest = 0
    for line in (tostring(text or "") .. "\n"):gmatch("(.-)\n") do
        longest = math.max(longest, #line)
    end
    return math.max(1, longest)
end

local function mosaicLabelFontSize(text, width, height)
    local longest = longestLineLength(text)
    local height_size = math.floor(height * 0.46 / SCALE_BY_SIZE)
    local width_size = math.floor(width / math.max(8, math.min(longest, 16)) * 2.05 / SCALE_BY_SIZE)
    local card_size = math.floor(width * (1 / 9.5) / SCALE_BY_SIZE)
    return math.max(13, math.min(20, height_size, width_size, card_size))
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

function CatalogWidgets.buildFakeCover(book, width, height, footer, quiet)
    local inner_w = math.max(1, width - 2 * Size.padding.default - 2 * Size.border.thin)
    local inner_h = math.max(1, height - 2 * Size.padding.default - 2 * Size.border.thin)
    if quiet then
        return FrameContainer:new{
            width = width,
            height = height,
            margin = 0,
            padding = Size.padding.default,
            bordersize = Size.border.thin,
            background = Blitbuffer.COLOR_WHITE,
            CenterContainer:new{
                dimen = Geom:new{ w = inner_w, h = inner_h },
                TextWidget:new{
                    text = footer or _("No cover"),
                    face = Font:getFace("xx_smallinfofont"),
                    fgcolor = Blitbuffer.COLOR_DARK_GRAY,
                    max_width = inner_w,
                },
            },
        }
    end

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

function CatalogWidgets.buildCoverWidget(book, width, height, path, state, quiet_placeholder)
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
    return CatalogWidgets.buildFakeCover(book, width, height, footer, quiet_placeholder == true)
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

function CatalogWidgets.buildSelectionBadge(max_width)
    local size = math.max(Screen:scaleBySize(16), math.min(max_width, Screen:scaleBySize(26)))
    return IconWidget:new{
        icon = "check",
        width = size,
        height = size,
    }
end

function CatalogWidgets.buildDownloadedBadge(max_width)
    local size = math.max(Screen:scaleBySize(14), math.min(max_width, Screen:scaleBySize(24)))
    return IconWidget:new{
        icon = "appbar.filebrowser",
        width = size,
        height = size,
    }
end

function CatalogWidgets.buildCoverWithStateBadges(book, width, height, path, state, downloaded, selected)
    local cover = CatalogWidgets.buildCoverWidget(book, width, height, path, state)
    if not downloaded and not selected then return cover end

    local group = OverlapGroup:new{
        dimen = Geom:new{ w = width, h = height },
        allow_mirroring = false,
        cover,
    }
    if downloaded then
        local badge = CatalogWidgets.buildDownloadedBadge(math.floor(math.min(width, height) * 0.18))
        badge.overlap_align = "left"
        table.insert(group, badge)
    end
    if selected then
        local badge = CatalogWidgets.buildSelectionBadge(math.floor(math.min(width, height) * 0.18))
        badge.overlap_align = "right"
        table.insert(group, badge)
    end
    return group
end

local function selectedTextColor(selected)
    return selected and SELECTED_TEXT or nil
end

local function selectedBackground(selected)
    return selected and SELECTED_BACKGROUND or Blitbuffer.COLOR_WHITE
end

local function selectedTextBgColor(selected)
    return selected and SELECTED_BACKGROUND or nil
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
    local show_label = self.menu.mosaic_show_titles == true
    local bar_reserve = hasProgress(book) and (PROGRESS_BAR_HEIGHT + Size.span.vertical_default) or 0
    local label_h = show_label and math.max(Screen:scaleBySize(44), math.floor(self.dimen.h * 0.24)) or 0
    local label_gap = show_label and Size.span.vertical_default or 0
    local max_cover_w = math.max(1, self.dimen.w - 2 * Size.padding.default)
    local available_cover_h = math.max(1, self.dimen.h - label_h - label_gap - bar_reserve)
    local cover_h = math.min(available_cover_h, math.floor(max_cover_w / 0.68))
    cover_h = math.max(math.min(Screen:scaleBySize(60), available_cover_h), cover_h)
    local cover_w = math.min(max_cover_w, math.floor(cover_h * 0.68))

    local path = self.menu:cachedThumbnailPath(book)
    local state = self.menu:thumbnailState(book)
    local downloaded = self.menu:isOnDevice(book)
    local selected = self.menu.bulkIsBookSelected and self.menu:bulkIsBookSelected(book)
    local content = VerticalGroup:new{ align = "center" }
    table.insert(
        content,
        CatalogWidgets.buildCoverWithStateBadges(book, cover_w, cover_h, path, state, downloaded, selected))
    local bar = CatalogWidgets.buildProgressBar(book and book.progressPercentage, cover_w)
    if bar then
        table.insert(content, VerticalSpan:new{ width = Size.span.vertical_default })
        table.insert(content, bar)
    end
    if show_label then
        local label_text = shortText(book and book.title or _("Untitled"), 30)
        local label_w = math.max(1, self.dimen.w - 2 * Size.padding.tiny)
        table.insert(content, VerticalSpan:new{ width = Size.span.vertical_default })
        table.insert(content, TextBoxWidget:new{
            text = label_text,
            width = label_w,
            height = label_h,
            alignment = "center",
            fgcolor = selectedTextColor(selected),
            bgcolor = selectedTextBgColor(selected),
            face = Font:getFace("cfont", mosaicLabelFontSize(label_text, label_w, label_h)),
            height_overflow_show_ellipsis = true,
        })
    end

    local body = CenterContainer:new{
        dimen = Geom:new{ w = self.dimen.w, h = self.dimen.h },
        content,
    }
    self[1] = FrameContainer:new{
        width = self.dimen.w,
        height = self.dimen.h,
        margin = 0,
        padding = 0,
        bordersize = 0,
        background = selectedBackground(selected),
        body,
    }
end

function MosaicItem:onTapSelect()
    self.menu:onMenuSelect(self.entry)
    return true
end

function MosaicItem:onHoldSelect()
    if self.menu.onMenuHoldSelect then
        self.menu:onMenuHoldSelect(self.entry)
    else
        self.menu:onMenuSelect(self.entry)
    end
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
    local downloaded = self.menu:isOnDevice(book)
    local selected = self.menu.bulkIsBookSelected and self.menu:bulkIsBookSelected(book)

    local text_col = VerticalGroup:new{ align = "left" }
    table.insert(text_col, TextBoxWidget:new{
        text = BD.auto(shortText(book and book.title or _("Untitled"), 58)),
        width = main_w,
        height = title_h,
        height_adjust = true,
        alignment = "left",
        bold = true,
        fgcolor = selectedTextColor(selected),
        bgcolor = selectedTextBgColor(selected),
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
            fgcolor = selectedTextColor(selected),
            bgcolor = selectedTextBgColor(selected),
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
                CatalogWidgets.buildCoverWithStateBadges(book, cover_w, cover_h, path, state, downloaded, selected),
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
                    fgcolor = selectedTextColor(selected),
                    bgcolor = selectedTextBgColor(selected),
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
        background = selectedBackground(selected),
        content,
    }
end

function ListItem:onTapSelect()
    self.menu:onMenuSelect(self.entry)
    return true
end

function ListItem:onHoldSelect()
    if self.menu.onMenuHoldSelect then
        self.menu:onMenuHoldSelect(self.entry)
    else
        self.menu:onMenuSelect(self.entry)
    end
    return true
end

-- Shared card chrome for dashboard tiles: thin rounded border on a white fill.
local CARD_BORDER = Size.border.thin
local CARD_RADIUS = Size.radius.default
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

-- Mirrors TextBoxWidget's own line height math so single-line boxes can be
-- sized exactly (same helper as the detail page uses).
local function lineHeight(face)
    return math.floor(1.3 * face.size + 0.5)
end

-- Caption fonts under captioned dashboard cover cards (title + author/percent).
local CAPTION_TITLE_FONT_SIZE = 13
local CAPTION_SUB_FONT_SIZE = 11

-- Height of the two-line caption block a captioned cover card reserves.
function CatalogWidgets.coverCaptionHeight()
    return lineHeight(Font:getFace("cfont", CAPTION_TITLE_FONT_SIZE))
        + lineHeight(Font:getFace("cfont", CAPTION_SUB_FONT_SIZE))
        + Size.span.vertical_default
end

-- The cover height a cover card derives from its total height (mirrors
-- DashboardCoverCard:init), reserving room for a progress bar and caption
-- when present.
local function coverCardCoverHeight(card_h, with_progress, with_caption)
    local inner_h = math.max(1, card_h - 2 * COVER_CARD_PAD - 2 * CARD_BORDER)
    local bar_h = with_progress and (PROGRESS_BAR_HEIGHT + Size.span.vertical_default) or 0
    local caption_h = with_caption and (CatalogWidgets.coverCaptionHeight() + Size.span.vertical_default) or 0
    return math.max(Screen:scaleBySize(60), inner_h - bar_h - caption_h)
end

-- The width a cover card occupies for a given height, so the layout can lay out
-- a row of cards that tightly wrap their covers.
function CatalogWidgets.coverCardWidth(card_h, with_progress, with_caption)
    local cover_w = math.floor(coverCardCoverHeight(card_h, with_progress, with_caption) * COVER_ASPECT)
    return cover_w + 2 * COVER_CARD_PAD + 2 * CARD_BORDER
end

function CatalogWidgets.coverCardHeight(card_w, with_progress, with_caption)
    local cover_w = math.max(Screen:scaleBySize(44), card_w - 2 * COVER_CARD_PAD - 2 * CARD_BORDER)
    local cover_h = math.floor(cover_w / COVER_ASPECT)
    local bar_h = with_progress and (PROGRESS_BAR_HEIGHT + Size.span.vertical_default) or 0
    local caption_h = with_caption and (CatalogWidgets.coverCaptionHeight() + Size.span.vertical_default) or 0
    return cover_h + bar_h + caption_h + 2 * COVER_CARD_PAD + 2 * CARD_BORDER
end

function CatalogWidgets.detailRelatedCardWidth(card_h)
    local cover_h = math.max(Screen:scaleBySize(54), card_h - 2 * COVER_CARD_PAD - 2 * CARD_BORDER)
    local cover_w = math.floor(cover_h * COVER_ASPECT)
    return cover_w + 2 * COVER_CARD_PAD + 2 * CARD_BORDER
end

function CatalogWidgets.detailRelatedCardHeight(card_w)
    local cover_w = math.max(Screen:scaleBySize(44), card_w - 2 * COVER_CARD_PAD - 2 * CARD_BORDER)
    local cover_h = math.floor(cover_w / COVER_ASPECT)
    return cover_h + 2 * COVER_CARD_PAD + 2 * CARD_BORDER
end

-- A rounded genre/tag chip sized to its label: the frame hugs the measured
-- text plus symmetric padding, so pill widths always match their content.
function CatalogWidgets.buildDetailPill(text, height, max_width)
    local pad_h = Screen:scaleBySize(9)
    local label = TextWidget:new{
        text = BD.auto(shortText(text, 22)),
        face = Font:getFace("xx_smallinfofont", 11),
        bold = true,
        max_width = max_width and math.max(Screen:scaleBySize(20), max_width - 2 * pad_h - 2 * CARD_BORDER) or nil,
    }
    return FrameContainer:new{
        margin = 0,
        padding = 0,
        bordersize = CARD_BORDER,
        radius = Size.radius.button,
        background = Blitbuffer.COLOR_WHITE,
        CenterContainer:new{
            dimen = Geom:new{
                w = label:getSize().w + 2 * pad_h,
                h = math.max(1, height - 2 * CARD_BORDER),
            },
            label,
        },
    }
end

-- A slim borderless progress bar for the detail hero: light-gray track with
-- a solid black fill, matching the card progress bars elsewhere.
function CatalogWidgets.buildDetailProgressBar(percentage, width, height)
    local value = tonumber(percentage) or 0
    value = math.max(0, math.min(100, value))
    return ProgressWidget:new{
        width = width,
        height = height,
        percentage = value / 100,
        margin_h = 0,
        margin_v = 0,
        bordersize = 0,
        radius = Size.radius.default,
        bgcolor = Blitbuffer.COLOR_LIGHT_GRAY,
        fillcolor = Blitbuffer.COLOR_BLACK,
    }
end

function CatalogWidgets.buildDashboardCoverWidget(book, width, height, path, state, downloaded, quiet_placeholder)
    local cover = CatalogWidgets.buildCoverWidget(book, width, height, path, state, quiet_placeholder)
    local read_badge = CatalogWidgets.buildReadStatusBadge(book, math.floor(math.min(width, height) * 0.18))
    if not downloaded and not read_badge then return cover end

    local group = OverlapGroup:new{
        dimen = Geom:new{ w = width, h = height },
        allow_mirroring = false,
        cover,
    }
    if downloaded then
        local badge = CatalogWidgets.buildDownloadedBadge(math.floor(math.min(width, height) * 0.18))
        badge.overlap_align = "left"
        table.insert(group, badge)
    end
    if read_badge then
        read_badge.overlap_align = "right"
        table.insert(group, read_badge)
    end
    return group
end

-- A dashboard section header in the detail page's tab idiom: an uppercase
-- bold label sitting on a thick underline that runs out into a hairline rule.
-- An optional control (e.g. the Discover reroll button) is pinned to the
-- right edge, vertically centered on the label row.
function CatalogWidgets.buildDashboardSectionHeader(text, width, right_widget)
    local face = Font:getFace("cfont", 14)
    local right
    if right_widget then
        right = HorizontalGroup:new{
            align = "center",
            right_widget,
            HorizontalSpan:new{ width = Screen:scaleBySize(6) },
        }
    end
    local right_w = right and right:getSize().w or 0
    local gap = right and (Size.span.horizontal_default + Screen:scaleBySize(4)) or 0
    local label = TextWidget:new{
        text = string.upper(text or ""),
        face = face,
        bold = true,
        max_width = math.max(1, width - right_w - gap),
    }
    local label_h = math.max(label:getSize().h, right and right:getSize().h or 0)
    local row_dimen = Geom:new{ w = width, h = label_h }
    local row = OverlapGroup:new{
        dimen = row_dimen:copy(),
        LeftContainer:new{ dimen = row_dimen:copy(), label },
    }
    if right then
        table.insert(row, RightContainer:new{ dimen = row_dimen:copy(), right })
    end

    local underline_w = math.min(width, label:getSize().w + Screen:scaleBySize(8))
    local underline = HorizontalGroup:new{ align = "bottom" }
    table.insert(underline, LineWidget:new{
        background = Blitbuffer.COLOR_BLACK,
        dimen = Geom:new{ w = underline_w, h = Screen:scaleBySize(3) },
    })
    if width - underline_w > 0 then
        table.insert(underline, LineWidget:new{
            background = Blitbuffer.COLOR_GRAY,
            dimen = Geom:new{ w = width - underline_w, h = Size.line.thin },
        })
    end
    return VerticalGroup:new{
        align = "left",
        row,
        VerticalSpan:new{ width = Screen:scaleBySize(4) },
        underline,
    }
end

-- One block of the dashboard stats strip: a big bold value over a compact
-- muted uppercase label, both centered in the given width.
function CatalogWidgets.buildDashboardStat(value, label, width)
    local value_face = Font:getFace("cfont", 18)
    local label_face = Font:getFace("cfont", 10)
    return VerticalGroup:new{
        align = "center",
        CenterContainer:new{
            dimen = Geom:new{ w = width, h = lineHeight(value_face) },
            TextWidget:new{ text = value or "", face = value_face, bold = true, max_width = width },
        },
        VerticalSpan:new{ width = Size.span.vertical_default },
        CenterContainer:new{
            dimen = Geom:new{ w = width, h = lineHeight(label_face) },
            TextWidget:new{
                text = string.upper(label or ""),
                face = label_face,
                fgcolor = Blitbuffer.COLOR_DARK_GRAY,
                max_width = width,
            },
        },
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

-- A cover-first book card: the cover fills the card, with an optional slim
-- progress bar and an optional two-line caption (title + author/percent)
-- underneath. Used in the Continue reading / Discover rows.
local DashboardCoverCard = InputContainer:extend{
    entry = nil,
    dimen = nil,
    menu = nil,
    show_caption = nil,
    show_progress = nil,
    reserve_progress = nil,
    quiet_placeholder = nil,
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

    local with_caption = self.show_caption == true
    local with_progress = self.show_progress ~= false and hasProgress(book)
    local reserve_progress = self.reserve_progress == true or with_progress
    local caption_h = with_caption and (CatalogWidgets.coverCaptionHeight() + Size.span.vertical_default) or 0
    local bar_h = reserve_progress and (PROGRESS_BAR_HEIGHT + Size.span.vertical_default) or 0
    local cover_h = math.max(Screen:scaleBySize(60), inner_h - bar_h - caption_h)
    local cover_w = math.min(inner_w, math.floor(cover_h * COVER_ASPECT))

    local path = self.menu:cachedThumbnailPath(book)
    local state = self.menu:thumbnailState(book)
    local downloaded = self.menu:isOnDevice(book)

    local col = VerticalGroup:new{ align = "center" }
    table.insert(col, CenterContainer:new{
        dimen = Geom:new{ w = inner_w, h = cover_h },
        CatalogWidgets.buildDashboardCoverWidget(
            book, cover_w, cover_h, path, state, downloaded, self.quiet_placeholder == true),
    })
    if reserve_progress then
        table.insert(col, VerticalSpan:new{ width = Size.span.vertical_default })
        if with_progress then
            table.insert(col, CatalogWidgets.buildProgressBar(book.progressPercentage, cover_w))
        else
            table.insert(col, VerticalSpan:new{ width = PROGRESS_BAR_HEIGHT })
        end
    end
    if with_caption then
        local title_face = Font:getFace("cfont", CAPTION_TITLE_FONT_SIZE)
        local sub_face = Font:getFace("cfont", CAPTION_SUB_FONT_SIZE)
        local sub_text = hasProgress(book) and formatProgress(book.progressPercentage)
            or (book and firstAuthor(book)) or ""
        table.insert(col, VerticalSpan:new{ width = Size.span.vertical_default })
        table.insert(col, CenterContainer:new{
            dimen = Geom:new{ w = inner_w, h = lineHeight(title_face) },
            TextWidget:new{
                text = BD.auto(shortText(book and book.title or _("Untitled"), 40)),
                face = title_face,
                max_width = inner_w,
            },
        })
        table.insert(col, CenterContainer:new{
            dimen = Geom:new{ w = inner_w, h = lineHeight(sub_face) },
            TextWidget:new{
                text = BD.auto(shortText(sub_text, 36)),
                face = sub_face,
                fgcolor = Blitbuffer.COLOR_DARK_GRAY,
                max_width = inner_w,
            },
        })
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
    if self.menu.onMenuHoldSelect then
        self.menu:onMenuHoldSelect(self.entry)
    else
        self.menu:onMenuSelect(self.entry)
    end
    return true
end

-- The dashboard's "continue reading" hero: a wide card mirroring the detail
-- page header, with the cover on the left and the title/author block hugging
-- its top edge while a meta line + progress bar hug its bottom edge. The
-- whole card taps through to the book like any other dashboard card.
local DashboardHeroCard = InputContainer:extend{
    entry = nil,
    dimen = nil,
    menu = nil,
}

function DashboardHeroCard:init()
    self.ges_events = {
        TapSelect = { GestureRange:new{ ges = "tap", range = self.dimen } },
        HoldSelect = { GestureRange:new{ ges = "hold", range = self.dimen } },
    }

    local book = self.entry.book
    local pad = Size.padding.default
    local gap = Screen:scaleBySize(12)
    local inner_w = math.max(1, self.dimen.w - 2 * pad - 2 * CARD_BORDER)
    local inner_h = math.max(1, self.dimen.h - 2 * pad - 2 * CARD_BORDER)
    local cover_h = inner_h
    local cover_w = math.min(math.floor(inner_w * 0.32), math.floor(cover_h * COVER_ASPECT))
    local text_w = math.max(1, inner_w - cover_w - gap)

    local path = self.menu:cachedThumbnailPath(book)
    local state = self.menu:thumbnailState(book)
    local downloaded = self.menu:isOnDevice(book)

    local title_face = Font:getFace("cfont", 16)
    local author_face = Font:getFace("cfont", 12)
    local meta_face = Font:getFace("cfont", 10)

    local top = VerticalGroup:new{ align = "left" }
    table.insert(top, TextBoxWidget:new{
        text = BD.auto(book and book.title or _("Untitled")),
        width = text_w,
        height = 2 * lineHeight(title_face),
        height_adjust = true,
        height_overflow_show_ellipsis = true,
        bold = true,
        face = title_face,
    })
    local author = book and firstAuthor(book)
    if author then
        table.insert(top, VerticalSpan:new{ width = Size.span.vertical_default })
        table.insert(top, TextBoxWidget:new{
            text = BD.auto(shortText(author, 44)),
            width = text_w,
            height = lineHeight(author_face),
            height_overflow_show_ellipsis = true,
            face = author_face,
        })
    end

    local bottom = VerticalGroup:new{ align = "left" }
    if self.entry.meta_text then
        table.insert(bottom, TextBoxWidget:new{
            text = self.entry.meta_text,
            width = text_w,
            height = lineHeight(meta_face),
            height_overflow_show_ellipsis = true,
            fgcolor = Blitbuffer.COLOR_DARK_GRAY,
            face = meta_face,
        })
        table.insert(bottom, VerticalSpan:new{ width = Screen:scaleBySize(2) })
    end
    table.insert(bottom, CatalogWidgets.buildDetailProgressBar(
        book and book.progressPercentage, text_w, Screen:scaleBySize(6)))

    local flex = math.max(0, cover_h - top:getSize().h - bottom:getSize().h)
    local right = VerticalGroup:new{ align = "left" }
    table.insert(right, top)
    table.insert(right, VerticalSpan:new{ width = flex })
    table.insert(right, bottom)

    self[1] = cardFrame(self.dimen.w, self.dimen.h, pad, HorizontalGroup:new{
        align = "top",
        CatalogWidgets.buildDashboardCoverWidget(book, cover_w, cover_h, path, state, downloaded),
        HorizontalSpan:new{ width = gap },
        right,
    })
end

function DashboardHeroCard:onTapSelect()
    self.menu:onMenuSelect(self.entry)
    return true
end

function DashboardHeroCard:onHoldSelect()
    if self.menu.onMenuHoldSelect then
        self.menu:onMenuHoldSelect(self.entry)
    else
        self.menu:onMenuSelect(self.entry)
    end
    return true
end

-- A compact related-book card for the detail page shelves: cover only, with
-- the same tap/hold behavior as normal catalog cards.
local DetailRelatedCard = InputContainer:extend{
    entry = nil,
    dimen = nil,
    menu = nil,
}

function DetailRelatedCard:init()
    self.ges_events = {
        TapSelect = { GestureRange:new{ ges = "tap", range = self.dimen } },
        HoldSelect = { GestureRange:new{ ges = "hold", range = self.dimen } },
    }

    local book = self.entry.book
    local pad = COVER_CARD_PAD
    -- The card is sized via detailRelatedCardWidth/Height, so the inner box
    -- already has the cover aspect ratio and the cover fills it edge to edge.
    local inner_w = math.max(1, self.dimen.w - 2 * pad - 2 * CARD_BORDER)
    local inner_h = math.max(1, self.dimen.h - 2 * pad - 2 * CARD_BORDER)

    local path = self.menu:cachedThumbnailPath(book)
    local state = self.menu:thumbnailState(book)
    local downloaded = self.menu:isOnDevice(book)

    self[1] = cardFrame(self.dimen.w, self.dimen.h, pad, CenterContainer:new{
        dimen = Geom:new{ w = inner_w, h = inner_h },
        CatalogWidgets.buildDashboardCoverWidget(book, inner_w, inner_h, path, state, downloaded),
    })
end

function DetailRelatedCard:onTapSelect()
    self.menu:onMenuSelect(self.entry)
    return true
end

function DetailRelatedCard:onHoldSelect()
    if self.menu.onMenuHoldSelect then
        self.menu:onMenuHoldSelect(self.entry)
    else
        self.menu:onMenuSelect(self.entry)
    end
    return true
end

local DetailTabButton = InputContainer:extend{
    entry = nil,
    dimen = nil,
    menu = nil,
}

-- Underline-style tab: the label sits on an invisible baseline strip that the
-- selected tab fills with a thick black bar, drawn just above the shared
-- hairline rule the tab row renders underneath.
function DetailTabButton:init()
    self.ges_events = {
        TapSelect = { GestureRange:new{ ges = "tap", range = self.dimen } },
        HoldSelect = { GestureRange:new{ ges = "hold", range = self.dimen } },
    }

    local selected = self.entry.selected == true
    local w = self.dimen and self.dimen.w or 100
    local h = self.dimen and self.dimen.h or 30
    local underline_h = Screen:scaleBySize(3)
    local label_h = math.max(1, h - underline_h)
    local label_w = math.max(1, w - 2 * Size.padding.small)

    local col = VerticalGroup:new{}
    table.insert(col, CenterContainer:new{
        dimen = Geom:new{ w = w, h = label_h },
        TextWidget:new{
            text = self.entry.text or "",
            bold = selected,
            fgcolor = selected and Blitbuffer.COLOR_BLACK or Blitbuffer.COLOR_DARK_GRAY,
            face = Font:getFace("xx_smallinfofont", 12),
            max_width = label_w,
        },
    })
    if selected then
        table.insert(col, LineWidget:new{
            background = Blitbuffer.COLOR_BLACK,
            dimen = Geom:new{ w = w, h = underline_h },
        })
    else
        table.insert(col, VerticalSpan:new{ width = underline_h })
    end

    self[1] = FrameContainer:new{
        width = w,
        height = h,
        margin = 0,
        padding = 0,
        bordersize = 0,
        background = Blitbuffer.COLOR_WHITE,
        col,
    }
end

function DetailTabButton:onTapSelect()
    self.menu:selectDetailRelatedTab(self.entry.section_id)
    return true
end

function DetailTabButton:onHoldSelect()
    return self:onTapSelect()
end

local DetailRatingStar = InputContainer:extend{
    entry = nil,
    dimen = nil,
    menu = nil,
}

function DetailRatingStar:init()
    self.ges_events = {
        TapSelect = { GestureRange:new{ ges = "tap", range = self.dimen } },
        HoldSelect = { GestureRange:new{ ges = "hold", range = self.dimen } },
    }

    local text = self.entry.filled and "★" or "☆"
    self[1] = CenterContainer:new{
        dimen = Geom:new{ w = self.dimen.w, h = self.dimen.h },
        TextBoxWidget:new{
            text = text,
            width = self.dimen.w,
            height = self.dimen.h,
            alignment = "center",
            bold = true,
            face = Font:getFace("cfont", 22),
            height_overflow_show_ellipsis = true,
        },
    }
end

function DetailRatingStar:onTapSelect()
    self.menu:rateDetailFromStar(self.entry.rating)
    return true
end

function DetailRatingStar:onHoldSelect()
    self.menu:rateDetailFromStar(nil)
    return true
end

-- A compact browse row: icon and label on the left, a muted count on the
-- right, sitting on a hairline separator. Laid out in columns on the
-- dashboard so navigation stays light next to the bordered book cards.
local DashboardBrowseRow = InputContainer:extend{
    entry = nil,
    dimen = nil,
    menu = nil,
}

function DashboardBrowseRow:init()
    self.ges_events = {
        TapSelect = { GestureRange:new{ ges = "tap", range = self.dimen } },
        HoldSelect = { GestureRange:new{ ges = "hold", range = self.dimen } },
    }

    local entry = self.entry
    local separator_h = Size.line.thin
    local inner_h = math.max(1, self.dimen.h - separator_h)
    local icon_size = math.min(Screen:scaleBySize(18), inner_h - Size.padding.small)
    local icon_box_w = Screen:scaleBySize(28)
    local count_box_w = Screen:scaleBySize(22)
    local gap = Size.span.horizontal_default
    local label_face = Font:getFace("cfont", 17)
    local count_face = Font:getFace("cfont", 15)

    local count_widget
    if entry.mandatory then
        count_widget = TextWidget:new{
            text = tostring(entry.mandatory),
            face = count_face,
            fgcolor = Blitbuffer.COLOR_DARK_GRAY,
        }
    end
    local count_w = count_widget and count_box_w or 0
    local label_w = math.max(1, self.dimen.w - icon_box_w - gap - count_w)

    local left = HorizontalGroup:new{ align = "center" }
    if entry.icon then
        table.insert(left, CenterContainer:new{
            dimen = Geom:new{ w = icon_box_w, h = inner_h },
            IconWidget:new{ icon = entry.icon, width = icon_size, height = icon_size },
        })
    else
        table.insert(left, HorizontalSpan:new{ width = icon_box_w })
    end
    table.insert(left, HorizontalSpan:new{ width = gap })
    table.insert(left, TextWidget:new{
        text = BD.auto(shortText(entry.text or "", 28)),
        face = label_face,
        max_width = label_w,
    })

    local row_dimen = Geom:new{ w = self.dimen.w, h = inner_h }
    local row = OverlapGroup:new{
        dimen = row_dimen:copy(),
        LeftContainer:new{ dimen = row_dimen:copy(), left },
    }
    if count_widget then
        table.insert(row, RightContainer:new{
            dimen = row_dimen:copy(),
            CenterContainer:new{ dimen = Geom:new{ w = count_box_w, h = inner_h }, count_widget },
        })
    end

    self[1] = VerticalGroup:new{
        align = "left",
        row,
        LineWidget:new{
            background = Blitbuffer.COLOR_LIGHT_GRAY,
            dimen = Geom:new{ w = self.dimen.w, h = separator_h },
        },
    }
end

function DashboardBrowseRow:onTapSelect()
    self.menu:onMenuSelect(self.entry)
    return true
end

function DashboardBrowseRow:onHoldSelect()
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
CatalogWidgets.DashboardHeroCard = DashboardHeroCard
CatalogWidgets.DetailRelatedCard = DetailRelatedCard
CatalogWidgets.DetailTabButton = DetailTabButton
CatalogWidgets.DetailRatingStar = DetailRatingStar
CatalogWidgets.DashboardBrowseRow = DashboardBrowseRow
CatalogWidgets.DashboardIconButton = DashboardIconButton

return CatalogWidgets
