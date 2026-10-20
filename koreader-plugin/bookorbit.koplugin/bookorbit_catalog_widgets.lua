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
local TextBoxWidget = require("ui/widget/textboxwidget")
local TextWidget = require("ui/widget/textwidget")
local VerticalGroup = require("ui/widget/verticalgroup")
local VerticalSpan = require("ui/widget/verticalspan")
local _ = require("gettext")

local CatalogUtil = require("bookorbit_catalog_util")
local BoardMetrics = require("bookorbit_board_metrics")

local px = BoardMetrics.px
local shortText = CatalogUtil.shortText
local firstAuthor = CatalogUtil.firstAuthor

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

-- Mirrors TextBoxWidget's own line height math so text blocks can be sized in
-- whole lines (same helper as the detail page uses).
local function lineHeight(face)
    return math.floor(1.3 * face.size + 0.5)
end

-- A device with a D-Pad but no touchscreen (Kindle 3/4 and friends) drives the
-- catalog entirely through FocusManager, so every tappable widget has to be
-- able to draw the cursor that says where the next Press will land. Touch
-- devices never show it, so they never pay for the extra frame.
local FOCUS_NAV = Device:hasDPad() and not Device:isTouchDevice()
--- Wraps a widget's root container in a frame that paints a focus box while the
--- FocusManager has it selected. The box is an *inner* border, drawn within the
--- frame's own bounds, so the widget measures the same focused or not: the
--- dashboard and detail pages lay themselves out from fixed dimensions, and a
--- cursor that changed a widget's size would reflow the page under it.
function CatalogWidgets.focusable(child)
    if not FOCUS_NAV then return child end
    return FrameContainer:new{
        margin = 0,
        padding = 0,
        bordersize = 0,
        focusable = true,
        focus_inner_border = true,
        focus_border_size = px(3),
        child,
    }
end

--- Whether the running device navigates by focus rather than by touch. Callers
--- use it to skip focus bookkeeping that would be dead weight on a touchscreen.
function CatalogWidgets.focusNavigation()
    return FOCUS_NAV
end

--- Gives a stock KOReader menu row the same focus box as the widgets above.
---
--- Menu marks its focused row with a hairline underneath it. Upstream calls that
--- line "really, really, really thin" and declines to thicken it because doing
--- so shifts the row's text; on a list of rows that already have separators it
--- is not a cursor a reader can find. An inner border is as visible as the boxes
--- everywhere else in the catalog and changes no geometry, so it does not carry
--- that cost. Applied to the item's own frame, which answers the Focus event
--- before the row does and so replaces the underline rather than adding to it.
function CatalogWidgets.focusableMenuItem(item)
    if not FOCUS_NAV then return end
    local frame = item and item[1]
    if type(frame) ~= "table" or frame.focusable then return end
    frame.focusable = true
    frame.focus_inner_border = true
    frame.focus_border_size = px(3)
end

-- Absolute paths to the plugin's own SVG icons, resolved once by the catalog
-- (widgets cannot know the plugin directory). A missing entry falls back to
-- the stock KOReader glyph named alongside it.
local asset_icon_files = {}

function CatalogWidgets.setAssetIconFiles(files)
    asset_icon_files = type(files) == "table" and files or {}
end

function CatalogWidgets.assetIconFile(name)
    return asset_icon_files[name]
end

local function readStatusBadgeIcon(book)
    local status = book and book.readStatus
    if not status or status == "" or status == "unread" then return nil end
    return READ_STATUS_BADGE_ICONS[status] or "dogear.reading"
end

-- The dogear assets are drawn as a top-left page fold, and the badge sits in
-- the cover's top-right corner, so those need a quarter turn. The rest of the
-- set are upright glyphs that must not be turned with them.
local function readStatusBadgeRotation(icon)
    return icon:match("^dogear%.") and 270 or 0
end

local function rowFontSize(nominal, max_size, row_h)
    local size = math.floor(nominal * row_h / px(64))
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
    local dp = BoardMetrics.get().dp
    local height_size = math.floor(height / dp * 0.46)
    local width_size = math.floor(width / dp / math.max(8, math.min(longest, 16)) * 2.05)
    local card_size = math.floor(width / dp * (1 / 9.5))
    return math.max(13, math.min(20, height_size, width_size, card_size))
end

