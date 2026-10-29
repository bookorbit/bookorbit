--[[--
The dashboard's widgets. Each takes the board context, a tile size in pixels
and the widget's props, and returns content of exactly that size.

A widget lays itself out for the box it gets: one with several layouts tries
them from richest to most compact and keeps the first that fits (see
BoardUI.pick), so every widget works at every size on every screen. The
dimensions and spacing are in dp and mirror the design mocks one for one.
]]

local datetime = require("datetime")
local T = require("ffi/util").template
local _ = require("gettext")

local BoardColour = require("bookorbit_board_colour")
local BoardData = require("bookorbit_board_data")
local BoardStore = require("bookorbit_board_store")
local BoardMetrics = require("bookorbit_board_metrics")
local BoardUI = require("bookorbit_board_ui")

local INK = BoardMetrics.INK
local px, lh1, lh = BoardMetrics.px, BoardMetrics.lh1, BoardMetrics.lh
local text, runs, vstack, hstack, flex, space = BoardUI.text, BoardUI.runs, BoardUI.vstack, BoardUI.hstack, BoardUI.flex, BoardUI.space
local icon, bar, rect, pick = BoardUI.icon, BoardUI.bar, BoardUI.rect, BoardUI.pick

local W = {}
local BoardWidgets = { W = W }

local function clamp(v, lo, hi)
    if v < lo then return lo end
    if v > hi then return hi end
    return v
end

local function thin() return math.max(1, px(0.75)) end

local function firstAuthor(book)
    return book and type(book.authors) == "table" and book.authors[1] or nil
end

-- A font size that fills `room` px of height, as the mocks compute it.
local function fillSize(room, lo, hi)
    return clamp(math.floor(room / 1.36 / BoardMetrics.get().dp), lo, hi)
end

-- The label row every tile starts with: bold label left, an optional widget
-- right, at least 4dp between them. A label too long for a narrow tile steps
-- down a size or two before it is cut; a tile's layouts share it, so this
-- never changes which layout wins.
local function head(iw, label, right, o)
    o = o or {}
    local rw = right and right:getSize().w or 0
    local room = right and (iw - rw - px(4)) or iw
    local size = 13
    local lab = BoardUI.text(label, { s = size, b = true, col = o.col })
    while lab:getSize().w > room and size > 11 do
        size = size - 1
        lab = BoardUI.text(label, { s = size, b = true, col = o.col })
    end
    if lab:getSize().w > room then
        lab = BoardUI.text(label, { s = size, b = true, col = o.col, w = math.max(1, room) })
    end
    return BoardUI.spread(iw, lab, right, lh1(13))
end

-- An empty widget's hint in the lines it needs, at the largest of `sizes`
-- that fits `room`, so a short tile neither cuts it nor reserves lines it
-- leaves empty. o: sizes, i, serif, col.
local function hint(str, iw, room, o)
    o = o or {}
    local f = BoardUI.fitTitle(str, { i = o.i, serif = o.serif }, iw, o.sizes or { 13, 12, 11 }, 4, room)
    return text(str, { s = f.s, i = o.i, serif = o.serif, col = o.col or INK.g4, lines = f.lines > 1 and f.lines or nil, w = iw })
end

local function dots(flags, size, gap, o)
    local items = {}
    for i = 1, 7 do
        table.insert(items, BoardUI.dot(size, flags[i] == true, o))
    end
    return hstack({ gap = gap }, items)
end

local function cover(ctx, book, w, h, o)
    o = o or {}
    return BoardUI.cover(book, w, h, {
        path = book and book.cover_path,
        loading = book and book.cover_state == "loading",
        border = o.border or thin(),
        border_col = o.border_col or BoardColour.coverEdge(ctx, INK.gb),
        dim = o.dim,
    })
end

local function offlineDim(ctx, book)
    return not ctx.d.online and book and not book.on_device
end

-- ------------------------------------------------------- continue reading
-- disabled draws it like the full Download pill offline: gray, so it does
-- not look like a button that works.
local function roundButton(ctx, d, icon_name, filled, ink, disabled)
    local bg = disabled and INK.g4 or ink and INK.white or INK.black
    return BoardUI.circle(d, { bg = bg }, icon(icon_name, math.floor(d * (filled and 0.36 or 0.42) + 0.5), {
        col = disabled and "g6" or ink and "black" or "white", fill = filled, sw = 2.25,
    }))
end