-- A slim borderless progress bar, e-ink friendly (no animation): a light-gray
-- track with a solid black fill, used to visualize reading progress on cards.
function CatalogWidgets.buildProgressBar(percentage, width)
    if not percentage or percentage <= 0 then return nil end
    local bar = ProgressWidget:new{
        width = width,
        height = px(3),
        percentage = math.min(1, percentage / 100),
        margin_h = 0,
        margin_v = 0,
        bordersize = 0,
        bgcolor = Blitbuffer.COLOR_LIGHT_GRAY,
        fillcolor = Blitbuffer.COLOR_BLACK,
    }
    return bar
end

function CatalogWidgets.buildFakeCover(book, width, height, footer, quiet, bordersize)
    bordersize = bordersize or math.max(1, px(0.5))
    local padding = px(5)
    local inner_w = math.max(1, width - 2 * padding - 2 * bordersize)
    local inner_h = math.max(1, height - 2 * padding - 2 * bordersize)
    if quiet then
        local label = TextWidget:new{
            text = footer or _("No cover"),
            face = BoardMetrics.namedFace("xx_smallinfofont", 18),
            fgcolor = Blitbuffer.COLOR_DARK_GRAY,
            max_width = inner_w,
        }
        -- On a narrow cover the label survives only as an initial and an
        -- ellipsis, which reads as damage; an empty frame says "no cover"
        -- better than "C..." does.
        if label:isTruncated() then
            label:free()
            label = HorizontalSpan:new{ width = inner_w }
        end
        return FrameContainer:new{
            width = width,
            height = height,
            margin = 0,
            padding = padding,
            bordersize = bordersize,
            background = Blitbuffer.COLOR_WHITE,
            CenterContainer:new{
                dimen = Geom:new{ w = inner_w, h = inner_h },
                label,
            },
        }
    end

    -- Blocks are measured in whole lines and each takes only what it needs, so
    -- the group can be centred in the cover box. Splitting the box into fixed
    -- proportions instead left a short title floating above a band of white and
    -- clipped a two-word author to "Arkady...". Anything that still does not fit
    -- is dropped from the bottom up rather than ellipsized into a fragment.
    -- Sized explicitly: the face defaults run 22/20/18, so leaving the author
    -- and footer unsized set them larger than a title asked for at 16 and stood
    -- the hierarchy on its head.
    local title_face = BoardMetrics.namedFace("smallinfofont", 17)
    local author_face = BoardMetrics.namedFace("x_smallinfofont", 14)
    local footer_face = BoardMetrics.namedFace("xx_smallinfofont", 12)
    local gap = px(2)
    local author = book and firstAuthor(book) or nil
    local has_footer = footer ~= nil and footer ~= ""

    local function textBlock(text, face, max_lines)
        return TextBoxWidget:new{
            text = text,
            width = inner_w,
            height = max_lines * lineHeight(face),
            height_adjust = true,
            alignment = "center",
            face = face,
            height_overflow_show_ellipsis = true,
        }
    end

    local function buildContent(with_author, with_footer)
        local group = VerticalGroup:new{ align = "center" }
        table.insert(group, textBlock(
            BD.auto(shortText(book and book.title or _("Untitled"), 60)), title_face, 3))
        if with_author then
            table.insert(group, VerticalSpan:new{ width = gap })
            table.insert(group, textBlock(BD.auto(shortText(author, 44)), author_face, 2))
        end
        if with_footer then
            table.insert(group, VerticalSpan:new{ width = gap })
            table.insert(group, textBlock(footer, footer_face, 2))
        end
        return group
    end

    local content = buildContent(author ~= nil, has_footer)
    if content:getSize().h > inner_h and has_footer then
        content = buildContent(author ~= nil, false)
    end
    if content:getSize().h > inner_h and author then
        content = buildContent(false, false)
    end

    return FrameContainer:new{
        width = width,
        height = height,
        margin = 0,
        padding = padding,
        bordersize = bordersize,
        background = Blitbuffer.COLOR_WHITE,
        CenterContainer:new{
            dimen = Geom:new{ w = inner_w, h = inner_h },
            content,
        },
    }
end