W.hero = function(ctx, w, hh)
    local d = ctx.d
    local book = d.continue_reading[1]
    local total = #d.continue_reading
    local tall = hh >= px(170)
    local pad = px(tall and 16 or 12)
    local iw, ih = w - 2 * pad, hh - 2 * pad

    if not book then
        local variants = {}
        local copies = { _("Three picks from your library"), _("Pick a book to start"), _("Start here") }
        local picks = d.shelves["random"] or {}
        for n = 3, 0, -1 do
            for ci, copy in ipairs(copies) do
                table.insert(variants, function()
                    local ch = tall and math.min(ih - px(4), px(150)) or ih
                    local cw = math.floor(ch * 2 / 3 + 0.5)
                    local g2 = px(8)
                    local btn_d = math.min(px(tall and 48 or 52), ih)
                    local covers = {}
                    for i = 1, math.min(n, #picks) do
                        table.insert(covers, cover(ctx, picks[i], cw, ch, { border = math.max(1, px(1)), border_col = INK.g6 }))
                    end
                    local tw = math.max(1, iw - (n * cw + (n - 1) * g2) - btn_d - px(28))
                    local label = (ci == 1 and n ~= 3) and _("Picks from your library") or copy
                    return hstack({ w = w, h = hh }, {
                        space(pad, 1),
                        vstack({ w = tw }, {
                            text(_("Start reading"), { s = 11, b = true, col = BoardColour.onInk(ctx, INK.gb, "hero"), w = tw }),
                            space(nil, px(3)),
                            text(label, { s = 16, b = true, col = INK.white, lines = 2, w = tw }),
                        }),
                        space(px(14), 1),
                        hstack({ gap = g2, valign = "bottom" }, covers),
                        space(px(14), 1),
                        BoardUI.hit(roundButton(ctx, btn_d, "shuffle", false, true), { kind = "shuffle" }),
                        flex(0),
                    })
                end)
            end
        end
        if tall then
            local function stacked(n)
                return function()
                    local g2 = px(8)
                    local btn_h = px(38)
                    local ch = math.min(px(120), ih - lh1(11) - px(3) - 2 * lh(16) - px(10) - px(10) - btn_h)
                    local cw = math.min(math.floor(ch * 2 / 3 + 0.5), math.floor((iw - (n - 1) * g2) / n))
                    local covers = {}
                    for i = 1, math.min(n, #picks) do
                        table.insert(covers, cover(ctx, picks[i], cw, math.floor(cw * 1.5 + 0.5), { border = math.max(1, px(1)), border_col = INK.g6 }))
                    end
                    local shuffle = BoardUI.box({ w = BoardUI.runs({ _("Shuffle") }, { s = 14 }):getSize().w + px(16) + px(13) + px(16) + px(8), h = btn_h, radius = math.floor(btn_h / 2), bg = INK.white },
                        hstack({ h = btn_h, gap = px(8) }, { space(px(13), 1), icon("shuffle", px(16), { sw = 2.25 }), text(_("Shuffle"), { s = 14, b = true }) }))
                    return vstack({ w = w, h = hh, pad = pad }, {
                        text(_("Start reading"), { s = 11, b = true, col = BoardColour.onInk(ctx, INK.gb, "hero"), w = iw }),
                        space(nil, px(3)),
                        text(_("Pick a book from your library to begin"), { s = 16, b = true, col = INK.white, lines = 2, w = iw }),
                        flex(px(10)),
                        hstack({ gap = g2, valign = "bottom" }, covers),
                        space(nil, px(10)),
                        shuffle,
                    })
                end
            end
            table.insert(variants, 1, stacked(3))
            table.insert(variants, stacked(2))
        end
        return pick(variants)
    end

    local pct = tonumber(book.progressPercentage) or 0
    local play_icon = book.on_device and "play" or "download"

    if not tall then
        local ch = ih
        local btn_d = math.min(px(56), ch)
        -- The cover gives way before the title and progress: a tall, narrow
        -- tile keeps at least 110dp for them.
        local cw2 = math.min(math.floor(ch * 2 / 3 + 0.5), math.max(px(36), w - 2 * pad - btn_d - px(28) - px(110)))
        local cover_h = math.min(ch, math.floor(cw2 * 1.5 + 0.5))
        local tw2 = math.max(1, w - 2 * pad - cw2 - btn_d - px(28))
        local function label(lv)
            if lv == 2 then
                return total > 1 and T(_("Continue reading · %1 of %2"), 1, total) or _("Continue reading")
            end
            if lv == 1 then return _("Continue reading") end
        end
        local function meta(mv)
            local m = { { t = BoardData.pctLabel(book) or "0%", b = true, col = INK.white } }
            if mv == 2 and book.minutes_left then
                table.insert(m, { t = " · " .. T(_("%1 left"), BoardData.formatDuration(book.minutes_left)), col = BoardColour.onInk(ctx, INK.gc, "hero") })
            elseif mv == 1 and book.minutes_left then
                table.insert(m, { t = " · " .. T(_("%1 left"), BoardData.formatShortDuration(book.minutes_left)), col = BoardColour.onInk(ctx, INK.gc, "hero") })
            end
            return m
        end
        local variants = {}
        for _i, lm in ipairs({ { 2, 2 }, { 1, 2 }, { 2, 1 }, { 1, 1 }, { 1, 0 }, { 0, 1 }, { 0, 0 } }) do
            table.insert(variants, function()
                local lab = label(lm[1])
                local avail = ch - (lab and (lh1(11) + px(3)) or 0) - px(7) - lh1(12)
                local tf = BoardUI.fitTitle(book.title, { b = true }, tw2, { 18, 16, 15 }, 2, avail)
                local m = runs(meta(lm[2]), { s = 12 })
                local mw = math.min(math.floor(tw2 * 0.62 + 0.5), m:getSize().w + px(2), math.max(1, tw2 - px(30)))
                m = runs(meta(lm[2]), { s = 12, w = mw, data = true })
                return hstack({ w = w, h = hh }, {
                    space(pad, 1),
                    cover(ctx, book, cw2, cover_h, { border = math.max(1, px(1)), border_col = INK.g4 }),
                    space(px(14), 1),
                    vstack({ w = tw2, h = ch }, {
                        flex(0),
                        lab and text(lab, { s = 11, b = true, col = BoardColour.onInk(ctx, INK.gb, "hero"), w = tw2 }) or false,
                        lab and space(nil, px(3)) or false,
                        text(book.title, { s = tf.s, b = true, col = INK.white, lines = tf.lines, w = tw2, data = true }),
                        space(nil, px(7)),
                        hstack({ w = tw2, gap = px(10) }, { bar(math.max(px(20), tw2 - mw - px(10)), px(5), pct, { track = BoardColour.inkTrack(ctx, INK.g5, "hero"), fill = INK.white, r = px(2.5) }), m }),
                        flex(0),
                    }),
                    space(px(14), 1),
                    BoardUI.hit(roundButton(ctx, btn_d, play_icon, book.on_device, true, not book.on_device and not d.online), { kind = "book", book = book, resume = true, list = { label = _("Continue reading"), books = d.continue_reading } }),
                    flex(0),
                })
            end)
        end
        return pick(variants)
    end

    local offline = not d.online
    local function btn(short)
        local disabled = not book.on_device and offline
        local fg = disabled and INK.g6 or INK.black
        local label = book.on_device and (short and _("Resume") or _("Resume reading")) or _("Download")
        local inner = hstack({ h = px(40), gap = px(8) }, {
            space(px(13) - px(8), 1),
            icon(play_icon, px(book.on_device and 14 or 16), { col = disabled and "g6" or "black", fill = book.on_device, sw = 2.25 }),
            text(label, { s = 14, b = true, col = fg }),
            space(px(16) - px(8), 1),
        })
        return BoardUI.hit(BoardUI.box({ w = inner:getSize().w, h = px(40), radius = px(20), bg = disabled and INK.g4 or INK.white }, inner),
            { kind = "book", book = book, resume = true, list = { label = _("Continue reading"), books = d.continue_reading } })
    end
    local function ghost()
        return BoardUI.hit(BoardUI.circle(px(40), { border = math.max(1, px(1.5)), border_col = INK.white }, icon("ellipsis", px(18), { col = "white", sw = 2.5 })),
            { kind = "book-actions", book = book })
    end
    local function pager()
        if total <= 1 then return nil end
        return hstack({ gap = px(2) }, { text(T(_("%1 / %2"), 1, total), { s = 12, col = BoardColour.onInk(ctx, INK.gb, "hero") }), icon("chevron-right", px(15), { col = BoardColour.onInkHex(ctx, "gb", "hero"), sw = 2.5 }) })
    end
    local function meta(full)
        local m = { { t = tostring(math.floor(pct + 0.5)) .. "%", b = true, col = INK.white } }
        if book.minutes_left then
            local dur = full and BoardData.formatDuration(book.minutes_left) or BoardData.formatShortDuration(book.minutes_left)
            table.insert(m, { t = " · " .. T(_("%1 left"), dur), col = BoardColour.onInk(ctx, INK.gc, "hero") })
        end
        return m
    end
    local function side(opt)
        return function()
            local cover_h = ih
            local cover_w = math.min(math.floor(cover_h * 2 / 3 + 0.5), math.floor(iw * 0.4 + 0.5))
            local gutter = px(16)
            local tw = iw - cover_w - gutter
            local label_gap = px(opt.compact and 4 or 8)
            local author_gap = px(opt.compact and 4 or 6)
            local progress_gap = px(opt.compact and 4 or 10)
            local meta_gap = px(opt.compact and 4 or 8)
            local action_gap = px(opt.compact and 8 or 12)
            local fixed = lh1(12) + label_gap + author_gap + lh1(15) + progress_gap + px(6) + meta_gap + lh1(13) + action_gap + px(40)
            local tf = BoardUI.fitTitle(book.title, { b = true }, tw, { 26, 23, 20, 18, 16 }, 3, cover_h - fixed)
            local actions = opt.ghost and hstack({ gap = px(8) }, { btn(opt.short), ghost() }) or btn(opt.short)
            local label = text(_("Continue reading"), { s = 12, b = true, col = BoardColour.onInk(ctx, INK.gb, "hero") })
            return hstack({ w = w, h = hh, valign = "top" }, {
                space(pad, 1),
                -- A cover narrower than the column's height is centred in it,
                -- not hung above a band of empty tile.
                vstack({ w = cover_w, h = hh, pad = { pad, 0, pad, 0 } }, { flex(0), cover(ctx, book, cover_w, math.min(cover_h, math.floor(cover_w * 1.5 + 0.5)), { border = math.max(1, px(1)), border_col = INK.g4 }), flex(0) }),
                space(gutter, 1),
                vstack({ w = tw, h = hh, pad = { pad, 0, pad, 0 }, strict_padding = true }, {
                    opt.pager and BoardUI.spread(tw, label, pager()) or label,
                    space(nil, label_gap),
                    text(book.title, { s = tf.s, b = true, col = INK.white, lines = tf.lines, w = tw, data = true }),
                    space(nil, author_gap),
                    text(firstAuthor(book) or "", { s = 15, col = BoardColour.onInk(ctx, INK.gd, "hero"), w = tw, data = true }),
                    flex(progress_gap),
                    bar(tw, px(6), pct, { track = BoardColour.inkTrack(ctx, INK.g5, "hero"), fill = INK.white, r = px(3) }),
                    space(nil, meta_gap),
                    runs(meta(opt.full_meta), { s = 13, w = tw }),
                    space(nil, action_gap),
                    actions,
                }),
            })
        end
    end
    -- Short and narrow (2x2 on a 6" reader): the cover keeps the full height,
    -- and Resume becomes a round button beside the progress.
    local function sideCompact(opt)
        return function()
            local cover_h = ih
            local cover_w = math.min(math.floor(cover_h * 2 / 3 + 0.5), math.floor(iw * 0.42 + 0.5))
            local gutter = px(14)
            local tw = iw - cover_w - gutter
            local btn_d = px(40)
            local author_h = opt.author and (px(4) + lh1(13)) or 0
            local fixed = lh1(12) + px(6) + px(8) + btn_d
            local tf = BoardUI.fitTitle(book.title, { b = true }, tw, { 18, 16, 15 }, 3, cover_h - fixed - author_h)
            local bar_w = tw - btn_d - px(10)
            return hstack({ w = w, h = hh, valign = "top" }, {
                space(pad, 1),
                -- A cover narrower than the column's height is centred in it,
                -- not hung above a band of empty tile.
                vstack({ w = cover_w, h = hh, pad = { pad, 0, pad, 0 } }, { flex(0), cover(ctx, book, cover_w, math.min(cover_h, math.floor(cover_w * 1.5 + 0.5)), { border = math.max(1, px(1)), border_col = INK.g4 }), flex(0) }),
                space(gutter, 1),
                vstack({ w = tw, h = hh, pad = { pad, 0, pad, 0 }, strict_padding = true }, {
                    text(_("Continue reading"), { s = 12, b = true, col = BoardColour.onInk(ctx, INK.gb, "hero"), w = tw }),
                    space(nil, px(6)),
                    text(book.title, { s = tf.s, b = true, col = INK.white, lines = tf.lines, w = tw, data = true }),
                    opt.author and space(nil, px(4)) or false,
                    opt.author and text(firstAuthor(book) or "", { s = 13, col = BoardColour.onInk(ctx, INK.gd, "hero"), w = tw, data = true }) or false,
                    flex(px(8)),
                    hstack({ w = tw, gap = px(10) }, {
                        vstack({ w = bar_w }, {
                            text(tostring(math.floor(pct + 0.5)) .. "%", { s = 13, b = true, col = INK.white, w = bar_w }),
                            space(nil, px(5)),
                            bar(bar_w, px(6), pct, { track = BoardColour.inkTrack(ctx, INK.g5, "hero"), fill = INK.white, r = px(3) }),
                        }),
                        BoardUI.hit(roundButton(ctx, btn_d, play_icon, book.on_device, true, not book.on_device and not d.online), { kind = "book", book = book, resume = true, list = { label = _("Continue reading"), books = d.continue_reading } }),
                    }),
                }),
            })
        end
    end
    local function stacked(opt)
        return function()
            local bottom_h = px(6) + px(8) + lh1(13) + px(12) + px(40)
            local top_h = ih - lh1(12) - px(8) - bottom_h - px(8)
            local cover_h = math.max(px(40), math.min(top_h, px(120)))
            local cover_w = math.floor(cover_h * 2 / 3 + 0.5)
            local tw = iw - cover_w - px(12)
            local tf = BoardUI.fitTitle(book.title, { b = true }, tw, { 20, 18, 16, 15 }, 3, cover_h - (opt.author and (lh1(13) + px(4)) or 0))
            local label = text(_("Continue reading"), { s = 12, b = true, col = BoardColour.onInk(ctx, INK.gb, "hero") })
            return vstack({ w = w, h = hh, pad = pad, strict_padding = true }, {
                opt.pager and BoardUI.spread(iw, label, pager()) or label,
                space(nil, px(8)),
                hstack({ gap = px(12), valign = "top" }, {
                    cover(ctx, book, cover_w, cover_h, { border = math.max(1, px(1)), border_col = INK.g4 }),
                    vstack({ w = tw }, {
                        text(book.title, { s = tf.s, b = true, col = INK.white, lines = tf.lines, w = tw, data = true }),
                        opt.author and space(nil, px(4)) or false,
                        opt.author and text(firstAuthor(book) or "", { s = 13, col = BoardColour.onInk(ctx, INK.gd, "hero"), w = tw, data = true }) or false,
                    }),
                }),
                flex(px(8)),
                bar(iw, px(6), pct, { track = BoardColour.inkTrack(ctx, INK.g5, "hero"), fill = INK.white, r = px(3) }),
                space(nil, px(8)),
                runs(meta(opt.full_meta), { s = 13, w = iw }),
                space(nil, px(12)),
                opt.ghost and hstack({ gap = px(8) }, { btn(opt.short), ghost() }) or btn(opt.short),
            })
        end
    end
    -- The last resort on a short tile: no cover, the title and the round
    -- button beside the progress.
    local function mini()
        return function()
            local btn_d = px(40)
            local bar_w = iw - btn_d - px(10)
            local tf = BoardUI.fitTitle(book.title, { b = true }, iw, { 18, 16, 15 }, 2, ih - lh1(12) - px(6) - px(8) - btn_d)
            return vstack({ w = w, h = hh, pad = pad, strict_padding = true }, {
                text(_("Continue reading"), { s = 12, b = true, col = BoardColour.onInk(ctx, INK.gb, "hero"), w = iw }),
                space(nil, px(6)),
                text(book.title, { s = tf.s, b = true, col = INK.white, lines = tf.lines, w = iw, data = true }),
                flex(px(8)),
                hstack({ w = iw, gap = px(10) }, {
                    vstack({ w = bar_w }, {
                        text(tostring(math.floor(pct + 0.5)) .. "%", { s = 13, b = true, col = INK.white, w = bar_w }),
                        space(nil, px(5)),
                        bar(bar_w, px(6), pct, { track = BoardColour.inkTrack(ctx, INK.g5, "hero"), fill = INK.white, r = px(3) }),
                    }),
                    BoardUI.hit(roundButton(ctx, btn_d, play_icon, book.on_device, true, not book.on_device and not d.online), { kind = "book", book = book, resume = true, list = { label = _("Continue reading"), books = d.continue_reading } }),
                }),
            })
        end
    end
    return pick({
        side({ pager = true, ghost = true, full_meta = true }),
        side({ pager = true, ghost = false, short = true, full_meta = true }),
        side({ pager = false, ghost = false, short = true, full_meta = false }),
        side({ pager = false, ghost = false, short = true, full_meta = false, compact = true }),
        sideCompact({ author = true }),
        sideCompact({ author = false }),
        stacked({ pager = true, ghost = true, author = true, full_meta = true }),
        stacked({ pager = true, ghost = false, author = true, full_meta = true }),
        stacked({ pager = false, ghost = false, short = true, author = true, full_meta = false }),
        stacked({ pager = false, ghost = false, short = true, author = false, full_meta = false }),
        mini(),
    })
end

-- -------------------------------------------------------------- statistics
W.streak = function(ctx, w, hh)
    local d = ctx.d
    local pad = px(12)
    local iw = w - 2 * pad
    local n = d.streak.current
    local wide = w > px(200)
    local val_s = fillSize(hh - 2 * pad - lh1(13) - px(18), 20, wide and 40 or 36)
    local function count(width)
        if n > 0 then
            return runs({ { t = tostring(n), b = true, s = val_s }, { t = " " .. (n == 1 and _("day") or _("days")), col = INK.g4 } }, { s = 13, w = width })
        end
        local rs = math.min(val_s, 18)
        if width then rs = BoardUI.fitSize(_("Read today"), { s = rs, b = true }, width, 12) end
        return runs({ { t = _("Read today"), b = true, s = rs } }, { s = 13, w = width })
    end
    local dot_size = px(wide and 11 or 9)
    local dot_gap = wide and px(7) or math.max(px(3), math.floor((iw - 7 * px(9)) / 6))
    return pick({
        function()
            local dot_row = dots(d.streak_week, dot_size, dot_gap, { col = BoardColour.ink(ctx, INK.black) })
            return vstack({ w = w, h = hh, pad = pad }, {
                head(iw, _("Streak"), icon("flame", px(17), BoardColour.icon(ctx, 2.25))),
                flex(0),
                count(iw),
                flex(0),
                wide and BoardUI.spread(iw, dot_row, text(T(_("best %1"), d.streak.longest), { s = 12, col = INK.g4 })) or dot_row,
            })
        end,
        -- A short row: the week beside the count.
        function()
            return vstack({ w = w, h = hh, pad = pad }, {
                head(iw, _("Streak"), icon("flame", px(17), BoardColour.icon(ctx, 2.25))),
                flex(0),
                BoardUI.spread(iw, count(nil), dots(d.streak_week, dot_size, dot_gap, { col = BoardColour.ink(ctx, INK.black) })),
            })
        end,
        function()
            return vstack({ w = w, h = hh, pad = pad }, {
                head(iw, _("Streak"), icon("flame", px(17), BoardColour.icon(ctx, 2.25))),
                flex(0),
                count(iw),
            })
        end,
    })
end

W.week = function(ctx, w, hh)
    local d = ctx.d
    local pad = px(12)
    local iw = w - 2 * pad
    local max = 1
    for _i, v in ipairs(d.week) do max = math.max(max, v) end
    local bar_w = math.min(px(22), math.floor((iw - 6 * px(6)) / 7))
    local gap = math.floor((iw - 7 * bar_w) / 6)
    local base = math.max(1, px(1))
    local function chart(chart_h)
        local bars = {}
        for i, v in ipairs(d.week) do
            local h = v > 0 and math.max(px(3), math.floor((chart_h - px(2)) * v / max + 0.5)) or px(2)
            local col = v > 0 and (i == 7 and BoardColour.ink(ctx, INK.black) or BoardColour.mid(ctx, INK.g8)) or BoardColour.track(ctx, INK.gc)
            table.insert(bars, BoardUI.rect(bar_w, h, col))
        end
        return vstack({ w = iw }, {
            hstack({ w = iw, h = chart_h - base, gap = gap, valign = "bottom" }, bars),
            rect(iw, base, INK.black),
        })
    end
    local function initials()
        local cells = {}
        for i, t in ipairs(d.week_initials) do
            table.insert(cells, text(t, { s = 11, b = i == 7, col = i == 7 and INK.black or INK.g4, w = bar_w, align = "center" }))
        end
        return hstack({ gap = gap }, cells)
    end
    local long = d.week_min > 0 and BoardData.formatDuration(d.week_min) or _("Nothing yet")
    local short = d.week_min > 0 and BoardData.formatShortDuration(d.week_min) or _("Nothing yet")
    -- A layout only counts when its bars get at least this much height.
    local min_chart = px(12)
    local variants = {}
    -- The total beside the title, then the bars over their weekday initials.
    local beside_h = hh - 2 * pad - lh1(13) - px(8) - lh1(11) - px(4)
    for _i, total in ipairs(beside_h >= min_chart and { long, short } or {}) do
        table.insert(variants, function()
            return vstack({ w = w, h = hh, pad = pad }, {
                head(iw, _("This week"), text(total, { s = 13, b = true })),
                space(nil, px(8)),
                chart(beside_h),
                space(nil, px(4)),
                initials(),
            })
        end)
    end
    -- A single column: the total under the title, initials only with room.
    for _i, with_initials in ipairs({ true, false }) do
        local chart_h = hh - 2 * pad - 2 * lh1(13) - px(6) - (with_initials and (px(4) + lh1(11)) or 0)
        if chart_h >= min_chart or not with_initials then
            table.insert(variants, function()
                return vstack({ w = w, h = hh, pad = pad }, {
                    head(iw, _("This week"), nil),
                    text(short, { s = 13, b = true, w = iw }),
                    space(nil, px(6)),
                    chart(chart_h),
                    with_initials and space(nil, px(4)) or false,
                    with_initials and initials() or false,
                })
            end)
        end
    end
    return pick(variants)
end

W.today = function(ctx, w, hh)
    local d = ctx.d
    local pad = px(12)
    local iw = w - 2 * pad
    local val_s = fillSize(hh - 2 * pad - lh1(13) - px(20), 18, 30)
    local function value()
        return d.today_min > 0
            and runs({ { t = tostring(d.today_min), b = true, s = val_s }, { t = " " .. _("min"), col = INK.g4 } }, { s = 14, w = iw })
            or runs({ { t = _("Not yet"), b = true, s = math.min(val_s, 20) } }, { s = 14, w = iw })
    end
    -- A short row drops the weekly average.
    return pick({
        function()
            return vstack({ w = w, h = hh, pad = pad }, {
                head(iw, _("Today"), icon("clock", px(17), BoardColour.icon(ctx, 2.25))),
                flex(0),
                value(),
                flex(0),
                text(T(_("avg %1 min"), math.floor(d.week_min / 7 + 0.5)), { s = 12, col = INK.g4, w = iw }),
            })
        end,
        function()
            return vstack({ w = w, h = hh, pad = pad }, {
                head(iw, _("Today"), icon("clock", px(17), BoardColour.icon(ctx, 2.25))),
                flex(0),
                value(),
            })
        end,
    })
end

-- Goal pace: how the year's goal is tracking, not only the count.
W.goalpace = function(ctx, w, hh)
    local d = ctx.d
    local g = d.goal
    local pad = px(12)
    local iw = w - 2 * pad
    local goal = g.books or 0
    local done = g.done or 0
    if goal <= 0 then
        local function empty(str)
            return function()
                return vstack({ w = w, h = hh, pad = pad }, {
                    head(iw, T(_("%1 goal"), g.year), icon("target", px(16), BoardColour.icon(ctx, 2.25))),
                    space(nil, px(6)),
                    hint(str, iw, hh - 2 * pad - lh1(13) - px(6)),
                })
            end
        end
        return pick({ empty(_("Set a reading goal in BookOrbit to track your pace.")), empty(_("Set a goal in BookOrbit.")) })
    end
    local expected = goal * d.day_of_year / 365
    local projected = math.floor(done * 365 / math.max(1, d.day_of_year) + 0.5)
    local met = done >= goal
    local statuses
    if done == 0 then
        statuses = { _("First book starts it"), _("Starting out"), _("New") }
    elseif met then
        statuses = { T(_("Goal met · on pace for %1"), projected), T(_("on pace for %1"), projected), _("Goal met") }
    elseif done >= expected then
        local ahead = math.floor(done - expected + 0.5)
        statuses = { T(_("%1 ahead of pace"), ahead), T(_("%1 ahead"), ahead) }
    else
        local behind = math.floor(expected - done + 0.5)
        statuses = { T(_("%1 behind pace"), behind), T(_("%1 behind"), behind) }
    end
    local behind = not met and done > 0 and done < expected
    local trophy = icon(met and "trophy" or "target", px(16), BoardColour.icon(ctx, 2.25))
    local function goalBar()
        local scale = math.max(goal, projected, done, 1)
        local goal_x = math.floor(iw * goal / scale + 0.5)
        local tick_w = math.max(1, px(2))
        local tick = met
            and BoardUI.box({ w = tick_w + 2 * math.max(1, px(1)), h = px(14) + 2 * math.max(1, px(1)), border = math.max(1, px(1)), bg = INK.white })
            or rect(tick_w, px(14), INK.black)
        return BoardUI.overlay(iw, px(14), {
            { widget = bar(iw, px(6), math.floor(100 * done / scale + 0.5), { track = BoardColour.track(ctx, INK.gd), fill = BoardColour.ink(ctx, INK.black), r = px(3) }), x = 0, y = px(4) },
            { widget = tick, x = math.min(iw - px(2), goal_x) - (met and math.max(1, px(1)) or 0), y = met and -math.max(1, px(1)) or 0 },
        })
    end
    local val_s = fillSize(hh - 2 * pad - lh1(13) - lh1(12) - px(10), 20, 32)
    local variants = {}
    for _i, st in ipairs(statuses) do
        for _i, unit in ipairs({ T(_(" of %1 books"), goal), T(_(" of %1"), goal) }) do
            table.insert(variants, function()
                return vstack({ w = w, h = hh, pad = pad }, {
                    head(iw, T(_("%1 goal"), g.year), trophy),
                    flex(0),
                    BoardUI.spread(iw, runs({ { t = tostring(done), b = true, s = 24 }, { t = unit, col = INK.g4 } }, { s = 13 }),
                        text(st, { s = 12, b = behind, col = behind and INK.black or INK.g4 })),
                    space(nil, px(4)),
                    goalBar(),
                })
            end)
        end
    end
    for _i, st in ipairs(statuses) do
        for _i, unit in ipairs({ T(_(" of %1 books"), goal), T(_(" of %1"), goal) }) do
            table.insert(variants, function()
                return vstack({ w = w, h = hh, pad = pad }, {
                    head(iw, T(_("%1 goal"), g.year), trophy),
                    flex(0),
                    runs({ { t = tostring(done), b = true, s = val_s }, { t = unit, col = INK.g4 } }, { s = 13, w = iw }),
                    space(nil, px(5)),
                    text(st, { s = 12, b = behind, col = behind and INK.black or INK.g4, w = iw }),
                })
            end)
        end
    end
    -- A short row: the count with its status beside it, then the count alone.
    for _i, st in ipairs(statuses) do
        table.insert(variants, function()
            return vstack({ w = w, h = hh, pad = pad }, {
                head(iw, T(_("%1 goal"), g.year), trophy),
                flex(0),
                BoardUI.spread(iw, runs({ { t = tostring(done), b = true, s = 20 }, { t = T(_(" of %1"), goal), col = INK.g4 } }, { s = 13 }),
                    text(st, { s = 12, b = behind, col = behind and INK.black or INK.g4 })),
            })
        end)
    end
    table.insert(variants, function()
        return vstack({ w = w, h = hh, pad = pad }, {
            head(iw, T(_("%1 goal"), g.year), trophy),
            flex(0),
            runs({ { t = tostring(done), b = true, s = 20 }, { t = T(_(" of %1"), goal), col = INK.g4 } }, { s = 13, w = iw }),
        })
    end)
    return pick(variants)
end

-- A year of reading days, one square a day, shaded by minutes read.
W.heatmap = function(ctx, w, hh)
    local d = ctx.d
    local pad = px(12)
    local iw = w - 2 * pad
    local g = math.max(1, px(1.5))
    local legend_h = lh1(11)
    local month_h = lh1(11)
    local grid_h = hh - 2 * pad - lh1(13) - px(8) - month_h - px(3) - px(8) - legend_h
    local weeks = 52
    local cell = math.min(math.floor((iw - (weeks - 1) * g) / weeks), math.floor((grid_h - 6 * g) / 7))
    if cell < px(6.5) then
        cell = math.max(px(4), math.min(px(9), math.floor((grid_h - 6 * g) / 7)))
        weeks = math.min(52, math.floor((iw + g) / (cell + g)))
    end
    local offset = (52 - weeks) * 7
    local total, days_read, best, best_i = 0, 0, 0, nil
    for i = offset + 1, #d.heatmap do
        local v = d.heatmap[i] or 0
        total = total + v
        if v > 0 then days_read = days_read + 1 end
        if v > best then best, best_i = v, i end
    end
    local ramp = BoardColour.ramp(ctx, { INK.ge, INK.gb, INK.g8, INK.g4, INK.black })
    local function level(v)
        if v == nil then return nil end
        if v <= 0 then return ramp[1] end
        if v < 30 then return ramp[2] end
        if v < 60 then return ramp[3] end
        if v < 120 then return ramp[4] end
        return ramp[5]
    end
    local grid_w = weeks * cell + (weeks - 1) * g
    local radius = math.max(1, px(1.5))
    local today_i = nil
    for i = 1, #d.heatmap do if d.heatmap[i] ~= nil then today_i = i end end
    local function gridEl()
        local cells = {}
        for wk = 0, weeks - 1 do
            for day = 0, 6 do
                local i = offset + wk * 7 + day + 1
                local col = level(d.heatmap[i])
                if col then
                    table.insert(cells, { x = wk * (cell + g), y = day * (cell + g), col = col, ring = i == today_i })
                end
            end
        end
        return BoardUI.cellGrid(grid_w, 7 * cell + 6 * g, cell, radius, cells)
    end
    local function monthsEl()
        local layers = {}
        local prev_m, prev_x = nil, -999
        for wk = 0, weeks - 1 do
            local t = d.heatmap_start + (offset + wk * 7) * 86400
            local m = tonumber(os.date("%m", t))
            local x = wk * (cell + g)
            if prev_m and m ~= prev_m and x - prev_x >= px(26) and x + px(24) <= grid_w then
                table.insert(layers, { widget = text(BoardData.shortMonth(t), { s = 11, col = INK.g4 }), x = x, y = 0 })
                prev_x = x
            end
            prev_m = m
        end
        return BoardUI.overlay(grid_w, month_h, layers)
    end
    local sw = math.max(px(8), math.min(cell, px(11)))
    local function swatches(words)
        local items = {}
        if words then table.insert(items, text(_("Less"), { s = 11, col = INK.g4 })); table.insert(items, space(px(2), 1)) end
        for _i, v in ipairs({ 0, 20, 45, 90, 200 }) do table.insert(items, rect(sw, sw, level(v), radius)) end
        if words then table.insert(items, space(px(2), 1)); table.insert(items, text(_("More"), { s = 11, col = INK.g4 })) end
        return hstack({ gap = px(3) }, items)
    end
    local function bestEl()
        if not best_i then return text(_("Your reading days fill in here"), { s = 11, col = INK.g4 }) end
        local t = d.heatmap_start + (best_i - 1) * 86400
        return runs({ { t = _("Best day") .. " " }, { t = BoardData.formatShortDuration(best), b = true, col = INK.black },
            { t = ", " .. BoardData.shortWeekday(t) .. " " .. tonumber(os.date("%d", t)) .. " " .. BoardData.shortMonth(t) } }, { s = 11, col = INK.g4 })
    end
    local function legend(lv)
        if lv == -1 then return space(grid_w, legend_h) end
        if lv == 0 then return hstack({ w = grid_w, h = legend_h }, { flex(0), swatches(true) }) end
        return BoardUI.spread(grid_w, bestEl(), swatches(lv == 2), legend_h)
    end
    local label = weeks >= 52 and _("Year in reading") or T(_("Past %1 months"), math.floor(weeks / 4.35 + 0.5))
    local used = lh1(13) + px(8) + month_h + px(3) + 7 * cell + 6 * g + px(8) + legend_h
    local figs = {
        { T(_("%1 h"), math.floor(total / 60 + 0.5)), _("read") },
        { tostring(days_read), _("days") },
        { tostring(d.streak.longest), _("best streak") },
        { T(_("%1 min"), math.floor(total / math.max(1, days_read) + 0.5)), _("a reading day") },
    }
    local function build(lv, nf, head_totals)
        return function()
            local fig_row = nil
            if nf > 0 then
                local items = {}
                for i = 1, nf do
                    if i > 1 then table.insert(items, flex(0)) end
                    table.insert(items, vstack({}, { text(figs[i][1], { s = 20, b = true }), text(figs[i][2], { s = 11, col = INK.g4 }) }))
                end
                fig_row = hstack({ w = grid_w }, items)
            end
            local totals = nil
            if head_totals and total > 0 then
                totals = runs({ { t = T(_("%1 h"), math.floor(total / 60 + 0.5)), b = true }, { t = " · " .. T(_("%1 days"), days_read), col = INK.g4 } }, { s = 13 })
            end
            return vstack({ w = w, h = hh, pad = pad, align = "center" }, {
                head(iw, label, totals),
                space(nil, px(8)),
                monthsEl(), space(nil, px(3)), gridEl(),
                flex(px(8)),
                fig_row or false,
                fig_row and flex(px(8)) or false,
                legend(lv),
            })
        end
    end
    local room_for_figs = total > 0 and hh - 2 * pad - used >= lh1(20) + lh1(11) + px(6)
    local variants = {}
    for _i, nf in ipairs(room_for_figs and { 4, 3, 0 } or { 0 }) do
        for _i, lv in ipairs({ 2, 1, 0, -1 }) do table.insert(variants, build(lv, nf, nf == 0)) end
    end
    table.insert(variants, build(-1, 0, false))
    return pick(variants)
end

W.calendar = function(ctx, w, hh)
    local d = ctx.d
    local pad = px(12)
    local iw = w - 2 * pad
    local now = d.now
    local t = os.date("*t", now)
    local first = os.time({ year = t.year, month = t.month, day = 1, hour = 12 })
    local lead = tonumber(os.date("%w", first))
    local days = tonumber(os.date("%d", os.time({ year = t.year, month = t.month + 1, day = 0, hour = 12 })))
    local today = t.day
    -- Which days of this month had reading, from the heatmap's minutes.
    local read = {}
    for day = 1, today do
        local key_t = os.time({ year = t.year, month = t.month, day = day, hour = 12 })
        local idx = math.floor((key_t - d.heatmap_start) / 86400 + 0.5) + 1
        read[day] = (d.heatmap[idx] or 0) > 0
    end
    local read_count = 0
    for _i, v in pairs(read) do if v then read_count = read_count + 1 end end
    local gap = px(3)
    local month_rows = math.ceil((lead + days) / 7)
    local head_row_h = lh1(11) + px(3)
    local avail_h = hh - 2 * pad - lh1(13) - px(8)
    local month_cell = math.min(math.floor((avail_h - (month_rows - 1) * gap) / month_rows), math.floor((iw - 6 * gap) / 7))
    local numbered = month_cell >= px(24)
    if numbered then
        avail_h = avail_h - head_row_h
        month_cell = math.min(math.floor((avail_h - (month_rows - 1) * gap) / month_rows), math.floor((iw - 6 * gap) / 7))
    end
    local strip = month_cell < px(14)
    local per_row = strip and 16 or 7
    local rows = strip and 2 or month_rows
    local offset = strip and 0 or lead
    local cell = strip and math.min(math.floor((iw - 15 * gap) / 16), math.floor((avail_h - gap) / 2)) or month_cell
    local grid_w = per_row * cell + (per_row - 1) * gap
    local radius = px(numbered and 4 or 2)
    local cells = {}
    local labels = {}
    local outline = math.max(1, px(1))
    for i = 0, rows * per_row - 1 do
        local day = i - offset + 1
        if day >= 1 and day <= days then
            local x, y = (i % per_row) * (cell + gap), math.floor(i / per_row) * (cell + gap)
            local is_read = read[day] == true
            if is_read then
                table.insert(cells, { x = x, y = y, col = day == today and BoardColour.deep(ctx, INK.black) or BoardColour.ink(ctx, INK.g6) })
            else
                table.insert(cells, { x = x, y = y, col = day > today and INK.gd or INK.gb, border = outline })
            end
            if numbered and not strip then
                table.insert(labels, { widget = text(tostring(day), { s = 11, b = day == today, col = is_read and INK.white or (day > today and INK.g8 or INK.g4), w = cell, align = "center" }),
                    x = x, y = y + math.floor((cell - lh1(11)) / 2) })
            end
        end
    end
    local grid_h = rows * cell + (rows - 1) * gap
    table.insert(labels, 1, { widget = BoardUI.cellGrid(grid_w, grid_h, cell, radius, cells) })
    local grid = BoardUI.overlay(grid_w, grid_h, labels)
    local header = nil
    if numbered and not strip then
        local items = {}
        for i = 1, 7 do
            local wd_t = os.time({ year = 2026, month = 10, day = 3 + i, hour = 12 }) -- Sunday 4 Oct 2026
            table.insert(items, text(BoardData.shortWeekday(wd_t):sub(1, 1), { s = 11, col = INK.g4, w = cell, align = "center" }))
        end
        header = vstack({ w = grid_w, h = head_row_h }, { hstack({ gap = gap }, items) })
    end
    return vstack({ w = w, h = hh, pad = pad, align = "center" }, {
        head(iw, BoardData.longMonth(now), text(T(_("%1 days read"), read_count), { s = 12, col = INK.g4 })),
        space(nil, px(8)),
        header or false,
        grid,
        flex(0),
    })
end

-- ------------------------------------------------------------------- lists
W.also = function(ctx, w, hh)
    local d = ctx.d
    local pad = px(12)
    local iw = w - 2 * pad
    local books = {}
    for i = 2, #d.continue_reading do table.insert(books, d.continue_reading[i]) end
    local avail = hh - 2 * pad - lh1(13) - px(6)
    local n = math.max(0, math.min(#books, math.floor(avail / px(46))))
    local row_h = n > 0 and math.min(px(64), math.floor(avail / n)) or px(56)
    local cover_h = math.min(px(44), row_h - px(8))
    local cover_w = math.floor(cover_h * 2 / 3 + 0.5)
    local tw = iw - cover_w - px(10)
    local rows = {}
    for i = 1, n do
        local b = books[i]
        local pct = tonumber(b.progressPercentage) or 0
        local sep = i > 1 and rect(iw, math.max(1, px(0.75)), INK.gc) or nil
        local row_inner_h = row_h - (sep and math.max(1, px(0.75)) or 0)
        -- At least 38dp, wider when a cloud and "100%" need it; the bar gives way.
        local pct_text = text(BoardData.pctLabel(b) or "0%", { s = 12, b = true })
        local content_w = pct_text:getSize().w + ((not b.on_device) and (px(12) + px(3)) or 0)
        local right_w = math.max(px(38), content_w)
        local right = hstack({ w = right_w }, {
            flex(0),
            (not b.on_device) and icon("cloud", px(12), { col = "g4", sw = 2.25 }) or false,
            (not b.on_device) and space(px(3), 1) or false,
            pct_text,
        })
        table.insert(rows, sep or false)
        table.insert(rows, BoardUI.hit(hstack({ w = iw, h = row_inner_h, gap = px(10) }, {
            cover(ctx, b, cover_w, cover_h, { border = thin(), dim = offlineDim(ctx, b) }),
            vstack({ w = tw }, {
                text(b.title, { s = 14, b = true, w = tw, data = true }),
                space(nil, px(5)),
                hstack({ w = tw, gap = px(8) }, { bar(tw - right_w - px(8), px(4), pct, { track = BoardColour.track(ctx, INK.gc), fill = BoardColour.ink(ctx, INK.black), r = px(2) }), right }),
            }),
        }), { kind = "book", book = b, resume = ctx.tap_resumes, list = { label = _("Continue reading"), books = d.continue_reading } }))
    end
    local all = hstack({ gap = px(2) }, { text(T(_("All %1"), d.counts.in_progress or #d.continue_reading), { s = 13, b = true }), icon("chevron-right", px(15), { sw = 2.5 }) })
    local body = n > 0 and vstack({ w = iw }, rows) or text(_("Books you start show up here."), { s = 13, col = INK.g4, w = iw })
    return vstack({ w = w, h = hh, pad = pad }, {
        head(iw, _("Also reading"), all),
        space(nil, px(6)),
        body,
        flex(0),
    })
end

W.highlight = function(ctx, w, hh)
    local d = ctx.d
    local hl = d.highlight
    local pad = px(14)
    local iw = w - 2 * pad
    if not hl then
        local str = _("Your highlights come back here, one a day.")
        local o = { sizes = { 15, 14, 13, 12 }, i = true, serif = true, col = INK.g3 }
        return pick({
            function()
                return vstack({ w = w, h = hh, pad = pad }, {
                    icon("quote", px(20), { fill = true, sw = 1, col = BoardColour.artHex(ctx, "#000000", "deep") }),
                    space(nil, px(8)),
                    hint(str, iw, hh - 2 * pad - px(20) - px(8), o),
                })
            end,
            function() return vstack({ w = w, h = hh, pad = pad }, { hint(str, iw, hh - 2 * pad, o) }) end,
        })
    end
    local tall = hh > px(200)
    local p3 = hh < px(130) and px(12) or pad
    local iw3 = w - 2 * p3
    local attr_h = lh1(12) + (tall and (px(2) + lh1(12)) or 0)
    local qs = hh < px(130) and 14 or 15
    local function quote(budget)
        local lines = math.max(1, math.floor(budget / lh(qs)))
        return text(hl.text, { s = qs, i = true, serif = true, lines = lines > 1 and lines or nil, w = iw3, col = INK.g1, data = true })
    end
    local label = function()
        return hstack({ w = iw3, h = lh1(12), gap = px(6) }, { icon("quote", px(14), { fill = true, sw = 1, col = BoardColour.artHex(ctx, "#000000", "deep") }), text(_("Highlight of the day"), { s = 12, b = true, col = INK.g4 }), flex(0) })
    end
    return pick({
        function()
            return vstack({ w = w, h = hh, pad = p3 }, {
                label(),
                space(nil, px(6)),
                quote(hh - 2 * p3 - lh1(12) - px(6) - px(6) - attr_h),
                flex(px(6)),
                text(hl.bookTitle or "", { s = 12, b = true, w = iw3, data = true }),
                tall and space(nil, px(2)) or false,
                tall and text(hl.chapterTitle or "", { s = 12, col = INK.g4, w = iw3, data = true }) or false,
            })
        end,
        -- A short row: the quote and its book, without the label.
        function()
            return vstack({ w = w, h = hh, pad = p3 }, {
                quote(hh - 2 * p3 - px(6) - lh1(12)),
                flex(px(6)),
                text(hl.bookTitle or "", { s = 12, b = true, w = iw3, data = true }),
            })
        end,
        function()
            return vstack({ w = w, h = hh, pad = p3 }, { flex(0), quote(hh - 2 * p3), flex(0) })
        end,
    })
end

-- ---------------------------------------------------------------- shelves
local SHELF_TITLES = {
    ["want-to-read"] = function() return _("Want to read") end,
    ["up-next-in-series"] = function() return _("Up next in series") end,
    ["random"] = function() return _("Discover") end,
    ["recently-added"] = function() return _("Recently added") end,
    ["in-progress"] = function() return _("In progress") end,
    ["pick-back-up"] = function() return _("Pick back up") end,
    ["finished"] = function() return _("Finished this year") end,
}
local SHELF_EMPTY = {
    ["want-to-read"] = function() return _("Mark books Want to read and they wait here.") end,
    ["pick-back-up"] = function() return _("Books you put down a while ago show up here.") end,
    ["finished"] = function() return _("Books you finish this year gather here.") end,
}
-- Shelves with no catalog list to open: no See all.
local SHELF_NO_LIST = { ["want-to-read"] = true }
BoardWidgets.shelfTitle = function(props)
    if props.title then return props.title end
    local f = SHELF_TITLES[props.source]
    return f and f() or _("Shelf")
end

W.shelf = function(ctx, w, hh, props, item)
    local d = ctx.d
    local pad = px(12)
    local iw = w - 2 * pad
    local fetched = d.shelves[BoardStore.shelfKey(props)]
    local books = fetched or {}
    local title_size = 11
    local cap_h = px(6) + lh1(title_size)
    local cover_h = math.max(1, hh - 2 * pad - lh1(13) - px(10) - cap_h)
    local cover_w = math.min(iw, math.floor(cover_h * 2 / 3 + 0.5))
    cover_h = math.min(cover_h, math.floor(cover_w * 1.5 + 0.5))
    local min_gap = px(12)
    -- A half-width shelf holds three covers; one as wide as the board takes
    -- as many as fit, so a two-column board does not spread three apart.
    local geometry = ctx.menu and ctx.menu._board_geometry
    local full_width = item and geometry and item.cw >= geometry.cols
    local max_books = (not full_width and (item and item.cw or 2) <= 2) and 3 or math.huge
    local n = math.min(max_books, math.max(1, math.floor((iw + min_gap) / (cover_w + min_gap))))
    -- A gap of a quarter of a cover takes one more, smaller cover instead.
    if n < max_books and iw - (n * cover_w + (n - 1) * min_gap) > cover_w * 0.25 then
        n = n + 1
        cover_w = math.floor((iw - (n - 1) * min_gap) / n)
        cover_h = math.min(cover_h, math.floor(cover_w * 1.5 + 0.5))
    end
    local gap = n > 1 and math.floor((iw - n * cover_w) / (n - 1)) or 0
    local finished = props.source == "finished" and not props.title
    local title = finished and T(_("Finished in %1"), d.goal.year) or BoardWidgets.shelfTitle(props)
    local right
    if props.shuffle then
        right = BoardUI.hit(hstack({ w = px(36), h = lh1(13) }, { flex(0), icon("shuffle", px(17), { sw = BoardColour.icon(ctx, 2.25).sw, col = d.online and BoardColour.artHex(ctx, "#000000") or "ga" }) }),
            d.online and { kind = "shuffle" } or { kind = "noop" })
    elseif finished then
        right = hstack({ gap = px(2) }, { text(tostring(d.goal.done or 0), { s = 13, b = true }), icon("chevron-right", px(15), { sw = 2.5 }) })
    elseif not SHELF_NO_LIST[props.source] then
        right = hstack({ gap = px(2) }, { text(_("See all"), { s = 13, b = true }), icon("chevron-right", px(15), { sw = 2.5 }) })
    end
    if #books == 0 then
        -- A shelf added since the last refresh has no books yet, which is not
        -- the same as an empty one.
        local message
        if d.loading or (not fetched and d.online) then
            message = _("Loading…")
        elseif not fetched then
            message = _("Connect to Wi-Fi to fill this shelf.")
        else
            local empty = SHELF_EMPTY[props.source]
            message = empty and empty() or _("Nothing here yet.")
        end
        return vstack({ w = w, h = hh, pad = pad }, {
            head(iw, title, nil),
            space(nil, px(8)),
            text(message, { s = 13, col = INK.g4, lines = 3, w = iw }),
            flex(0),
        })
    end
    local cards = {}
    for i = 1, math.min(n, #books) do
        local b = books[i]
        table.insert(cards, BoardUI.hit(vstack({ w = cover_w }, {
            cover(ctx, b, cover_w, cover_h, { border = thin(), dim = offlineDim(ctx, b) }),
            space(nil, px(6)),
            text(b.title, { s = title_size, b = true, w = cover_w, data = true }),
        }), { kind = "detail", book_id = b.id, list = { label = title, books = books } }))
    end
    return vstack({ w = w, h = hh, pad = pad, strict_padding = true }, {
        head(iw, title, right),
        space(nil, px(10)),
        hstack({ gap = gap, valign = "top" }, cards),
        flex(0),
    })
end

-- --------------------------------------------------------------- shortcuts
local LINKS = {
    library = { "book-copy", function() return _("Library") end, function(d) return d.counts.library end, function() return _("books") end },
    series = { "layers-2", function() return _("Series") end, function(d) return d.counts.series end, function() return _("series") end },
    authors = { "feather", function() return _("Authors") end, function(d) return d.counts.authors end, function() return _("authors") end },
    collections = { "folder-open", function() return _("Collections") end, function(d) return d.counts.collections end,
        function(n) return n == 1 and _("collection") or _("collections") end },
    scopes = { "aperture", function() return _("SmartScopes") end, function(d) return d.counts.scopes end, function() return _("scopes") end },
    device = { "tablet", function() return _("On device") end, function(d) return d.counts.device end,
        function(n) return _.ngettext("book here", "books here", n) end },
    search = { "search", function() return _("Search") end, function() return nil end, function() return "" end },
}
BoardWidgets.LINKS = LINKS

local function fanWidth(cover_h, count)
    local cw = math.floor(cover_h * 2 / 3 + 0.5)
    return cw + math.floor(cw * 0.6 + 0.5) * (math.min(3, count) - 1)
end

local function fan(ctx, books, cover_h)
    local cw = math.floor(cover_h * 2 / 3 + 0.5)
    local step = math.floor(cw * 0.6 + 0.5)
    local list = {}
    for i = 1, math.min(3, #books) do table.insert(list, books[i]) end
    if #list == 0 then return space(1, cover_h) end
    local ring = math.max(1, px(1.5))
    local width = cw + step * (#list - 1)
    -- The first book sits on top at the right. Each cover carries a white ring
    -- drawn outside its box, so the fan measures exactly its covers.
    local layers = {}
    for i = #list, 1, -1 do
        local x = (#list - i) * step
        table.insert(layers, { widget = rect(cw + 2 * ring, cover_h + 2 * ring, BoardColour.halo(ctx, INK.white)), x = x - ring, y = -ring })
        table.insert(layers, { widget = cover(ctx, list[i], cw, cover_h, { border = thin(), border_col = BoardColour.coverEdge(ctx, INK.g9) }), x = x, y = 0 })
    end
    return BoardUI.overlay(width, cover_h, layers)
end

local function formatCount(n)
    if not n then return "" end
    local s = tostring(math.floor(n))
    local out = s:reverse():gsub("(%d%d%d)", "%1,"):reverse()
    return (out:gsub("^,", ""))
end

W.link = function(ctx, w, hh, props)
    local d = ctx.d
    local spec = LINKS[props.link] or LINKS.library
    local pad = px(12)
    local iw = w - 2 * pad
    local ih = hh - 2 * pad
    local n = spec[3](d)
    local label = spec[2]()
    -- The name stays whole: the chevron gives way first, then the icon, then
    -- the name steps down a size or two.
    local function headEl()
        local need = text(label, { s = 13, b = true }):getSize().w
        local icon_w = px(15) + px(5)
        local chevron = w >= px(150) and icon("chevron-right", px(14), { sw = 2.5, col = "g6" }) or nil
        local cw = chevron and (chevron:getSize().w + px(5)) or 0
        if chevron and need > iw - icon_w - cw then chevron, cw = nil, 0 end
        local with_icon = need <= iw - icon_w
        local lab_w = iw - (with_icon and icon_w or 0) - cw
        local size = 13
        while need > lab_w and size > 11 do
            size = size - 1
            need = text(label, { s = size, b = true }):getSize().w
        end
        return hstack({ w = iw, h = lh1(13), gap = px(5) }, {
            with_icon and icon(spec[1], px(15), BoardColour.icon(ctx, 2.25)) or false,
            text(label, { s = size, b = true, w = lab_w }),
            chevron or false,
        })
    end
    local room = ih - lh1(13)
    local val_s = fillSize(room - lh1(11) - px(4), 18, 30)
    local unit = spec[4](n)
    if props.link == "device" then
        local storage = d.storage
        local function count()
            local cs = math.min(val_s, 24)
            local parts = function(size) return { { t = tostring(n or 0), b = true, s = size }, { t = "  " .. unit, col = INK.g4 } } end
            while cs > 16 and runs(parts(cs), { s = 11 }):getSize().w > iw do cs = cs - 2 end
            return runs(parts(cs), { s = 11, w = iw })
        end
        -- The storage bar only on a row with room for it.
        return pick({
            function()
                local items = { headEl(), flex(0), count() }
                if storage then
                    local label2 = text(T(_("%1 GB free"), string.format("%.1f", storage.free_gb):gsub("%.0$", "")), { s = 11, col = INK.g4 })
                    local used = math.floor(100 * (storage.total_gb - storage.free_gb) / storage.total_gb + 0.5)
                    table.insert(items, space(nil, px(5)))
                    table.insert(items, hstack({ w = iw, gap = px(8) }, { bar(iw - label2:getSize().w - px(8), px(6), used, { track = BoardColour.track(ctx, INK.gd), fill = BoardColour.ink(ctx, INK.black), r = px(3) }), label2 }))
                end
                return vstack({ w = w, h = hh, pad = pad }, items)
            end,
            function() return vstack({ w = w, h = hh, pad = pad }, { headEl(), flex(0), count() }) end,
        })
    end
    if props.link == "search" then
        local recents = table.concat(d.recent_searches or {}, ", ")
        local border = math.max(1, px(1.25))
        local variants = {}
        -- Recent searches go first when the tile is short; the field keeps its
        -- placeholder only while it is tall enough to hold the text.
        for _i, with_recents in ipairs(recents ~= "" and { true, false } or { false }) do
            for _j, ph in ipairs({ _("Title, author"), _("Books"), false }) do
                table.insert(variants, function()
                    local below = with_recents and (px(6) + lh1(11)) or 0
                    local field_h = math.min(px(34), room - below - px(4))
                    -- Below 28dp the field is a sliver, not a control.
                    if field_h < px(28) then BoardUI.problem("short", "search field h=" .. field_h) end
                    local field = BoardUI.box({ w = iw, h = field_h, radius = math.floor(field_h / 2), border = border, border_col = INK.g6 },
                        hstack({ w = iw - 2 * border, h = field_h - 2 * border, gap = px(6) }, {
                            space(px(10) - px(6), 1),
                            icon("search", math.min(px(14), field_h - 2 * border), { sw = 2.5, col = "g4" }),
                            ph and text(ph, { s = 12, col = INK.g4 }) or false,
                            flex(0),
                        }))
                    return vstack({ w = w, h = hh, pad = pad }, {
                        headEl(), flex(0), field,
                        with_recents and space(nil, px(6)) or false,
                        with_recents and text(recents, { s = 11, i = true, col = INK.g4, w = iw, data = true }) or false,
                    })
                end)
            end
        end
        -- A short row: the hint (or the recent searches) without a field.
        table.insert(variants, function()
            return vstack({ w = w, h = hh, pad = pad }, {
                headEl(), flex(0),
                text(recents ~= "" and recents or _("Title, author"), { s = 12, i = recents ~= "", col = INK.g4, w = iw, data = true }),
            })
        end)
        return pick(variants)
    end
    local names
    if props.link == "collections" then names = d.names.collections end
    if props.link == "scopes" then names = d.names.scopes end
    if props.link == "authors" then
        names = {}
        local seen = {}
        local pool = {}
        for _i, src in ipairs({ "recently-added", "random" }) do
            for _i, b in ipairs(d.shelves[src] or {}) do table.insert(pool, b) end
        end
        for _i, b in ipairs(pool) do
            local a = firstAuthor(b)
            if a then
                local last = a:match("(%S+)%s*$") or a
                if not seen[last] then seen[last] = true; table.insert(names, last) end
            end
            if #names >= 4 then break end
        end
    end
    if names then
        local function count()
            local cs = math.min(val_s, 24)
            local parts = function(size) return { { t = formatCount(n or 0), b = true, s = size }, { t = "  " .. unit, col = INK.g4 } } end
            while cs > 16 and runs(parts(cs), { s = 11 }):getSize().w > iw do cs = cs - 2 end
            return runs(parts(cs), { s = 11, w = iw })
        end
        -- The names only on a row with room for them.
        return pick({
            function()
                return vstack({ w = w, h = hh, pad = pad }, {
                    headEl(), flex(0), count(),
                    #names > 0 and space(nil, px(4)) or false,
                    #names > 0 and text(table.concat(names, ", "), { s = 12, i = true, serif = true, col = INK.g3, w = iw, data = true }) or false,
                })
            end,
            function() return vstack({ w = w, h = hh, pad = pad }, { headEl(), flex(0), count() }) end,
        })
    end
    local books = props.link == "series" and (d.shelves["up-next-in-series"] or {}) or (d.shelves["recently-added"] or d.shelves["random"] or {})
    local count_col = vstack({}, { text(formatCount(n or 0), { s = val_s, b = true }), text(unit, { s = 11, col = INK.g4 }) })
    local fan_room = iw - count_col:getSize().w - px(8)
    local fh = math.max(px(30), math.min(px(66), room - px(6), math.floor(fan_room / 2.2 * 1.5)))
    -- Rounding can make the fan a pixel wider than its room; past the
    -- smallest covers it holds fewer books, then none.
    local shown = {}
    for i = 1, math.min(3, #books) do shown[i] = books[i] end
    while fh > px(30) and #shown > 0 and fanWidth(fh, #shown) > fan_room do fh = fh - 1 end
    while #shown > 0 and fanWidth(fh, #shown) > fan_room do table.remove(shown) end
    books = shown
    return vstack({ w = w, h = hh, pad = pad }, {
        headEl(), flex(0),
        hstack({ w = iw, valign = "bottom" }, { count_col, flex(px(4)), fan(ctx, books, fh) }),
    })
end

-- ------------------------------------------------------------------ device
W.clock = function(ctx, w, hh)
    local d = ctx.d
    local pad = px(12)
    local iw = w - 2 * pad
    return pick({
        function()
            local val_s = fillSize(hh - 2 * pad - lh1(13) * 2 - px(6), 20, 40)
            while val_s > 20 and text(d.clock, { s = val_s, b = true }):getSize().w > iw do val_s = val_s - 2 end
            return vstack({ w = w, h = hh, pad = pad }, {
                text(d.clock, { s = val_s, b = true, w = iw, col = INK.white }),
                flex(0),
                text(d.weekday, { s = 13, b = true, w = iw, col = INK.white }),
                text(d.day_month, { s = 13, w = iw, col = BoardColour.onInk(ctx, INK.gc) }),
            })
        end,
        -- A short row: the time over the date.
        function()
            local val_s = fillSize(hh - 2 * pad - lh1(13) - px(4), 20, 40)
            while val_s > 20 and text(d.clock, { s = val_s, b = true }):getSize().w > iw do val_s = val_s - 2 end
            return vstack({ w = w, h = hh, pad = pad }, {
                text(d.clock, { s = val_s, b = true, w = iw, col = INK.white }),
                flex(0),
                text(d.day_month, { s = 13, b = true, w = iw, col = INK.white }),
            })
        end,
    })
end

W.sync = function(ctx, w, hh)
    local d = ctx.d
    local pad = px(12)
    local iw = w - 2 * pad
    local on = d.online
    local when = d.last_sync_at and BoardData.relativeDay(os.date("!%Y-%m-%dT%H:%M:%SZ", d.last_sync_at), d.now) or _("not yet")
    local title = on and (d.last_sync_at and _("Synced") or _("Sync")) or _("Offline")
    local opts = on and { { when, 16 }, { when, 14 }, { when, 12 } } or { { T(_("saved %1"), d.updated or ""), 16 }, { T(_("saved %1"), d.updated or ""), 14 }, { d.updated or "", 16 }, { d.updated or "", 13 } }
    local variants = {}
    for _i, o in ipairs(opts) do
        table.insert(variants, function()
            return vstack({ w = w, h = hh, pad = pad }, {
                head(iw, title, icon(on and "cloud-check" or "cloud-off", px(17), BoardColour.icon(ctx, 2.25))),
                flex(0),
                text(o[1], { s = o[2], b = true, w = iw }),
                space(nil, px(6)),
                hstack({ gap = px(5) }, { icon(on and "refresh-cw" or "wifi", px(14), BoardColour.icon(ctx, 2.5)), text(on and _("Sync now") or _("Connect"), { s = 12, b = true }) }),
            })
        end)
    end
    -- A short row: the tile is still the button.
    for _i, o in ipairs(opts) do
        table.insert(variants, function()
            return vstack({ w = w, h = hh, pad = pad }, {
                head(iw, title, icon(on and "cloud-check" or "cloud-off", px(17), BoardColour.icon(ctx, 2.25))),
                flex(0),
                text(o[1], { s = o[2], b = true, w = iw }),
            })
        end)
    end
    return pick(variants)
end

-- Quick settings without opening KOReader's menu.
-- When in the day this reader reads: minutes started in each local hour
-- over the last 90 days, and the part of the day that holds the most.
local DAY_PARTS = {
    { function() return _("Mornings") end, 5, 12 },
    { function() return _("Afternoons") end, 12, 17 },
    { function() return _("Evenings") end, 17, 22 },
    { function() return _("Late nights") end, 22, 29 },
}
local function dayPart(hours)
    local best, best_min = nil, 0
    for _i, part in ipairs(DAY_PARTS) do
        local m = 0
        for hr = part[2], part[3] - 1 do m = m + (hours[hr % 24 + 1] or 0) end
        if m > best_min then best, best_min = part[1](), m end
    end
    return best
end

W.hours = function(ctx, w, hh)
    local d = ctx.d
    local pad = px(12)
    local iw = w - 2 * pad
    local hours = d.hours or {}
    local part = dayPart(hours)
    local function sunMoon() return icon("sun-moon", px(17), BoardColour.icon(ctx, 2.25)) end
    if not part then
        return vstack({ w = w, h = hh, pad = pad }, {
            head(iw, _("When you read"), sunMoon()),
            space(nil, px(6)),
            text(_("Read on this device and your hours show up here."), { s = 13, col = INK.g4, lines = 3, w = iw }),
        })
    end
    local max, peak = 1, 0
    for i = 1, 24 do max = math.max(max, hours[i] or 0) end
    for i = 2, 24 do
        if (hours[i] or 0) > (hours[peak + 1] or 0) then peak = i - 1 end
    end
    local gap = math.max(1, px(2))
    local bar_w = math.max(1, math.floor((iw - 23 * gap) / 24))
    local chart_w = 24 * bar_w + 23 * gap
    local cell_w = 6 * (bar_w + gap)
    local base = math.max(1, px(1))
    local function chart(chart_h)
        local bars = {}
        for i = 1, 24 do
            local v = hours[i] or 0
            if v > 0 then
                local h = math.max(px(2), math.floor((chart_h - px(2)) * v / max + 0.5))
                table.insert(bars, BoardUI.rect(bar_w, h, i - 1 == peak and BoardColour.ink(ctx, INK.black) or BoardColour.mid(ctx, INK.g8)))
            else
                table.insert(bars, space(bar_w, 0))
            end
        end
        return vstack({ w = chart_w }, {
            hstack({ w = chart_w, h = chart_h - base, gap = gap, valign = "bottom" }, bars),
            rect(chart_w, base, INK.black),
        })
    end
    local function axis()
        local cells = {}
        for i, t in ipairs({ "0", "6", "12", "18" }) do
            table.insert(cells, text(t, { s = 11, col = INK.g4, w = i < 4 and cell_w or chart_w - 3 * cell_w }))
        end
        return hstack({ w = chart_w }, cells)
    end
    local peak_label = T(_("Most at %1"), datetime.secondsToHour(BoardData.dayStart(d.now or os.time()) + peak * 3600,
        G_reader_settings:isTrue("twelve_hour_clock")))
    local min_chart = px(12)
    local box = { w = w, h = hh, pad = pad }
    local variants = {}
    -- Tall: the part of the day large, the peak hour under it, then the bars.
    local tall_h = hh - 2 * pad - lh1(13) - px(4) - lh1(20) - px(2) - lh1(12) - px(10) - px(4) - lh1(11)
    if tall_h >= px(40) then
        table.insert(variants, function()
            return vstack(box, {
                head(iw, _("When you read"), sunMoon()),
                space(nil, px(4)),
                text(part, { s = 20, b = true, w = iw }),
                space(nil, px(2)),
                text(peak_label, { s = 12, col = INK.g4, w = iw }),
                space(nil, px(10)),
                chart(tall_h),
                space(nil, px(4)),
                axis(),
            })
        end)
    end
    -- One row: the part of the day beside the title.
    local beside_h = hh - 2 * pad - lh1(13) - px(8) - px(4) - lh1(11)
    if beside_h >= min_chart then
        table.insert(variants, function()
            return vstack(box, {
                head(iw, _("When you read"), text(part, { s = 13, b = true })),
                space(nil, px(8)),
                chart(beside_h),
                space(nil, px(4)),
                axis(),
            })
        end)
    end
    table.insert(variants, function()
        return vstack(box, {
            head(iw, _("When you read"), text(part, { s = 13, b = true })),
            space(nil, px(8)),
            chart(math.max(min_chart, hh - 2 * pad - lh1(13) - px(8))),
        })
    end)
    return pick(variants)
end

-- Session records from this device's statistics.
W.records = function(ctx, w, hh)
    local d = ctx.d
    local r = d.records
    local pad = px(12)
    local iw = w - 2 * pad
    local function award() return icon("award", px(17), BoardColour.icon(ctx, 2.25)) end
    if not r then
        return vstack({ w = w, h = hh, pad = pad }, {
            head(iw, _("Reading records"), award()),
            space(nil, px(6)),
            hint(_("Your records appear as you read on this device."), iw, hh - 2 * pad - lh1(13) - px(6)),
        })
    end
    local function stats(short)
        local dur = short and BoardData.formatShortDuration or BoardData.formatDuration
        return {
            { dur(r.longest_min), _("longest session") },
            { tostring(r.pages_per_hour), _("pages an hour") },
            { dur(r.avg_min), _("average session") },
            { formatCount(r.sessions), _("sessions") },
        }
    end
    local function cell(st, cw, vs)
        return vstack({ w = cw }, {
            text(st[1], { s = vs, b = true, w = cw }),
            space(nil, px(2)),
            text(st[2], { s = 11, col = INK.g4, w = cw }),
        })
    end
    local g = px(12)
    local half = math.floor((iw - g) / 2)
    local variants = {}
    -- Two by two when the tile is tall enough, else one row of two.
    for _i, v in ipairs({ { 22, false }, { 20, true }, { 18, true } }) do
        table.insert(variants, function()
            local st = stats(v[2])
            return vstack({ w = w, h = hh, pad = pad }, {
                head(iw, _("Reading records"), award()),
                flex(px(8)),
                hstack({ gap = g, valign = "top" }, { cell(st[1], half, v[1]), cell(st[2], iw - half - g, v[1]) }),
                flex(px(10)),
                hstack({ gap = g, valign = "top" }, { cell(st[3], half, v[1]), cell(st[4], iw - half - g, v[1]) }),
            })
        end)
    end
    for _i, v in ipairs({ { 20, false }, { 18, true }, { 16, true }, { 14, true }, { 13, true } }) do
        table.insert(variants, function()
            local st = stats(v[2])
            return vstack({ w = w, h = hh, pad = pad }, {
                head(iw, _("Reading records"), award()),
                flex(px(v[1] <= 14 and 4 or 6)),
                hstack({ gap = g, valign = "top" }, { cell(st[1], half, v[1]), cell(st[2], iw - half - g, v[1]) }),
            })
        end)
    end
    return pick(variants)
end

W.toggles = function(ctx, w, hh)
    local d = ctx.d
    local pad = px(10)
    local iw, ih = w - 2 * pad, hh - 2 * pad
    local small = w < px(200)
    -- A row of five whose labels do not fit even at 10 is drawn as the grid.
    local label_s
    if not small then
        local names = { _("Wi-Fi"), _("Light"), _("Night"), _("Rotate"), _("Sync") }
        local cw5 = math.floor(iw / (d.light ~= nil and 5 or 4))
        for _i, size in ipairs({ 12, 11, 10 }) do
            local widest = 0
            for _j, name in ipairs(names) do
                local t = text(name, { s = size, b = true })
                widest = math.max(widest, t:getSize().w)
                if t.free then t:free() end
            end
            if widest <= cw5 - px(2) then label_s = size; break end
        end
        small = label_s == nil
    end
    -- Light opens KOReader's brightness dialog. In the 2x2 grid it takes
    -- Rotate's place, the least used of the five.
    local has_light = d.light ~= nil
    local items = { { "wifi", _("Wi-Fi"), d.online, "wifi" } }
    if has_light then table.insert(items, { "sun", _("Light"), false, "frontlight" }) end
    table.insert(items, { "moon", _("Night"), G_reader_settings:isTrue("night_mode"), "night" })
    if not (has_light and small) then table.insert(items, { "rotate-cw-square", _("Rotate"), false, "rotate" }) end
    table.insert(items, { "refresh-cw", _("Sync"), false, "sync" })
    local function circleBtn(size, it)
        local on = it[3]
        return BoardUI.hit(BoardUI.circle(size, { bg = on and BoardColour.ink(ctx, INK.black) or INK.white, border = on and 0 or math.max(1, px(1.5)) },
            icon(it[1], math.floor(size * 0.46 + 0.5), { col = on and "white" or "black", sw = 2.25 })), { kind = it[4] })
    end
    if small then
        local bd = math.min(math.floor((iw - px(8)) / 2), math.floor((ih - px(8)) / 2))
        return vstack({ w = w, h = hh, align = "center" }, {
            flex(0),
            hstack({ gap = px(8) }, { circleBtn(bd, items[1]), circleBtn(bd, items[2]) }),
            space(nil, px(8)),
            hstack({ gap = px(8) }, { circleBtn(bd, items[3]), circleBtn(bd, items[4]) }),
            flex(0),
        })
    end
    local cw = math.floor(iw / #items)
    local bd = math.min(px(44), ih - lh1(12) - px(6), cw - px(8))
    local cells = {}
    for _i, it in ipairs(items) do
        table.insert(cells, vstack({ w = cw, align = "center" }, {
            circleBtn(bd, it),
            space(nil, px(5)),
            text(it[2], { s = label_s, b = it[3], w = cw, align = "center" }),
        }))
    end
    return hstack({ w = w, h = hh }, { space(pad, 1), hstack({}, cells), flex(0) })
end

-- Frontlight and warmth, set without leaving the dashboard.
local function stepButton(d, name)
    return BoardUI.circle(d, { bg = INK.white, border = math.max(1, px(1.5)) }, icon(name, math.floor(d * 0.5 + 0.5), { sw = 2.75 }))
end
BoardWidgets.stepButton = stepButton

W.light = function(ctx, w, hh)
    local lt = ctx.d.light
    local pad = px(12)
    local iw, ih = w - 2 * pad, hh - 2 * pad
    if not lt then
        return vstack({ w = w, h = hh, pad = pad }, {
            head(iw, _("Light"), icon("sun", px(16), BoardColour.icon(ctx, 2.25))),
            space(nil, px(6)),
            hint(_("This device has no frontlight."), iw, hh - 2 * pad - lh1(13) - px(6), { sizes = { 12, 11 } }),
        })
    end
    local function compact(bd, s)
        return function()
            return vstack({ w = w, h = hh, pad = pad }, {
                head(iw, _("Light"), icon("sun", px(16), BoardColour.icon(ctx, 2.25))),
                flex(0),
                hstack({ w = iw }, {
                    BoardUI.hit(stepButton(bd, "minus"), { kind = "light", what = "brightness", delta = -5 }),
                    flex(px(4)), text(lt.brightness .. "%", { s = s, b = true }), flex(px(4)),
                    BoardUI.hit(stepButton(bd, "plus"), { kind = "light", what = "brightness", delta = 5 }),
                }),
            })
        end
    end
    local function full(with_label)
        return function()
            local rows_n = lt.warmth and 2 or 1
            local avail = ih - lh1(13) - px(6)
            local rh = math.min(px(38), math.floor((avail - (rows_n - 1) * px(5)) / rows_n))
            local bd = math.min(px(32), rh)
            local function stepper(name, val, what, fam)
                local vw = px(36)
                local bw = iw - px(18) - 2 * bd - vw - 4 * px(8)
                return hstack({ w = iw, h = rh, gap = px(8) }, {
                    icon(name, px(18), BoardColour.icon(ctx, 2.25, fam)),
                    BoardUI.hit(stepButton(bd, "minus"), { kind = "light", what = what, delta = -5 }),
                    bar(math.max(px(16), bw), px(8), val, { track = BoardColour.track(ctx, INK.gd, fam), fill = BoardColour.ink(ctx, INK.black, fam), r = px(4) }),
                    BoardUI.hit(stepButton(bd, "plus"), { kind = "light", what = what, delta = 5 }),
                    text(tostring(val), { s = 13, b = true, w = vw, align = "right" }),
                })
            end
            local label = rows_n == 2 and _("Brightness · Warmth") or _("Brightness")
            return vstack({ w = w, h = hh, pad = pad }, {
                head(iw, _("Light"), with_label and text(label, { s = 12, col = INK.g4 }) or nil),
                flex(0),
                stepper("sun", lt.brightness, "brightness", "gold"),
                rows_n == 2 and space(nil, px(5)) or false,
                rows_n == 2 and stepper("thermometer-sun", lt.warmth, "warmth", "orange") or false,
            })
        end
    end
    return pick({ full(true), full(false), compact(px(32), 20), compact(px(28), 17), compact(px(24), 15), compact(px(22), 13) })
end

-- ------------------------------------------------------------ new widgets
-- Finish forecast: when the current book ends at the reader's own pace.
W.forecast = function(ctx, w, hh)
    local d = ctx.d
    local f = d.forecast
    local pad = px(12)
    local iw, ih = w - 2 * pad, hh - 2 * pad
    local tall = hh >= px(160)
    if not f then
        local variants = {}
        for _i, long in ipairs({ true, false }) do
            table.insert(variants, function()
                return vstack({ w = w, h = hh, pad = pad }, {
                    head(iw, long and _("Finish forecast") or _("Finish"), icon("hourglass", px(16), BoardColour.icon(ctx, 2.25))),
                    space(nil, px(6)),
                    text(long and _("Read a little on this device and a finish date shows up here.") or _("Read a little"), { s = 13, col = INK.g4, lines = 3, w = iw }),
                })
            end)
        end
        return pick(variants)
    end
    local function strip(tw)
        local n = math.min(8, f.days_out + 1)
        local g = px(4)
        local cw = math.floor((tw - (n - 1) * g) / n)
        local cells = {}
        for i = 1, n do
            local is_end, is_today = i == n, i == 1
            local t = d.now + (i - 1) * 86400
            table.insert(cells, vstack({ w = cw, align = "center" }, {
                rect(cw, px(8), is_end and BoardColour.ink(ctx, INK.black) or (is_today and BoardColour.mid(ctx, INK.g6) or BoardColour.track(ctx, INK.gc)), px(4)),
                space(nil, px(3)),
                text(BoardData.shortWeekday(t):sub(1, 1), { s = 11, b = is_end or is_today, col = (is_end or is_today) and INK.black or INK.g4, w = cw, align = "center" }),
            }))
        end
        return hstack({ gap = g }, cells)
    end
    local function bottomText(level)
        if level == 2 then return T(_("%1 left at ~%2 min a day"), BoardData.formatDuration(f.minutes_left), math.floor(f.per_day + 0.5)) end
        if level == 1 then return T(_("%1 left"), BoardData.formatDuration(f.minutes_left)) end
        if level == 0 then return T(_("%1 left"), BoardData.formatShortDuration(f.minutes_left)) end
    end
    local function dayEl(fmt, tw)
        if fmt == "long" then
            return runs({ { t = f.day, b = true, s = tall and 26 or 22 }, { t = "  " .. f.date, col = INK.g4 } }, { s = 13, w = tw })
        elseif fmt == "mid" then
            return text(f.day, { s = 22, b = true, w = tw })
        end
        return text(f.short .. " " .. f.date:match("^(%d+)"), { s = 20, b = true, w = tw })
    end
    local function build(cfg)
        return function()
            local bottom = cfg.bottom >= 0 and text(bottomText(cfg.bottom), { s = 12, col = INK.g4, w = iw }) or nil
            if cfg.cover == "side" then
                local cover_w = math.floor(ih * 2 / 3 + 0.5)
                local tw = iw - cover_w - px(12)
                return hstack({ w = w, h = hh, valign = "top" }, {
                    space(pad, 1),
                    vstack({ w = tw, h = hh, pad = { pad, 0, pad, 0 } }, {
                        head(tw, cfg.label, nil),
                        flex(0),
                        dayEl(cfg.day, tw),
                        cfg.strip and space(nil, px(8)) or false, cfg.strip and strip(tw) or false,
                        cfg.bottom >= 0 and space(nil, px(4)) or false,
                        cfg.bottom >= 0 and text(bottomText(cfg.bottom), { s = 12, col = INK.g4, w = tw }) or false,
                    }),
                    space(px(12), 1),
                    vstack({ w = cover_w, h = hh, pad = { pad, 0, pad, 0 } }, { cover(ctx, f.book, cover_w, ih) }),
                    flex(0),
                })
            end
            if cfg.cover == "stack" then
                local cover_h = math.min(px(96), math.floor(ih * 0.48 + 0.5))
                local cover_w = math.floor(cover_h * 2 / 3 + 0.5)
                local tw = iw - cover_w - px(12)
                return vstack({ w = w, h = hh, pad = pad }, {
                    head(iw, cfg.label, icon("hourglass", px(16), BoardColour.icon(ctx, 2.25))),
                    space(nil, px(8)),
                    hstack({ gap = px(12), valign = "bottom" }, {
                        cover(ctx, f.book, cover_w, cover_h),
                        vstack({ w = tw }, { text(f.day, { s = 24, b = true, w = tw }), text(f.date, { s = 13, col = INK.g4, w = tw }) }),
                    }),
                    flex(px(6)),
                    cfg.strip and strip(iw) or false,
                    bottom and space(nil, px(6)) or false,
                    bottom or false,
                })
            end
            return vstack({ w = w, h = hh, pad = pad }, {
                head(iw, cfg.label, icon("hourglass", px(16), BoardColour.icon(ctx, 2.25))),
                flex(0),
                dayEl(cfg.day, iw),
                cfg.strip and space(nil, px(8)) or false, cfg.strip and strip(iw) or false,
                bottom and space(nil, px(4)) or false,
                bottom or false,
            })
        end
    end
    local L1, L2 = _("Finish forecast"), _("Finish")
    local cfgs = {
        { cover = "side", strip = tall, day = "long", bottom = 2, label = L1 },
        { cover = "side", strip = tall, day = "long", bottom = 1, label = L1 },
        { cover = "stack", strip = tall, day = "long", bottom = 2, label = L1 },
        { cover = "stack", strip = tall, day = "long", bottom = 1, label = L1 },
        { cover = "none", strip = tall, day = "long", bottom = 2, label = L1 },
        { cover = "none", strip = tall, day = "long", bottom = 1, label = L1 },
        { cover = "side", strip = false, day = "mid", bottom = 1, label = L2 },
        { cover = "none", strip = tall, day = "mid", bottom = 0, label = L2 },
        { cover = "none", strip = false, day = "short", bottom = 0, label = L2 },
        { cover = "none", strip = false, day = "short", bottom = -1, label = L2 },
    }
    local variants = {}
    for _i, cfg in ipairs(cfgs) do
        if cfg.cover ~= "stack" or tall then table.insert(variants, build(cfg)) end
    end
    return pick(variants)
end

-- A word looked up while reading, with the sentence it came from.
W.word = function(ctx, w, hh)
    local wd = ctx.d.word
    local pad = px(12)
    local iw = w - 2 * pad
    local word_icon = icon("whole-word", px(17), BoardColour.icon(ctx, 2.25))
    if not wd then
        local variants = {}
        for _i, long in ipairs({ true, false }) do
            table.insert(variants, function()
                return vstack({ w = w, h = hh, pad = pad }, {
                    head(iw, _("Word of the day"), word_icon),
                    space(nil, px(6)),
                    text(long and _("Look up a word while reading and one comes back here each day.") or _("Look up a word while reading."), { s = 13, col = INK.g4, lines = 3, w = iw }),
                })
            end)
        end
        return pick(variants)
    end
    local context = "\u{2026}" .. (wd.before or "") .. wd.word .. (wd.after or "") .. "\u{2026}"
    local tall = hh >= px(170)
    local function build(cfg)
        return function()
            local items = {
                head(iw, _("Word of the day"), word_icon),
                space(nil, px(cfg.big and 10 or 4)),
                text(wd.word, { s = cfg.ws, b = true, serif = true, w = iw, data = true, col = BoardColour.ink(ctx, INK.black) }),
            }
            if cfg.ctx_lines > 0 then
                table.insert(items, space(nil, px(4)))
                table.insert(items, text(context, { s = 14, i = true, serif = true, lines = cfg.ctx_lines, w = iw, col = INK.g2, data = true }))
            end
            table.insert(items, flex(px(cfg.source and 6 or 0)))
            if cfg.source and wd.book then
                table.insert(items, text(wd.book, { s = 11, col = INK.g4, w = iw, data = true }))
            end
            return vstack({ w = w, h = hh, pad = pad }, items)
        end
    end
    local cfgs = tall and {
        { big = true, ws = 28, ctx_lines = 5, source = true },
        { big = true, ws = 28, ctx_lines = 4, source = true },
        { big = false, ws = 24, ctx_lines = 3, source = true },
        { big = false, ws = 24, ctx_lines = 2, source = false },
        { big = false, ws = 22, ctx_lines = 0, source = false },
    } or {
        { ws = 22, ctx_lines = 2, source = false },
        { ws = 22, ctx_lines = 1, source = false },
        { ws = 20, ctx_lines = 1, source = false },
        { ws = 20, ctx_lines = 0, source = false },
    }
    local variants = {}
    for _i, cfg in ipairs(cfgs) do table.insert(variants, build(cfg)) end
    return pick(variants)
end

-- What you were reading this time last year.
W.yearago = function(ctx, w, hh)
    local y = ctx.d.year_ago
    local pad = px(12)
    local iw, ih = w - 2 * pad, hh - 2 * pad
    local cal = icon("calendar-clock", px(17), BoardColour.icon(ctx, 2.25))
    if not y then
        local variants = {}
        for _i, long in ipairs({ true, false }) do
            table.insert(variants, function()
                return vstack({ w = w, h = hh, pad = pad }, {
                    head(iw, _("A year ago"), cal),
                    space(nil, px(6)),
                    text(long and _("Next year, this shows what you were reading today.") or _("Check back next year."), { s = 13, col = INK.g4, lines = 3, w = iw }),
                })
            end)
        end
        return pick(variants)
    end
    local tall = hh >= px(170)
    local function short(detail)
        return function()
            local cover_w = math.floor(ih * 2 / 3 + 0.5)
            local tw = iw - cover_w - px(12)
            local lines = {
                [2] = y.stopped_at and (T(_("Stopped at %1%"), y.stopped_at) .. " · " .. BoardData.formatShortDuration(y.minutes)) or BoardData.formatShortDuration(y.minutes),
                [1] = y.stopped_at and T(_("Stopped at %1%"), y.stopped_at) or BoardData.formatShortDuration(y.minutes),
                [0] = y.stopped_at and T(_("%1% read"), y.stopped_at) or "",
            }
            return hstack({ w = w, h = hh }, {
                space(pad, 1),
                cover(ctx, y.book, cover_w, ih),
                space(px(12), 1),
                vstack({ w = tw, h = ih }, {
                    head(tw, _("A year ago"), nil),
                    flex(0),
                    text(y.book.title, { s = 15, b = true, w = tw, data = true }),
                    text(lines[detail], { s = 12, col = INK.g4, w = tw }),
                }),
                flex(0),
            })
        end
    end
    if not tall then return pick({ short(2), short(1), short(0) }) end
    local function big(cfg)
        return function()
            local body_h = ih - lh1(13) - px(10)
            local cover_h = math.min(body_h, px(cfg.cover_max))
            local cover_w = math.floor(cover_h * 2 / 3 + 0.5)
            local tw = iw - cover_w - px(14)
            local btn_h = px(34)
            local btn_inner = hstack({ h = btn_h, gap = px(6) }, { space(px(14) - px(6), 1), icon("book-open", px(15), { sw = 2.25 }), text(_("Pick it up"), { s = 13, b = true }), space(px(14) - px(6), 1) })
            local btn = BoardUI.box({ w = btn_inner:getSize().w, h = btn_h, radius = math.floor(btn_h / 2), border = math.max(1, px(1.5)) }, btn_inner)
            local story = cfg.story and T(_.ngettext("%1 over %2 day, then you stopped at %3%.", "%1 over %2 days, then you stopped at %3%.", y.days), BoardData.formatDuration(y.minutes), y.days, y.stopped_at or 0)
                or T(_("Stopped at %1%."), y.stopped_at or 0)
            return vstack({ w = w, h = hh, pad = pad }, {
                head(iw, _("A year ago"), cfg.when and y.when and text(y.when, { s = 12, col = INK.g4 }) or nil),
                space(nil, px(10)),
                hstack({ w = iw, h = body_h, gap = px(14), valign = "top" }, {
                    cover(ctx, y.book, cover_w, cover_h),
                    vstack({ w = tw, h = body_h }, {
                        text(y.book.title, { s = 17, b = true, lines = 2, w = tw, data = true }),
                        text(firstAuthor(y.book) or "", { s = 13, col = INK.g4, w = tw, data = true }),
                        space(nil, px(8)),
                        text(story, { s = 13, lines = 3, w = tw }),
                        flex(px(8)),
                        cfg.button and btn or false,
                    }),
                }),
            })
        end
    end
    return pick({
        big({ cover_max = 150, when = true, story = true, button = true }),
        big({ cover_max = 130, when = true, story = true, button = true }),
        big({ cover_max = 130, when = false, story = true, button = true }),
        big({ cover_max = 120, when = false, story = false, button = true }),
        big({ cover_max = 120, when = false, story = false, button = false }),
        short(1),
    })
end

-- ------------------------------------------------------------------ chrome
-- Tile styles: Outline (thin gray, the default), Soft (gray fills) and Ink
-- (black outlines). Black fill stays reserved for Continue reading.
function BoardWidgets.chrome(tiles, chrome)
    local r = px(12)
    if chrome == "ink" then return { bg = INK.black, radius = r, border = 0, fg = "white" } end
    if chrome == "fill" then return { bg = tiles == "soft" and INK.gd or INK.ge, radius = r, border = 0 } end
    if tiles == "soft" then return { bg = INK.ge, radius = r, border = 0 } end
    if tiles == "ink" then return { bg = INK.white, radius = r, border = math.max(1, px(1.5)), border_col = INK.black } end
    return { bg = INK.white, radius = r, border = math.max(1, px(1)), border_col = INK.g8 }
end

-- The tile: chrome around a widget's content, built at exactly w x h. The
-- content gets the whole tile and the outline is drawn over its padding, so
-- the outline never costs the content any room.
function BoardWidgets.tile(ctx, item, w, h)
    local fn = W[item.type]
    ctx.tile_key = BoardColour.keyFor(item.type, item.props)
    local ch = BoardColour.chrome(ctx, item.chrome, ctx.tile_key, BoardWidgets.chrome(ctx.tiles, item.chrome), math.max(1, px(1)), math.max(1, px(1.5)))
    local content
    if fn then
        BoardUI.debug_widget = item.type .. " " .. w .. "x" .. h
        local props = item.props or {}
        local sig = BoardWidgets.SIG[item.type]
        local sig_ok, extra = true, ""
        if sig and ctx.d then sig_ok, extra = pcall(sig, ctx) end
        BoardUI.pickScope(item.type .. ":" .. tostring(props.source or props.link or props.animal or "") .. ":" .. w .. "x" .. h .. ":" .. tostring(ch.bg)
            .. ":" .. (sig_ok and tostring(extra) or ""), ctx.d and ctx.d.fingerprint)
        local surface = BoardUI.surface
        BoardUI.surface = ch.bg
        local ok, result = pcall(fn, ctx, w, h, props, item)
        BoardUI.surface = surface
        BoardUI.pickScope(nil, ctx.d and ctx.d.fingerprint)
        content = ok and result or text(_("Could not draw this widget."), { s = 12, col = INK.g4, w = w - 2 * px(12) })
        if not ok then require("logger").warn("BookOrbit: widget", item.type, "failed:", result) end
    end
    local layers = {
        { widget = BoardUI.box({ w = w, h = h, radius = ch.radius, bg = ch.bg }) },
        { widget = content },
    }
    if ch.border > 0 then
        table.insert(layers, { widget = BoardUI.box({ w = w, h = h, radius = ch.radius, border = ch.border, border_col = ch.border_col }) })
    end
    return BoardUI.overlay(w, h, layers)
end

-- ------------------------------------------------------------------- decor
-- The decor widgets (bookorbit_board_decor) load the first time a board
-- draws or offers one.
local DECOR_TYPES = { buddy = true, analog = true, moon = true, odometer = true, glyph = true, rings = true, chapters = true, badge = true, dust = true }
local function decor()
    local Decor = require("bookorbit_board_decor")
    if not rawget(W, "buddy") then Decor.install(W, { head = head, formatCount = formatCount }) end
    return Decor
end
setmetatable(W, { __index = function(t, k)
    if DECOR_TYPES[k] then
        decor()
        return rawget(t, k)
    end
end })
BoardWidgets.SIG = setmetatable({}, { __index = function(_t, k)
    if DECOR_TYPES[k] then return decor().SIG[k] end
end })

return BoardWidgets