-- opts.no_border drops the cover's own outline for callers that already draw
-- one around it (the dashboard cards), so a card is not ringed twice.
-- opts.quiet_placeholder swaps the titled fake cover for a bare one while a
-- cover is still downloading.
function CatalogWidgets.buildCoverWidget(book, width, height, path, state, opts)
    opts = opts or {}
    local bordersize = opts.no_border and 0 or math.max(1, px(0.5))
    if path then
        local inner_w = math.max(1, width - 2 * bordersize)
        local inner_h = math.max(1, height - 2 * bordersize)
        return FrameContainer:new{
            width = width,
            height = height,
            margin = 0,
            padding = 0,
            bordersize = bordersize,
            background = Blitbuffer.COLOR_WHITE,
            CenterContainer:new{
                dimen = Geom:new{ w = inner_w, h = inner_h },
                ImageWidget:new{
                    file = path,
                    width = inner_w,
                    height = inner_h,
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
    -- Quiet placeholders are reserved for covers still loading; a cover that is
    -- missing or failed keeps the titled fake cover so the book stays
    -- identifiable on caption-less shelves. always_quiet is for callers whose
    -- own row already names the book, where a titled placeholder would only
    -- repeat it - badly, since those covers are far too narrow to set it in.
    local quiet = opts.always_quiet == true
        or (opts.quiet_placeholder == true and state == "loading")
    return CatalogWidgets.buildFakeCover(book, width, height, footer, quiet, bordersize)
end

-- Badges sit on a small white plate so they stay legible over busy cover art;
-- a bare glyph disappears against dark covers on e-ink.
local function badgeChip(icon_widget)
    return FrameContainer:new{
        margin = 0,
        padding = px(1),
        bordersize = math.max(1, px(0.5)),
        radius = px(2),
        background = Blitbuffer.COLOR_WHITE,
        icon_widget,
    }
end

function CatalogWidgets.buildReadStatusBadge(book, max_width)
    local icon = readStatusBadgeIcon(book)
    if not icon then return nil end

    local size = math.max(px(10), math.min(max_width, px(16)))
    return badgeChip(IconWidget:new{
        icon = icon,
        rotation_angle = readStatusBadgeRotation(icon),
        width = size,
        height = size,
    })
end

function CatalogWidgets.buildSelectionBadge(max_width)
    local size = math.max(px(13), math.min(max_width, px(22)))
    return badgeChip(IconWidget:new{
        icon = "check",
        width = size,
        height = size,
    })
end

-- IconWidget resolves either a stock glyph name or an absolute file path;
-- never hand it both.
local function iconOrFile(icon, file)
    if file then return { file = file } end
    return { icon = icon }
end

function CatalogWidgets.buildDownloadedBadge(max_width)
    local size = math.max(px(11), math.min(max_width, px(18)))
    local opts = iconOrFile("appbar.filebrowser", CatalogWidgets.assetIconFile("on_device"))
    opts.width = size
    opts.height = size
    return badgeChip(IconWidget:new(opts))
end

function CatalogWidgets.buildCoverWithStateBadges(book, width, height, path, state, downloaded, selected, cover_opts)
    local cover = CatalogWidgets.buildCoverWidget(book, width, height, path, state, cover_opts)
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
    -- Reserved for every cell, drawn only where there is progress: sizing the
    -- cell from whether this particular book has a bar left covers in the same
    -- row sitting a few pixels off each other.
    local progress_h = px(3)
    local bar_reserve = progress_h + px(2)
    local label_h = show_label and math.max(px(44), math.floor(self.dimen.h * 0.24)) or 0
    local label_gap = show_label and px(2) or 0
    local max_cover_w = math.max(1, self.dimen.w - 2 * px(5))
    local available_cover_h = math.max(1, self.dimen.h - label_h - label_gap - bar_reserve)
    local cover_h = math.min(available_cover_h, math.floor(max_cover_w / 0.68))
    cover_h = math.max(math.min(px(60), available_cover_h), cover_h)
    local cover_w = math.min(max_cover_w, math.floor(cover_h * 0.68))

    local path, state = self.menu:thumbnailDisplay(book)
    local downloaded = self.menu:isOnDevice(book)
    local selected = self.menu.bulkIsBookSelected and self.menu:bulkIsBookSelected(book)
    local content = VerticalGroup:new{ align = "center" }
    table.insert(
        content,
        -- With labels on, the cell already names the book below the cover, so a
        -- titled placeholder would just say it twice.
        CatalogWidgets.buildCoverWithStateBadges(
            book, cover_w, cover_h, path, state, downloaded, selected,
            { always_quiet = show_label }))
    local bar = CatalogWidgets.buildProgressBar(book and book.progressPercentage, cover_w)
    table.insert(content, VerticalSpan:new{ width = px(2) })
    table.insert(content, bar or VerticalSpan:new{ width = progress_h })
    if show_label then
        local label_text = shortText(book and book.title or _("Untitled"), 30)
        local label_w = math.max(1, self.dimen.w - 2 * px(1))
        table.insert(content, VerticalSpan:new{ width = px(2) })
        table.insert(content, TextBoxWidget:new{
            text = label_text,
            width = label_w,
            height = label_h,
            alignment = "center",
            fgcolor = selectedTextColor(selected),
            bgcolor = selectedTextBgColor(selected),
            face = BoardMetrics.namedFace("cfont", mosaicLabelFontSize(label_text, label_w, label_h)),
            height_overflow_show_ellipsis = true,
        })
    end

    local body = CenterContainer:new{
        dimen = Geom:new{ w = self.dimen.w, h = self.dimen.h },
        content,
    }
    self[1] = CatalogWidgets.focusable(FrameContainer:new{
        width = self.dimen.w,
        height = self.dimen.h,
        margin = 0,
        padding = 0,
        bordersize = 0,
        background = selectedBackground(selected),
        body,
    })
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
    local pad = px(2)
    local gap = px(10)
    local separator_h = math.max(1, px(1))
    local inner_h = math.max(1, self.dimen.h - separator_h)
    local content_h = math.max(1, inner_h - 2 * px(2))
    local cover_h = math.max(px(38), math.min(px(74), content_h))
    local cover_w = math.floor(cover_h * 0.68)
    -- Reserved on every row so the title and subtitle sit on the same lines
    -- whether or not this book has a progress bar under them.
    local progress_h = px(3)
    local bar_reserve = progress_h + px(2)
    local left_w = cover_w + 2 * pad
    local side_meta_text = self.menu:listSideMetaText(book)
    local show_side_meta = side_meta_text ~= "" and self.dimen.w >= px(520)
    local right_w = show_side_meta and math.min(px(168), math.floor(self.dimen.w * 0.20)) or 0
    local right_pad = show_side_meta and pad or 0
    local main_x = left_w + gap
    local main_w = math.max(1, self.dimen.w - main_x - right_w - right_pad - gap)
    local text_h = math.max(1, content_h - bar_reserve)
    local title_font = rowFontSize(18, 20, inner_h)
    local subtitle_font = rowFontSize(14, 16, inner_h)
    local side_font = rowFontSize(13, 15, inner_h)
    local title_h = math.max(1, math.floor(text_h * 0.52))
    local subtitle_h = math.max(1, text_h - title_h)

    local path, state = self.menu:thumbnailDisplay(book)
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
        face = BoardMetrics.namedFace("cfont", title_font),
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
            face = BoardMetrics.namedFace("cfont", subtitle_font),
            height_overflow_show_ellipsis = true,
        })
    end

    local body_col = VerticalGroup:new{ align = "left" }
    table.insert(body_col, text_col)
    local bar = CatalogWidgets.buildProgressBar(book and book.progressPercentage, main_w)
    table.insert(body_col, VerticalSpan:new{ width = px(2) })
    table.insert(body_col, bar or VerticalSpan:new{ width = progress_h })

    local row_dimen = Geom:new{ w = self.dimen.w, h = inner_h }
    local row = OverlapGroup:new{
        dimen = row_dimen:copy(),
        LeftContainer:new{
            dimen = row_dimen:copy(),
            CenterContainer:new{
                dimen = Geom:new{ w = left_w, h = inner_h },
                -- The meta column already spells out "On device", so the badge
                -- would only repeat it on a cover far too small to spare the
                -- room; it stays for the narrow layouts that hide that column.
                CatalogWidgets.buildCoverWithStateBadges(
                    book, cover_w, cover_h, path, state,
                    downloaded and not show_side_meta, selected,
                    { always_quiet = true }),
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
                    face = BoardMetrics.namedFace("cfont", side_font),
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

    self[1] = CatalogWidgets.focusable(FrameContainer:new{
        width = self.dimen.w,
        height = self.dimen.h,
        margin = 0,
        padding = 0,
        bordersize = 0,
        background = selectedBackground(selected),
        content,
    })
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

-- Shared card chrome: thin rounded border on a white fill.
CatalogWidgets.MosaicItem = MosaicItem
CatalogWidgets.ListItem = ListItem

return CatalogWidgets
