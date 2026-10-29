--[[--
The decor widgets: tiles that are as much picture as information.

Reading buddy (a pixel companion that reacts to your reading), Analog clock, Moon
phase, Pages turned (an odometer), Glyph of the day, Tree rings (a ring a
month), Chapter line (your book as a metro line), Next badge (the badge you
are closest to) and Gathering dust (one never-opened book a day).

Each follows the board's rules: a widget offers layouts from richest to most
compact and BoardUI.pick keeps the first that fits. A layout that does not
apply to a tile reports a problem instead of returning nothing, so pick moves
on. The pictures come from bookorbit_board_art; sizes are dp and match the
design mocks one for one.
]]

local CenterContainer = require("ui/widget/container/centercontainer")
local Font = require("ui/font")
local Geom = require("ui/geometry")
local TextWidget = require("ui/widget/textwidget")
local Widget = require("ui/widget/widget")
local bit = require("bit")
local T = require("ffi/util").template
local _ = require("gettext")

local BoardArt = require("bookorbit_board_art")
local BoardColour = require("bookorbit_board_colour")
local BoardData = require("bookorbit_board_data")
local BoardIcons = require("bookorbit_board_icons")
local BoardMetrics = require("bookorbit_board_metrics")
local BoardUI = require("bookorbit_board_ui")

local INK = BoardMetrics.INK
local px, lh1 = BoardMetrics.px, BoardMetrics.lh1
local text, runs, vstack, hstack, flex, space, icon, pick = BoardUI.text, BoardUI.runs, BoardUI.vstack, BoardUI.hstack, BoardUI.flex, BoardUI.space, BoardUI.icon, BoardUI.pick
local svg, n = BoardArt.svg, BoardArt.n

local Decor = {}

-- Set by install: the board's own header row and number formatting.
local head, formatCount

-- A hex for decor art: `colour` on a screen showing the Colour setting, the
-- grey otherwise.
local function artHex(ctx, grey, colour)
    return BoardColour.on(ctx) and BoardColour.hex(colour) or grey
end

local function clamp(v, lo, hi)
    if v < lo then return lo end
    if v > hi then return hi end
    return v
end

local function round(v)
    return math.floor(v + 0.5)
end

-- A layout that does not apply to this tile: pick tries the next one.
local function skip(why)
    BoardUI.problem("skip", why)
    return nil
end

local function overlay(w, h, layers)
    return BoardUI.overlay(w, h, layers)
end

local function padded(w, hh, items, align)
    return vstack({ w = w, h = hh, pad = px(12), align = align }, items)
end

-- The same sequence of numbers as the design mock's generator, so a seed
-- draws the same stars and wobble on the device as in the mock.
local function rng(seed)
    local s = bit.tobit((seed * 2654435761) % 4294967296)
    if s == 0 then s = 1 end
    return function()
        s = bit.bxor(s, bit.lshift(s, 13))
        s = bit.bxor(s, bit.rshift(s, 17))
        s = bit.bxor(s, bit.lshift(s, 5))
        local u = s < 0 and s + 4294967296 or s
        return u / 4294967296
    end
end

-- An empty widget keeps its hint: smaller type, then without its title,
-- before any of it is cut.
local function emptyTile(w, hh, title, right, hint, short_hint)
    local iw = w - 2 * px(12)
    local variants = {}
    for _i, v in ipairs({ { 13, 3, true, hint }, { 12, 4, true, hint }, { 12, 6, false, hint }, { 12, 3, true, short_hint }, { 12, 5, false, short_hint } }) do
        table.insert(variants, function()
            return padded(w, hh, {
                v[3] and head(iw, title, right and right() or nil) or false,
                v[3] and space(nil, px(6)) or false,
                text(v[4], { s = v[1], col = INK.g4, lines = v[2], w = iw }),
            })
        end)
    end
    return pick(variants)
end

-- ================================================================ buddy
local MILESTONES = { [7] = true, [30] = true, [50] = true, [100] = true, [200] = true, [365] = true }

-- One pose per situation: nothing started yet, not read today, a book just
-- finished, a streak milestone, late at night, or reading along.
function Decor.buddyPose(d)
    local streak = d.streak or {}
    if #(d.continue_reading or {}) == 0 and (streak.current or 0) == 0 then return "wait" end
    if (d.today_min or 0) <= 0 then return "sleep" end
    if d.finished_today then return "ribbon" end
    local days = streak.current or 0
    if MILESTONES[days] or (days > 1 and days >= (streak.longest or 0)) then return "party" end
    local hour = tonumber(os.date("%H", d.now or os.time())) or 12
    if hour >= 22 or hour < 5 then return "yawn" end
    return "read"
end

-- What the companion says, and whether the second line is book data.
local function buddyLines(pose, d)
    local days = d.streak and d.streak.current or 0
    local best = d.streak and d.streak.longest or 0
    if pose == "read" then
        return { _("Reading with you"), T(_("%1 today"), BoardData.formatDuration(d.today_min)) }
    elseif pose == "sleep" then
        return { _("Fast asleep"), _("Wakes up when you read") }
    elseif pose == "party" then
        return { T(_.ngettext("%1 day in a row!", "%1 days in a row!", days), days), days >= best and _("A new best") or T(_("Your best is %1"), best) }
    elseif pose == "ribbon" then
        return { _("Book finished!"), d.finished_today and d.finished_today.title or "" }, true
    elseif pose == "yawn" then
        return { _("Past bedtime"), T(_("%1 read today"), BoardData.formatDuration(d.today_min)) }
    end
    return { _("Ready when you are"), _("Open a book to start") }
end

-- A speech bubble whose tail points at the companion ("left" or "down"). Returns
-- the widget, where its box starts inside it (the tail sticks out of the
-- box) and the box's height.
local function bubble(w, lines, s, tail, second_is_data)
    local bw = math.max(1, px(1.5))
    local pad_x, pad_y = px(10), px(7)
    local tw = w - 2 * pad_x - 2 * bw
    -- The bubble is white whatever the tile under it is, and so is its text's ground.
    local items = { text(lines[1], { s = s, b = true, w = tw, lines = 2, bg = INK.white }) }
    if lines[2] then
        table.insert(items, space(nil, px(2)))
        table.insert(items, text(lines[2], { s = math.max(11, s - 2), col = INK.g4, w = tw, lines = 2, data = second_is_data, bg = INK.white }))
    end
    local inner = vstack({ w = tw }, items)
    local h = inner:getSize().h + 2 * pad_y + 2 * bw
    local frame = BoardUI.box({ w = w, h = h, radius = px(10), border = bw, border_col = INK.black, bg = INK.white },
        vstack({ w = w - 2 * bw, h = h - 2 * bw, pad = { pad_y, pad_x, pad_y, pad_x } }, { inner }))
    local t = px(9)
    if tail == "left" then
        local tail_art = svg(t, 2 * t, '<path d="M' .. t .. ' 0 L0 ' .. t .. ' L' .. t .. ' ' .. 2 * t .. '" fill="#ffffff" stroke="#000000" stroke-width="' .. bw
            .. '" stroke-linejoin="round"/><rect x="' .. (t - bw) .. '" y="' .. bw .. '" width="' .. bw .. '" height="' .. (2 * t - 2 * bw) .. '" fill="#ffffff"/>')
        return overlay(w + t - bw, h, { { widget = frame, x = t - bw, y = 0 }, { widget = tail_art, x = 0, y = px(14) } }), t - bw, h
    end
    local tail_art = svg(2 * t, t, '<path d="M0 0 L' .. t .. ' ' .. t .. ' L' .. 2 * t .. ' 0" fill="#ffffff" stroke="#000000" stroke-width="' .. bw
        .. '" stroke-linejoin="round"/><rect x="' .. bw .. '" y="0" width="' .. (2 * t - 2 * bw) .. '" height="' .. bw .. '" fill="#ffffff"/>')
    return overlay(w, h + t - bw, { { widget = frame }, { widget = tail_art, x = round(w * 0.42) - t, y = h - bw } }), 0, h
end

local function shadow(sw)
    local sh_w, sh_h = round(sw * 0.62), math.max(3, round(sw * 0.05))
    return svg(sh_w, sh_h, '<ellipse cx="' .. n(sh_w / 2) .. '" cy="' .. n(sh_h / 2) .. '" rx="' .. n(sh_w / 2) .. '" ry="' .. n(sh_h / 2) .. '" fill="#dddddd"/>')
end

-- The pets, one module each (bookorbit_pets), loaded the first time a tile
-- shows one. A name this plugin does not know shows the cat.
Decor.PETS = { "cat", "dog", "rabbit", "owl", "penguin", "robot", "vampire", "dragon", "ghost",
    "mimic", "mummy", "witch", "skeleton", "candle", "alien" }
local KNOWN_PETS = {}
for _i, name in ipairs(Decor.PETS) do KNOWN_PETS[name] = true end

function Decor.pet(name)
    return require("bookorbit_pets." .. (KNOWN_PETS[name] and name or "cat"))
end

function Decor.buddy(ctx, w, hh, props)
    local d = ctx.d
    local pad = px(12)
    local iw, ih = w - 2 * pad, hh - 2 * pad
    local pose = Decor.buddyPose(d)
    local pet = Decor.pet(props and props.animal)
    local rows, palette = pet[pose], pet.palette
    local SW, SH = #rows[1], #rows
    local lines, data2 = buddyLines(pose, d)
    -- Half steps, so a 64-cell pet has a size between 64 and 128 pixels.
    local function scaleFor(aw, ah) return math.max(1, math.floor(math.min(aw / SW, ah / SH) * 2) / 2) end
    local function size(k) return BoardArt.spriteEdge(SW, k), BoardArt.spriteEdge(SH, k) end
    local function sprite(k) return BoardArt.sprite(rows, k, palette) end
    -- The floor shadow is a twentieth of the sprite's width.
    local with_shadow = 1 + 0.05 * SW / SH
    local variants = {}
    local wide = iw > ih * 1.6
    local tall = ih > iw * 0.6 and ih > px(150)
    if tall then
        -- Near-square tiles: the bubble above, the companion on the floor under it,
        -- when that gives a bigger companion than sitting side by side.
        local side_k = scaleFor(math.min(iw * 0.6, iw - px(10) - px(124)), (ih - px(2)) / with_shadow)
        for _i, s in ipairs({ 15, 14 }) do
            table.insert(variants, function()
                local bw = math.min(iw, math.max(px(200), round(iw * 0.72)))
                local bub, _ox, bh = bubble(bw, lines, s, "down", data2)
                local gap_v = px(14)
                local k = scaleFor(iw * 0.8, (ih - bh - gap_v) / with_shadow)
                if k <= side_k then return skip("stacked companion no bigger") end
                local sw, sh = size(k)
                local sh_h = math.max(3, round(sw * 0.05))
                local top = round((ih - (bh + gap_v + sh + sh_h)) / 2)
                if top < 0 then return skip("stack too tall") end
                return padded(w, hh, { overlay(iw, ih, {
                    { widget = bub, x = round((iw - bw) / 2), y = top },
                    { widget = shadow(sw), x = round((iw - round(sw * 0.62)) / 2), y = top + bh + gap_v + sh - round(sh_h / 2) },
                    { widget = sprite(k), x = round((iw - sw) / 2), y = top + bh + gap_v },
                }) })
            end)
        end
        -- The companion on the left, talking up and to the right.
        for _i, s in ipairs({ 15, 14, 13 }) do
            table.insert(variants, function()
                local gap = px(10)
                local k = scaleFor(math.min(iw * 0.6, iw - gap - px(124)), (ih - px(2)) / with_shadow)
                local sw, sh = size(k)
                -- Floors are sprite widths in pixels, not scales, so they mean the
                -- same for every canvas size.
                if sw < 96 then return skip("companion too small") end
                local sh_h = math.max(3, round(sw * 0.05))
                local bw = iw - sw - gap
                local bub, ox, bh = bubble(bw, lines, s, "left", data2)
                if bh > ih then return skip("bubble too tall") end
                local top = round((ih - sh - sh_h / 2) / 2)
                local btop = clamp(top + round(sh * 0.22) - px(14), 0, ih - bh)
                return padded(w, hh, { overlay(iw, ih, {
                    { widget = shadow(sw), x = round((sw - round(sw * 0.62)) / 2), y = top + sh - round(sh_h / 2) },
                    { widget = sprite(k), x = 0, y = top },
                    { widget = bub, x = sw + gap - ox, y = btop },
                }) })
            end)
        end
    end
    if wide then
        -- The companion on the left, its bubble beside it.
        for _i, s in ipairs({ 14, 13, 12 }) do
            for _j, two in ipairs({ true, false }) do
                table.insert(variants, function()
                    local k = scaleFor(iw * 0.42, ih)
                    local sw = size(k)
                    local gap = px(14)
                    local bw = iw - sw - gap
                    if bw < px(96) then return skip("bubble too narrow") end
                    local bub, ox = bubble(bw, two and lines or { lines[1] }, s, "left", data2)
                    return padded(w, hh, {
                        hstack({ w = iw, h = ih }, {
                            vstack({ w = sw, h = ih }, { flex(0), sprite(k) }),
                            space(gap - ox, 1),
                            bub,
                        }),
                    })
                end)
            end
        end
    end
    -- The companion, with one line under it when it fits.
    table.insert(variants, function()
        local cap_h = lh1(12) + px(4)
        local k = scaleFor(iw, ih - cap_h)
        if size(k) < 64 then return skip("companion too small") end
        return padded(w, hh, { flex(0), sprite(k), space(nil, px(4)), text(lines[1], { s = 12, b = true, w = iw, align = "center" }) }, "center")
    end)
    table.insert(variants, function()
        return padded(w, hh, { flex(0), sprite(scaleFor(iw, ih)), flex(0) }, "center")
    end)
    return pick(variants)
end

-- ================================================================ analog clock
local function clockFace(dia, hour, minute, accent)
    local r = dia / 2
    local cx, cy = r, r
    local body = { '<circle cx="' .. n(cx) .. '" cy="' .. n(cy) .. '" r="' .. n(r - 0.5) .. '" fill="#ffffff"/>' }
    for i = 0, 11 do
        local a = i * math.pi / 6
        local major = i % 3 == 0
        local r1 = r - px(major and 4 or 5)
        local r2 = r - (major and r * 0.2 or r * 0.12) - px(3)
        table.insert(body, '<line x1="' .. n(cx + r1 * math.sin(a)) .. '" y1="' .. n(cy - r1 * math.cos(a)) .. '" x2="' .. n(cx + r2 * math.sin(a))
            .. '" y2="' .. n(cy - r2 * math.cos(a)) .. '" stroke="' .. (major and accent or "#555555") .. '" stroke-width="'
            .. n(major and math.max(2, px(2.5)) or math.max(1, px(1.25))) .. '" stroke-linecap="round"/>')
    end
    local ah = ((hour % 12) + minute / 60) * math.pi / 6
    local am = minute * math.pi / 30
    local function hand(a, len, width, tail)
        return '<line x1="' .. n(cx - tail * math.sin(a)) .. '" y1="' .. n(cy + tail * math.cos(a)) .. '" x2="' .. n(cx + len * math.sin(a))
            .. '" y2="' .. n(cy - len * math.cos(a)) .. '" stroke="#000000" stroke-width="' .. n(width) .. '" stroke-linecap="round"/>'
    end
    table.insert(body, hand(ah, r * 0.5, math.max(3, px(4.5)), r * 0.08))
    table.insert(body, hand(am, r * 0.76, math.max(2, px(2.75)), r * 0.1))
    table.insert(body, '<circle cx="' .. n(cx) .. '" cy="' .. n(cy) .. '" r="' .. n(math.max(3, px(4))) .. '" fill="' .. accent .. '"/>')
    table.insert(body, '<circle cx="' .. n(cx) .. '" cy="' .. n(cy) .. '" r="' .. n(math.max(1, px(1.25))) .. '" fill="#ffffff"/>')
    return svg(round(dia), round(dia), table.concat(body))
end

function Decor.analog(ctx, w, hh)
    local d = ctx.d
    local accent = BoardColour.artHex(ctx, "#000000", "ink", "red")
    local pad = px(12)
    local iw, ih = w - 2 * pad, hh - 2 * pad
    local now = d.now or os.time()
    local hour, minute = tonumber(os.date("%H", now)), tonumber(os.date("%M", now))
    local variants = {}
    if iw > ih * 1.5 then
        for _i, s in ipairs({ 15, 14 }) do
            table.insert(variants, function()
                local dia = ih
                local tw = iw - dia - px(14)
                if tw < px(70) then return skip("no room for the date") end
                return padded(w, hh, {
                    hstack({ w = iw, h = ih, gap = px(14) }, {
                        clockFace(dia, hour, minute, accent),
                        vstack({ w = tw }, {
                            text(d.weekday, { s = s, b = true, w = tw, col = INK.white }),
                            text(d.day_month, { s = 13, w = tw, col = BoardColour.onInk(ctx, INK.gc) }),
                            space(nil, px(4)),
                            text(d.clock, { s = 13, b = true, w = tw, col = BoardColour.onInk(ctx, INK.gc) }),
                        }),
                    }),
                })
            end)
        end
    end
    table.insert(variants, function()
        return padded(w, hh, { flex(0), clockFace(math.max(1, math.min(iw, ih)), hour, minute, accent), flex(0) }, "center")
    end)
    return pick(variants)
end

-- ================================================================ moon
-- Lit when inside the disc and on the bright side of the terminator.
local function isLit(m, x, y)
    if x * x + y * y > 1 then return false end
    local k = math.cos(2 * math.pi * m.p)
    local tx = k * math.sqrt(math.max(0, 1 - y * y))
    if m.p < 0.5 then return x > tx end
    return x < -tx
end

-- Roughly where the big maria sit: Imbrium, Serenitatis, Tranquillitatis,
-- Procellarum and Nubium, drawn only where wholly in the light.
local MARIA = { { -0.26, -0.36, 0.24, 0.17, -0.3 }, { 0.2, -0.3, 0.13, 0.12, 0 }, { 0.32, -0.02, 0.15, 0.12, 0.4 }, { -0.5, 0.06, 0.15, 0.3, 0.1 }, { -0.08, 0.42, 0.15, 0.09, 0.2 } }

local function moonDisc(dia, m, ctx)
    local R = dia / 2 - math.max(1, px(1))
    local cx, cy = dia / 2, dia / 2
    local body = { '<circle cx="' .. n(cx) .. '" cy="' .. n(cy) .. '" r="' .. n(R) .. '" fill="' .. artHex(ctx, "#222222", "#2a3062") .. '" stroke="' .. artHex(ctx, "#666666", "#5a628f") .. '" stroke-width="' .. n(math.max(1, px(1))) .. '"/>' }
    if m.lit > 0.004 then
        local k = math.cos(2 * math.pi * m.p)
        local waxing = m.p < 0.5
        local top, bottom = n(cx) .. " " .. n(cy - R), n(cx) .. " " .. n(cy + R)
        local limb_sweep = waxing and 1 or 0
        local term_sweep
        if waxing then term_sweep = k > 0 and 0 or 1 else term_sweep = k > 0 and 1 or 0 end
        local trx = math.max(0.01, math.abs(k) * R)
        table.insert(body, '<path d="M' .. top .. ' A' .. n(R) .. ' ' .. n(R) .. ' 0 0 ' .. limb_sweep .. ' ' .. bottom .. ' A' .. n(trx) .. ' ' .. n(R)
            .. ' 0 0 ' .. term_sweep .. ' ' .. top .. ' Z" fill="' .. artHex(ctx, "#ffffff", "#f7efcf") .. '"/>')
        for _i, mare in ipairs(MARIA) do
            local mx, my, ex, ey, rot = mare[1], mare[2], mare[3], mare[4], mare[5]
            local ok = true
            for i = 0, 11 do
                if not ok then break end
                local a = i * math.pi / 6
                local qx, qy = ex * math.cos(a), ey * math.sin(a)
                ok = isLit(m, mx + qx * math.cos(rot) - qy * math.sin(rot), my + qx * math.sin(rot) + qy * math.cos(rot))
            end
            if ok then
                table.insert(body, '<ellipse cx="' .. n(cx + mx * R) .. '" cy="' .. n(cy + my * R) .. '" rx="' .. n(ex * R) .. '" ry="' .. n(ey * R)
                    .. '" transform="rotate(' .. n(rot * 57.3) .. ' ' .. n(cx + mx * R) .. ' ' .. n(cy + my * R) .. ')" fill="' .. artHex(ctx, "#dddddd", "#e2d3a2") .. '"/>')
            end
        end
    end
    return svg(round(dia), round(dia), table.concat(body))
end

-- A few fixed stars on the night sky, kept clear of the moon and the words.
local function sky(w, hh, avoid, clear)
    local r = rng(7)
    local body = {}
    local count = round(w * hh / (px(34) * px(34)))
    for _i = 1, count do
        local x, y = r() * w, r() * hh
        local big = r() > 0.82
        local keep = true
        if avoid and math.sqrt((x - avoid.x) ^ 2 + (y - avoid.y) ^ 2) < avoid.r + px(6) then keep = false end
        if keep and clear and x > clear.x - px(6) and x < clear.x + clear.w + px(6) and y > clear.y - px(6) and y < clear.y + clear.h + px(6) then keep = false end
        if keep and (x < px(8) or y < px(8) or x > w - px(8) or y > hh - px(8)) then keep = false end
        if keep then
            if big then
                local a, b = px(3), px(0.8)
                table.insert(body, '<path d="M' .. n(x) .. ' ' .. n(y - a) .. ' L' .. n(x + b) .. ' ' .. n(y - b) .. ' L' .. n(x + a) .. ' ' .. n(y)
                    .. ' L' .. n(x + b) .. ' ' .. n(y + b) .. ' L' .. n(x) .. ' ' .. n(y + a) .. ' L' .. n(x - b) .. ' ' .. n(y + b)
                    .. ' L' .. n(x - a) .. ' ' .. n(y) .. ' L' .. n(x - b) .. ' ' .. n(y - b) .. ' Z" fill="#ffffff"/>')
            else
                table.insert(body, '<circle cx="' .. n(x) .. '" cy="' .. n(y) .. '" r="' .. n(math.max(0.8, px(0.9))) .. '" fill="' .. (r() > 0.5 and "#ffffff" or "#999999") .. '"/>')
            end
        end
    end
    return svg(w, hh, table.concat(body))
end

function Decor.moon(ctx, w, hh)
    local m = ctx.d.moon or BoardData.moon(ctx.d.now)
    local pad = px(12)
    local iw, ih = w - 2 * pad, hh - 2 * pad
    local lit = round(m.lit * 100)
    local variants = {}
    if iw > ih * 1.5 then
        for _i, v in ipairs({ { 15, 0.4 }, { 15, 0.32 }, { 14, 0.3 } }) do
            table.insert(variants, function()
                local dia = math.min(ih, round(iw * v[2]))
                local tw = iw - dia - px(16)
                if tw < px(80) then return skip("no room for words") end
                local words = vstack({ w = tw }, {
                    text(m.name, { s = v[1], b = true, w = tw, col = INK.white }),
                    text(T(_("%1% lit"), lit), { s = 13, w = tw, col = BoardColour.onInk(ctx, INK.gc, "moon") }),
                    space(nil, px(4)),
                    text(m.next, { s = 12, w = tw, col = BoardColour.onInk(ctx, INK.gc, "moon") }),
                })
                return overlay(w, hh, {
                    { widget = sky(w, hh, { x = pad + dia / 2, y = hh / 2, r = dia / 2 }, { x = pad + dia, y = 0, w = w, h = hh }) },
                    { widget = moonDisc(dia, m, ctx), x = pad, y = round((hh - dia) / 2) },
                    { widget = vstack({ w = tw, h = hh }, { flex(0), words, flex(0) }), x = pad + dia + px(16), y = 0 },
                })
            end)
        end
    end
    for _i, caption in ipairs({ true, false }) do
        table.insert(variants, function()
            local cap_h = caption and lh1(12) + px(6) or 0
            local dia = math.min(iw, ih - cap_h)
            if dia < px(40) and caption then return skip("moon too small") end
            dia = math.max(1, dia)
            local top = pad + (ih - cap_h - dia) / 2
            local layers = {
                { widget = sky(w, hh, { x = w / 2, y = top + dia / 2, r = dia / 2 }, caption and { x = 0, y = hh - pad - lh1(12), w = w, h = lh1(12) } or nil) },
                { widget = moonDisc(dia, m, ctx), x = round((w - dia) / 2), y = round(top) },
            }
            if caption then
                table.insert(layers, { widget = text(m.name, { s = 12, b = true, w = iw, col = INK.white, align = "center" }), x = pad, y = hh - pad - lh1(12) })
            end
            return overlay(w, hh, layers)
        end)
    end
    return pick(variants)
end

-- ================================================================ odometer
-- The last wheel, caught mid-turn: the bottom of its digit and the top of
-- the next, both drawn into the wheel's own box so neither spills out.
local RollingWheel = Widget:extend{ digit = 0, size = 10, roll = 0, pitch = 0, color = nil }

function RollingWheel:getSize()
    return self.dimen
end

function RollingWheel:paintTo(bb, x, y)
    self.dimen.x, self.dimen.y = x, y
    local w, h = self.dimen.w, self.dimen.h
    local function draw(digit, center_y)
        local g = BoardArt.glyphBitmap("NotoSans-Bold.ttf", 48 + digit, self.size)
        if not g then return end
        local gw, gh = g.bb:getWidth(), g.bb:getHeight()
        local gx = x + math.floor((w - gw) / 2)
        local gy = y + round(center_y - gh / 2)
        local top, bottom = math.max(gy, y), math.min(gy + gh, y + h)
        if bottom <= top then return end
        bb:colorblitFrom(g.bb, gx, top, 0, top - gy, gw, bottom - top, self.color or INK.black)
    end
    draw(self.digit, h / 2 - self.roll)
    if self.roll > 0 then draw((self.digit + 1) % 10, h / 2 - self.roll + self.pitch) end
end

function Decor.odometer(ctx, w, hh)
    local d = ctx.d
    local pad = px(12)
    local iw, ih = w - 2 * pad, hh - 2 * pad
    local pages = d.pages or {}
    local total, today = pages.total or 0, pages.today or 0
    local digits = string.format("%06d", total)
    local count = #digits
    local g = px(3)
    local hot = BoardColour.on(ctx)
    local function drums(dw, dh)
        local fs = math.floor(dh * 0.62 / BoardMetrics.get().dp)
        local items = {}
        for i = 1, count do
            local ch = digits:sub(i, i)
            local shade_col = i < count and INK.g3 or (hot and BoardColour.paint(BoardColour.mix(BoardColour.fam(ctx).ink, "#ffffff", 0.3)) or INK.gd)
            local layers = {
                { widget = BoardUI.box({ w = dw, h = dh, radius = px(3), bg = i < count and INK.black or BoardColour.ink(ctx, INK.white) }) },
                { widget = BoardUI.rect(dw, math.max(1, px(1)), shade_col), y = round(dh * 0.16) },
                { widget = BoardUI.rect(dw, math.max(1, px(1)), shade_col), y = round(dh * 0.84) },
            }
            if i < count then
                table.insert(layers, { widget = vstack({ w = dw, h = dh, align = "center" }, { flex(0), text(ch, { s = fs, b = true, col = INK.white }), flex(0) }) })
            else
                local pitch = dh * 0.8
                -- Nothing read today: the wheel rests on its digit.
                local roll = today > 0 and round(pitch * 0.3) or 0
                table.insert(layers, { widget = RollingWheel:new{ digit = tonumber(ch), size = BoardMetrics.fs(fs), roll = roll, pitch = pitch, color = hot and INK.white or INK.black, dimen = Geom:new{ w = dw, h = dh } } })
                if not hot then
                    table.insert(layers, { widget = BoardUI.box({ w = dw, h = dh, radius = px(3), border = math.max(1, px(1.5)), border_col = INK.black }) })
                end
            end
            table.insert(items, overlay(dw, dh, layers))
        end
        return hstack({ gap = g }, items)
    end
    local function todayRuns(s)
        return runs({ { t = "+" .. formatCount(today), b = true, col = INK.black }, { t = " " .. _("today") } }, { s = s, col = INK.g4 })
    end
    local function sub(s)
        local left = todayRuns(s)
        if total > 0 and pages.since and iw > px(200) then
            local right = text(T(_("since %1"), pages.since), { s = s, col = INK.g4 })
            if left:getSize().w + px(4) + right:getSize().w <= iw then return BoardUI.spread(iw, left, right) end
        end
        return left
    end
    local variants = {}
    for _i, mode in ipairs({ "sub", "beside", "none", "bare" }) do
        local with_sub = mode == "sub"
        table.insert(variants, function()
            local room = ih - lh1(13) - px(8) - (with_sub and lh1(12) + px(8) or 0)
            local dw = math.floor((iw - (count - 1) * g) / count)
            local dh = math.min(room, round(dw * 1.5), px(64))
            if dh < px(20) then
                if mode ~= "bare" then return skip("wheels too small") end
                dh = math.max(px(12), dh)
            end
            local dw_fit = math.min(dw, round(dh / 1.32))
            local right = nil
            if mode == "beside" then right = todayRuns(12)
            elseif mode ~= "bare" then right = icon("book-open", px(17), BoardColour.icon(ctx, 2.25)) end
            return padded(w, hh, {
                head(iw, _("Pages turned"), right),
                flex(0),
                hstack({ w = iw }, { flex(0), drums(dw_fit, dh), flex(0) }),
                flex(0),
                with_sub and sub(12) or false,
            })
        end)
    end
    return pick(variants)
end

-- ================================================================ glyph
local function glyphArt(g, max_w, max_h, col)
    local art = BoardArt.glyph(g.font, g.cp, math.max(1, max_w), math.max(1, max_h))
    if art then art.color = col end
    return art
end

-- A line of the alphabet in the glyph's own font.
local function specimen(g, s, w)
    local face = BoardMetrics.fileFace(g.font, s)
    if not face then return space(nil, lh1(s)) end
    return CenterContainer:new{
        dimen = Geom:new{ w = w, h = lh1(s) },
        TextWidget:new{ text = g.sample, face = face, fgcolor = INK.g3, padding = 0, max_width = w },
    }
end

function Decor.glyph(ctx, w, hh)
    local g = ctx.d.glyph
    local pad = px(12)
    local iw, ih = w - 2 * pad, hh - 2 * pad
    if not g then
        return emptyTile(w, hh, _("Glyph of the day"), nil, _("The fonts on this device have no glyph to show today."), _("No glyph today."))
    end
    local name = g.name()
    local cp = string.format("U+%04X", g.cp)
    local variants = {}
    if iw > ih * 1.5 then
        for _i, s in ipairs({ 15, 14 }) do
            table.insert(variants, function()
                local gw_max = math.min(ih, round(iw * 0.4))
                local art = glyphArt(g, gw_max, ih - px(4), BoardColour.ink(ctx, INK.black))
                if not art then return skip("no glyph") end
                local tw = iw - gw_max - px(14)
                if tw < px(90) then return skip("no room for words") end
                return padded(w, hh, {
                    hstack({ w = iw, h = ih, gap = px(14) }, {
                        hstack({ w = gw_max, h = ih }, { flex(0), art, flex(0) }),
                        vstack({ w = tw }, {
                            text(_("Glyph of the day"), { s = 12, col = INK.g4, w = tw }),
                            text(name, { s = s, b = true, w = tw }),
                            text(g.label, { s = 12, w = tw }),
                            text(cp, { s = 11, col = INK.g4, w = tw }),
                        }),
                    }),
                })
            end)
        end
    end
    if ih > px(150) then
        table.insert(variants, function()
            local foot = lh1(15) + lh1(12) + (g.sample and lh1(14) + px(8) or 0) + px(10)
            local art = glyphArt(g, iw - px(20), ih - foot - px(10), BoardColour.ink(ctx, INK.black))
            if not art then return skip("no glyph") end
            return padded(w, hh, {
                flex(0), art, flex(0),
                text(name, { s = 15, b = true, w = iw, align = "center" }),
                text(g.label .. "  ·  " .. cp, { s = 12, col = INK.g4, w = iw, align = "center" }),
                g.sample and space(nil, px(8)) or false,
                g.sample and specimen(g, 14, iw) or false,
            }, "center")
        end)
    end
    for _i, two in ipairs({ true, false }) do
        table.insert(variants, function()
            local foot = lh1(12) + (two and lh1(11) or 0) + px(6)
            local art = glyphArt(g, iw, ih - foot, BoardColour.ink(ctx, INK.black))
            if not art then return skip("no glyph") end
            return padded(w, hh, {
                flex(0), art, flex(0),
                text(name, { s = 12, b = true, w = iw, align = "center" }),
                two and text(g.label, { s = 11, col = INK.g4, w = iw, align = "center" }) or false,
            }, "center")
        end)
    end
    table.insert(variants, function()
        local art = glyphArt(g, iw, ih, BoardColour.ink(ctx, INK.black)) or text(name, { s = 14, b = true, w = iw, align = "center" })
        return padded(w, hh, { flex(0), art, flex(0) }, "center")
    end)
    return pick(variants)
end

-- ================================================================ tree rings
-- One ring a month, the oldest at the pith; a ring is as wide as that
-- month's reading. The pith sits a little off centre and every ring wobbles
-- a little, as in real wood.
-- Bark, rings and heartwood: wood colours on a colour screen, grays otherwise.
local function woodColours(ctx)
    return {
        bark = artHex(ctx, "#444444", "#6b4426"), edge = artHex(ctx, "#000000", "#3b2512"), ring = artHex(ctx, "#ffffff", "#f4e4c6"),
        peak = artHex(ctx, "#dddddd", "#e2b56a"), line = artHex(ctx, "#666666", "#a37a52"), pith = artHex(ctx, "#555555", "#7a4f2c"),
        crack = artHex(ctx, "#222222", "#3b2512"),
    }
end

local function ringsArt(dia, months, seed, wood)
    local r = rng(seed)
    local bark = math.max(3, px(5))
    -- Room for the wobble and the off-centre pith, so the bark never clips.
    local R = (dia / 2 - bark - 1) / 1.07
    local cx, cy = dia / 2, dia / 2
    local max = 1
    for _i, m in ipairs(months) do max = math.max(max, m.min) end
    local widths, sum = {}, 0
    for i, m in ipairs(months) do
        widths[i] = 0.12 + m.min / max
        sum = sum + widths[i]
    end
    local pith_r = R * 0.07
    local bounds, acc = {}, 0
    for i, wv in ipairs(widths) do
        acc = acc + wv
        bounds[i] = pith_r + (R - pith_r) * acc / sum
    end
    local ph = { r() * 6.28, r() * 6.28, r() * 6.28 }
    local off = { -R * 0.07, R * 0.05 }
    local N = 96
    local function loop(rad, extra)
        local t = rad / R
        local ox, oy = cx + off[1] * (1 - t), cy + off[2] * (1 - t)
        local parts = {}
        for i = 0, N - 1 do
            local a = i / N * 2 * math.pi
            local wob = 1 + (0.02 * math.sin(3 * a + ph[1]) + 0.014 * math.sin(5 * a + ph[2]) + 0.012 * math.sin(2 * a + ph[3])) * math.min(1, t * 1.6)
            local rr = rad * wob + (extra or 0)
            table.insert(parts, (i == 0 and "M" or "L") .. n(ox + rr * math.cos(a)) .. " " .. n(oy + rr * math.sin(a)))
        end
        return table.concat(parts) .. "Z"
    end
    local peak = 1
    for i, m in ipairs(months) do
        if m.min > months[peak].min then peak = i end
    end
    local body = { '<path d="' .. loop(R, bark) .. '" fill="' .. wood.bark .. '" stroke="' .. wood.edge .. '" stroke-width="' .. n(math.max(1, px(1.25))) .. '"/>' }
    for i = #months, 1, -1 do
        table.insert(body, '<path d="' .. loop(bounds[i]) .. '" fill="' .. (i == peak and wood.peak or wood.ring) .. '" stroke="' .. wood.line .. '" stroke-width="'
            .. n(math.max(1, px(i == #months and 1.25 or 1))) .. '"/>')
    end
    table.insert(body, '<path d="' .. loop(pith_r * 0.9) .. '" fill="' .. wood.pith .. '"/>')
    -- A drying check: a thin crack from the bark towards the heart.
    local ca = -0.62
    local x1, y1 = cx + (R + bark) * math.cos(ca), cy + (R + bark) * math.sin(ca)
    local x2, y2 = cx + R * 0.45 * math.cos(ca + 0.05), cy + R * 0.45 * math.sin(ca + 0.05)
    local nx, ny = -math.sin(ca) * px(1.6), math.cos(ca) * px(1.6)
    table.insert(body, '<path d="M' .. n(x1 - nx) .. ' ' .. n(y1 - ny) .. ' L' .. n(x2) .. ' ' .. n(y2) .. ' L' .. n(x1 + nx) .. ' ' .. n(y1 + ny) .. ' Z" fill="' .. wood.crack .. '"/>')
    return svg(round(dia), round(dia), table.concat(body))
end

local function sapling(dia, wood)
    local h = dia / 2
    return svg(dia, dia, '<circle cx="' .. n(h) .. '" cy="' .. n(h) .. '" r="' .. n(h - 1) .. '" fill="' .. wood.bark .. '" stroke="' .. wood.edge .. '" stroke-width="' .. n(math.max(1, px(1)))
        .. '"/><circle cx="' .. n(h) .. '" cy="' .. n(h) .. '" r="' .. n(h - math.max(3, px(4))) .. '" fill="' .. wood.ring .. '" stroke="' .. wood.line .. '" stroke-width="' .. n(math.max(1, px(1)))
        .. '"/><circle cx="' .. n(h) .. '" cy="' .. n(h) .. '" r="' .. n(math.max(2, dia * 0.08)) .. '" fill="' .. wood.pith .. '"/>')
end

function Decor.rings(ctx, w, hh)
    local d = ctx.d
    local pad = px(12)
    local iw, ih = w - 2 * pad, hh - 2 * pad
    local months = d.months or {}
    local any = false
    for _i, m in ipairs(months) do
        if m.min > 0 then any = true end
    end
    local variants = {}
    if not any or #months == 0 then
        for _i, with_art in ipairs({ true, false }) do
            table.insert(variants, function()
                local dia = math.min(px(56), ih - lh1(13) - px(12) - 2 * BoardMetrics.lh(13))
                if with_art and dia < px(28) then return skip("no room for the sapling") end
                return padded(w, hh, {
                    head(iw, _("Tree rings"), nil),
                    space(nil, px(6)),
                    text(_("A ring grows for every month you read."), { s = 13, col = INK.g4, lines = 3, w = iw }),
                    with_art and flex(0) or false,
                    with_art and hstack({ w = iw }, { flex(0), sapling(dia, woodColours(ctx)), flex(0) }) or false,
                    with_art and flex(0) or false,
                })
            end)
        end
        return pick(variants)
    end
    local peak, low = months[1], nil
    for _i, m in ipairs(months) do
        if m.min > peak.min then peak = m end
    end
    for _i, m in ipairs(months) do
        if m.min > 0 and (not low or m.min < low.min) then low = m end
    end
    low = low or peak
    local function hours(m) return T(_("%1 h"), round(m.min / 60)) end
    local function labelRuns(label, m, long, s, wd, align)
        return runs({ { t = label .. " " }, { t = T(_("%1, %2"), BoardData.monthName(m.month, long), hours(m)), b = true, col = INK.black } }, { s = s, col = INK.g4, w = wd, align = align })
    end
    if iw > ih * 1.5 then
        -- Title size, the subtitle, the thinnest month. A short tile keeps the
        -- widest and thinnest months over the subtitle.
        for _i, v in ipairs({ { 15, true, true }, { 14, true, true }, { 14, false, true }, { 14, false, false } }) do
            table.insert(variants, function()
                local dia = ih
                local tw = iw - dia - px(14)
                if tw < px(100) then return skip("no room for words") end
                return padded(w, hh, {
                    hstack({ w = iw, h = ih, gap = px(14) }, {
                        ringsArt(dia, months, 3, woodColours(ctx)),
                        vstack({ w = tw }, {
                            text(_("Tree rings"), { s = v[1], b = true, w = tw }),
                            v[2] and text(_("One ring a month"), { s = 12, col = INK.g4, w = tw }) or false,
                            v[2] and space(nil, px(6)) or false,
                            labelRuns(_("Widest"), peak, false, 12, tw),
                            v[3] and labelRuns(_("Thinnest"), low, false, 12, tw) or false,
                        }),
                    }),
                })
            end)
        end
    end
    for _i, caption in ipairs({ true, false }) do
        table.insert(variants, function()
            local cap_h = caption and lh1(12) + px(8) or 0
            local dia = math.min(iw, ih - lh1(13) - px(8) - cap_h)
            if dia < px(60) and caption then return skip("rings too small") end
            dia = math.max(1, dia)
            return padded(w, hh, {
                head(iw, _("Tree rings"), text(_("12 months"), { s = 12, col = INK.g4 })),
                flex(0),
                ringsArt(dia, months, 3, woodColours(ctx)),
                flex(0),
                caption and labelRuns(_("Widest ring"), peak, true, 12, iw, "center") or false,
            }, "center")
        end)
    end
    return pick(variants)
end

-- ================================================================ chapter line
local function tram(x, y, scale)
    local tw, th = px(16) * scale, px(11) * scale
    local win = px(3.2) * scale
    return '<rect x="' .. n(x - tw / 2) .. '" y="' .. n(y - th / 2) .. '" width="' .. n(tw) .. '" height="' .. n(th) .. '" rx="' .. n(px(3) * scale)
        .. '" fill="#000000" stroke="#ffffff" stroke-width="' .. n(px(1.5)) .. '"/>'
        .. '<rect x="' .. n(x - tw / 2 + px(2.5) * scale) .. '" y="' .. n(y - th / 2 + px(2.4) * scale) .. '" width="' .. n(win * 1.25) .. '" height="' .. n(win)
        .. '" rx="' .. n(px(0.8)) .. '" fill="#ffffff"/>'
        .. '<rect x="' .. n(x + tw / 2 - px(2.5) * scale - win * 1.25) .. '" y="' .. n(y - th / 2 + px(2.4) * scale) .. '" width="' .. n(win * 1.25)
        .. '" height="' .. n(win) .. '" rx="' .. n(px(0.8)) .. '" fill="#ffffff"/>'
end

-- Where the train is between its station and the next, 0 to 1.
local function trainFraction(cs)
    local here, nxt = cs.stops[cs.cur], cs.stops[cs.cur + 1]
    if not nxt or nxt.pct <= here.pct then return 0 end
    return clamp((cs.pos - here.pct) / (nxt.pct - here.pct), 0, 1)
end

-- The whole line, stations evenly spaced like a metro map, with labels
-- placed left to right where they do not collide.
local function lineArt(w, cs, o)
    o = o or {}
    local lw = math.max(3, px(4))
    local r = px(4)
    local x0, x1 = px(9), w - px(9)
    local count = #cs.stops
    local function xi(i) return x0 + (x1 - x0) * (i - 1) / (count - 1) end
    local train_x = xi(cs.cur) + (xi(math.min(cs.cur + 1, count)) - xi(cs.cur)) * trainFraction(cs)
    local track_y = px(10)
    local art_h = px(20)
    local body = {
        '<line x1="' .. n(train_x) .. '" y1="' .. track_y .. '" x2="' .. n(x1) .. '" y2="' .. track_y .. '" stroke="' .. (o.ahead or "#bbbbbb") .. '" stroke-width="' .. lw .. '" stroke-linecap="round"/>',
        '<line x1="' .. n(x0) .. '" y1="' .. track_y .. '" x2="' .. n(train_x) .. '" y2="' .. track_y .. '" stroke="' .. (o.line or "#000000") .. '" stroke-width="' .. lw .. '" stroke-linecap="round"/>',
    }
    for i, stop in ipairs(cs.stops) do
        local past = stop.pct <= cs.pos
        local last = i == count
        local rr = math.min(last and r * 1.25 or r, (x1 - x0) / (count - 1) * 0.36)
        table.insert(body, '<circle cx="' .. n(xi(i)) .. '" cy="' .. track_y .. '" r="' .. n(rr) .. '" fill="' .. (past and (o.line or "#000000") or "#ffffff")
            .. '" stroke="' .. (o.line or "#000000") .. '" stroke-width="' .. n(math.max(1, px(1.5))) .. '"/>')
        if last then table.insert(body, '<circle cx="' .. n(xi(i)) .. '" cy="' .. track_y .. '" r="' .. n(rr * 0.42) .. '" fill="' .. (o.line or "#000000") .. '"/>') end
    end
    table.insert(body, tram(train_x, track_y, 1))
    local layers = { { widget = svg(w, art_h, table.concat(body)) } }
    local height = art_h
    if o.labels then
        local ly = art_h + px(2)
        local placed = {}
        local function place(i, label, bold)
            local el = text(label, { s = 11, b = bold, col = bold and INK.black or INK.g4 })
            local tw = el:getSize().w
            local x = clamp(round(xi(i) - tw / 2), 0, math.max(0, w - tw))
            for _i, span in ipairs(placed) do
                if x < span[2] + px(8) and x + tw > span[1] - px(8) then return false end
            end
            table.insert(placed, { x, x + tw })
            table.insert(layers, { widget = el, x = x, y = ly })
            return true
        end
        place(count, _("End"), true)
        for i = cs.next, count - 1 do
            if #placed >= (o.max or 9) then break end
            local m = cs.minutes(i)
            local label = cs.stops[i].title .. (m and (" · " .. BoardData.formatShortDuration(m)) or "")
            if not place(i, label, i == cs.next) and i == cs.next then break end
        end
        height = height + px(2) + lh1(11)
    end
    return overlay(w, height, layers)
end

-- The next stations as a timetable down a vertical line, with how long
-- until each. The stretch the train is on is taller, so the car stands
-- clear of both its stations. Nil when fewer than three rows fit.
local function timetable(w, avail, cs, line_col, ahead_col)
    local row_h = lh1(14) + px(6)
    local stretch = 0.7
    local rows = math.floor(avail / row_h - stretch)
    if rows < 3 then return nil end
    local last_i = #cs.stops
    local ahead = last_i - cs.cur
    local show_end = cs.cur + rows - 1 < last_i
    local count = math.min(rows - (show_end and 1 or 0), ahead + 1)
    local list = {}
    for k = 0, count - 1 do table.insert(list, cs.cur + k) end
    if show_end then table.insert(list, last_i) end
    local lx = px(10)
    local lw = math.max(3, px(4))
    local r = px(5)
    local H = round((#list + stretch) * row_h)
    local function cy(k) return k * row_h + row_h / 2 + (k >= 1 and stretch * row_h or 0) end
    local t_h = px(16)
    local clear = r + t_h / 2 + px(1)
    local seg = cy(1) - cy(0)
    local ty = clamp(cy(0) + seg * trainFraction(cs), cy(0) + clear, cy(1) - clear)
    local body = { '<line x1="' .. lx .. '" y1="' .. n(cy(0)) .. '" x2="' .. lx .. '" y2="' .. n(ty) .. '" stroke="' .. line_col .. '" stroke-width="' .. lw .. '"/>' }
    local last_y = cy(#list - 1)
    if show_end then
        local gap_y = cy(#list - 2)
        table.insert(body, '<line x1="' .. lx .. '" y1="' .. n(ty) .. '" x2="' .. lx .. '" y2="' .. n(gap_y) .. '" stroke="' .. ahead_col .. '" stroke-width="' .. lw .. '"/>')
        table.insert(body, '<line x1="' .. lx .. '" y1="' .. n(gap_y) .. '" x2="' .. lx .. '" y2="' .. n(last_y) .. '" stroke="' .. ahead_col .. '" stroke-width="' .. lw
            .. '" stroke-dasharray="' .. px(2) .. ' ' .. px(4) .. '"/>')
    else
        table.insert(body, '<line x1="' .. lx .. '" y1="' .. n(ty) .. '" x2="' .. lx .. '" y2="' .. n(last_y) .. '" stroke="' .. ahead_col .. '" stroke-width="' .. lw .. '"/>')
    end
    for k, i in ipairs(list) do
        local last = i == last_i
        local rr = last and r * 1.2 or r
        table.insert(body, '<circle cx="' .. lx .. '" cy="' .. n(cy(k - 1)) .. '" r="' .. n(rr) .. '" fill="' .. (k == 1 and line_col or "#ffffff")
            .. '" stroke="' .. line_col .. '" stroke-width="' .. n(math.max(1, px(1.5))) .. '"/>')
        if last then table.insert(body, '<circle cx="' .. lx .. '" cy="' .. n(cy(k - 1)) .. '" r="' .. n(rr * 0.42) .. '" fill="' .. line_col .. '"/>') end
    end
    local car_w, win = px(11), px(3.2)
    table.insert(body, '<rect x="' .. n(lx - car_w / 2) .. '" y="' .. n(ty - t_h / 2) .. '" width="' .. n(car_w) .. '" height="' .. n(t_h) .. '" rx="' .. n(px(3))
        .. '" fill="#000000" stroke="#ffffff" stroke-width="' .. n(px(1.5)) .. '"/>')
    table.insert(body, '<rect x="' .. n(lx - win * 0.65) .. '" y="' .. n(ty + t_h / 2 - px(2.4) - win) .. '" width="' .. n(win * 1.3) .. '" height="' .. n(win)
        .. '" rx="' .. n(px(0.8)) .. '" fill="#ffffff"/>')
    local name_x = lx + px(18)
    local layers = { { widget = svg(lx + px(12), H, table.concat(body)) } }
    for k, i in ipairs(list) do
        local m = cs.minutes(i)
        local right = k == 1 and _("now") or (m and BoardData.formatDuration(m) or "")
        local r_el = text(right, { s = 13, b = k == 2, col = k == 1 and INK.g4 or INK.black })
        local rw = r_el:getSize().w
        local nw = w - name_x - rw - px(8)
        local y = round(cy(k - 1) - lh1(14) / 2)
        table.insert(layers, { widget = text(cs.stops[i].title, { s = 14, b = k == 2, col = k == 1 and INK.g4 or INK.black, w = nw, data = true }), x = name_x, y = y })
        table.insert(layers, { widget = r_el, x = w - rw, y = y + round((lh1(14) - lh1(13)) / 2) })
    end
    return overlay(w, H, layers)
end

function Decor.chapters(ctx, w, hh)
    local line, ahead = BoardColour.artHex(ctx, "#000000", "ink"), BoardColour.artHex(ctx, "#bbbbbb", "tint")
    local cs = ctx.d.chapters
    local pad = px(12)
    local iw, ih = w - 2 * pad, hh - 2 * pad
    local function train() return icon("train-front", px(17), BoardColour.icon(ctx, 2.25)) end
    if not cs then
        return emptyTile(w, hh, _("Next stop"), train, _("Open a book and its chapters line up here."), _("Open a book to start."))
    end
    local next_min = cs.minutes(cs.next)
    local stops_left = #cs.stops - cs.cur
    local function endRuns(s)
        if not cs.end_min then return text(T(_.ngettext("%1 stop to the end", "%1 stops to the end", stops_left), stops_left), { s = s, col = INK.g4 }) end
        return runs({ { t = _("End of book in") .. " " }, { t = BoardData.formatDuration(cs.end_min), b = true, col = INK.black } }, { s = s, col = INK.g4 })
    end
    local when = next_min and BoardData.formatDuration(next_min) or BoardData.pctLabel(cs.book) or ""
    local variants = {}
    if ih > px(150) and iw < ih * 1.9 then
        table.insert(variants, function()
            local foot = lh1(12) + px(10)
            local tt = timetable(iw, ih - lh1(13) - px(12) - foot, cs, line, ahead)
            if not tt then return skip("timetable needs three rows") end
            return padded(w, hh, {
                head(iw, cs.book.title or "", text(BoardData.pctLabel(cs.book) or "", { s = 12, col = INK.g4 })),
                space(nil, px(12)),
                tt,
                flex(0),
                endRuns(12),
            })
        end)
    end
    -- The next stop large and the whole line under it.
    for _i, v in ipairs({ { 16, true, true }, { 16, false, true }, { 15, false, false }, { 14, false, false } }) do
        table.insert(variants, function()
            if iw < px(220) then return skip("too narrow for the line") end
            local art = lineArt(iw, cs, { labels = v[2], max = iw > px(500) and 6 or 3, line = line, ahead = ahead })
            local foot = false
            if v[3] then
                local left = endRuns(12)
                local right = text(T(_.ngettext("%1 stop", "%1 stops", stops_left), stops_left), { s = 12, col = INK.g4 })
                foot = BoardUI.spread(iw, left, right)
            end
            return padded(w, hh, {
                head(iw, _("Next stop"), runs({ { t = when, b = true } }, { s = 13 })),
                text(cs.stops[cs.next].title, { s = v[1], b = true, serif = true, w = iw, data = true }),
                flex(0),
                art,
                v[3] and flex(0) or false,
                foot,
            })
        end)
    end
    -- How long, which stop, and the line in miniature.
    for _i, with_name in ipairs({ true, false }) do
        table.insert(variants, function()
            return padded(w, hh, {
                head(iw, _("Next stop"), train()),
                flex(0),
                text(when, { s = 20, b = true, w = iw }),
                with_name and text(cs.stops[cs.next].title, { s = 12, b = true, serif = true, w = iw, data = true }) or false,
                flex(0),
                lineArt(iw, cs, { line = line, ahead = ahead }),
            })
        end)
    end
    table.insert(variants, function()
        return padded(w, hh, { head(iw, _("Next stop"), nil), flex(0), text(when, { s = 18, b = true, w = iw }), flex(0) })
    end)
    return pick(variants)
end

-- ================================================================ next badge
local RARITY = {
    common = function() return _("Common") end,
    rare = function() return _("Rare") end,
    epic = function() return _("Epic") end,
    legendary = function() return _("Legendary") end,
}

-- The medal: rarity shows in the rim (plain, double, beaded, sunburst). A
-- badge in progress wears a progress ring; an earned one hangs on ribbons.
-- rf: the rarity's hex shades on a colour screen, nil for grays.
local function medal(D0, b, earned, rf)
    local cx = D0 / 2
    local ring_w = earned and 0 or math.max(3, px(5))
    local gap = earned and 0 or px(4)
    local ribbon_h = earned and D0 * 0.3 or 0
    local R = (D0 - ribbon_h) / 2 - ring_w - gap - 1
    local cy = earned and (R + px(2) + (b.rarity == "legendary" and R * 0.1 or 0)) or D0 / 2
    local body = {}
    if earned then
        local function tail(sx)
            local x0, x1 = cx + sx * R * 0.18, cx + sx * R * 0.78
            local y0, y1 = cy + R * 0.3, cy + R + ribbon_h
            local wr = R * 0.34
            return '<path d="M' .. n(x0 - wr / 2) .. ' ' .. n(y0) .. ' L' .. n(x0 + wr / 2) .. ' ' .. n(y0) .. ' L' .. n(x1 + wr / 2) .. ' ' .. n(y1)
                .. ' L' .. n(x1) .. ' ' .. n(y1 - wr * 0.45) .. ' L' .. n(x1 - wr / 2) .. ' ' .. n(y1) .. ' Z" fill="' .. (rf and rf.ribbon or "#555555") .. '" stroke="#000000" stroke-width="'
                .. n(math.max(1, px(1.25))) .. '" stroke-linejoin="round"/>'
        end
        table.insert(body, tail(-1))
        table.insert(body, tail(1))
    else
        local pr = R + gap + ring_w / 2
        local p = (b.threshold and b.threshold > 0 and b.progress) and clamp(b.progress / b.threshold, 0, 0.9999) or 0
        table.insert(body, '<circle cx="' .. n(cx) .. '" cy="' .. n(cy) .. '" r="' .. n(pr) .. '" fill="none" stroke="' .. (rf and rf.tint or "#dddddd") .. '" stroke-width="' .. ring_w .. '"/>')
        if p > 0.005 then
            local a = p * 2 * math.pi
            table.insert(body, '<path d="M' .. n(cx) .. ' ' .. n(cy - pr) .. ' A' .. n(pr) .. ' ' .. n(pr) .. ' 0 ' .. (p > 0.5 and 1 or 0) .. ' 1 '
                .. n(cx + pr * math.sin(a)) .. ' ' .. n(cy - pr * math.cos(a)) .. '" fill="none" stroke="' .. (rf and rf.ink or "#000000") .. '" stroke-width="' .. ring_w .. '" stroke-linecap="round"/>')
        end
    end
    local face, ink = earned and (rf and rf.deep or "#000000") or "#ffffff", earned and "#ffffff" or "#000000"
    local sw = math.max(1, px(1.5))
    if b.rarity == "legendary" then
        local pts = {}
        for i = 0, 31 do
            local a, rr = i * math.pi / 16, (i % 2 == 1) and R * 0.9 or R * 1.06
            table.insert(pts, (i == 0 and "M" or "L") .. n(cx + rr * math.sin(a)) .. " " .. n(cy - rr * math.cos(a)))
        end
        table.insert(body, '<path d="' .. table.concat(pts) .. 'Z" fill="' .. (rf and rf.ink or "#000000") .. '"/>')
        table.insert(body, '<circle cx="' .. n(cx) .. '" cy="' .. n(cy) .. '" r="' .. n(R * 0.84) .. '" fill="' .. face .. '" stroke="' .. (earned and "#ffffff" or "#000000")
            .. '" stroke-width="' .. n(sw) .. '"/>')
    else
        table.insert(body, '<circle cx="' .. n(cx) .. '" cy="' .. n(cy) .. '" r="' .. n(R) .. '" fill="' .. face .. '" stroke="#000000" stroke-width="' .. n(sw) .. '"/>')
        if b.rarity == "rare" then
            table.insert(body, '<circle cx="' .. n(cx) .. '" cy="' .. n(cy) .. '" r="' .. n(R - px(3.5)) .. '" fill="none" stroke="' .. ink .. '" stroke-width="' .. n(math.max(1, px(1))) .. '"/>')
        elseif b.rarity == "epic" then
            for i = 0, 19 do
                local a, rr = i * 2 * math.pi / 20, R - px(4)
                table.insert(body, '<circle cx="' .. n(cx + rr * math.sin(a)) .. '" cy="' .. n(cy - rr * math.cos(a)) .. '" r="' .. n(math.max(1, px(1.15))) .. '" fill="' .. ink .. '"/>')
            end
        end
    end
    local isz = R * 0.95
    local markup = BoardIcons.markup(b.icon or "award") or BoardIcons.markup("award")
    if markup then
        table.insert(body, '<g transform="translate(' .. n(cx - isz / 2) .. ' ' .. n(cy - isz / 2) .. ') scale(' .. n(isz / 24) .. ')" fill="none" stroke="' .. ink
            .. '" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' .. markup .. '</g>')
    end
    return svg(round(D0), round(D0), table.concat(body))
end

function Decor.badge(ctx, w, hh)
    local data = ctx.d.badges or { missing = true }
    -- A badge's rarity colours, the same in every scheme.
    local function rarity(r)
        if not BoardColour.on(ctx) then return nil end
        local f = BoardColour.rarity(r)
        return { ink = BoardColour.hex(f.ink), deep = BoardColour.hex(f.deep), tint = BoardColour.hex(f.tint), ribbon = BoardColour.hex(BoardColour.rarity("ribbon").ink) }
    end
    local pad = px(12)
    local iw, ih = w - 2 * pad, hh - 2 * pad
    local function award() return icon("award", px(17), BoardColour.icon(ctx, 2.25)) end
    if data.missing then
        return emptyTile(w, hh, _("Next badge"), award, _("Badges show up here with a newer BookOrbit server."), _("Needs a newer server."))
    end
    if data.off then
        return emptyTile(w, hh, _("Next badge"), award, _("Achievements are turned off in your BookOrbit settings."), _("Achievements are off."))
    end
    if not data.next and not data.latest then
        return emptyTile(w, hh, _("Next badge"), award, _("Read a little and your first badge shows up here."), _("No badges yet."))
    end
    local tall = ih > px(150)
    -- A badge earned in the last day is celebrated for that day; the large
    -- tile keeps the next one in view and shows the new one underneath.
    local earned = not data.next or (data.fresh and not tall)
    local b = earned and data.latest or data.next
    local label = earned and _("New badge") or _("Next badge")
    local function progressRuns(s)
        if earned then return text(b.when or "", { s = s, col = INK.g4 }) end
        return runs({ { t = formatCount(b.progress or 0), b = true, col = INK.black }, { t = " " .. T(_("of %1"), formatCount(b.threshold or 0)) } }, { s = s, col = INK.g4 })
    end
    local variants = {}
    if tall and not earned then
        for _i, v in ipairs({ { true, true }, { true, false }, { false, true } }) do
            table.insert(variants, function()
                local with_last = v[1] and data.latest ~= nil
                local foot_h = with_last and (math.max(1, px(0.75)) + px(10) + px(36)) or 0
                local room = ih - lh1(13) - px(12) - foot_h - (foot_h > 0 and px(10) or 0)
                local dia = math.min(round(iw * 0.44), room)
                if dia < px(90) then return skip("medal too small") end
                local tw = iw - dia - px(14)
                if tw < px(120) then return skip("no room for words") end
                local items = {
                    head(iw, label, text(T(_("%1 of %2"), data.earned, data.total), { s = 12, col = INK.g4 })),
                    space(nil, px(12)),
                    hstack({ w = iw, h = room, gap = px(14) }, {
                        medal(dia, b, false, rarity(b.rarity)),
                        vstack({ w = tw }, {
                            v[2] and text((RARITY[b.rarity] or RARITY.common)(), { s = 12, col = INK.g4, w = tw }) or false,
                            text(b.name, { s = 16, b = true, w = tw, lines = 2, data = true }),
                            text(b.desc, { s = 13, col = INK.g4, w = tw, lines = 2, data = true }),
                            space(nil, px(8)),
                            progressRuns(13),
                            b.eta and text(b.eta, { s = 12, col = INK.g4, w = tw, lines = 2 }) or false,
                        }),
                    }),
                }
                if with_last then
                    local latest = data.latest
                    table.insert(items, flex(0))
                    table.insert(items, BoardUI.rect(iw, math.max(1, px(0.75)), INK.gc))
                    table.insert(items, space(nil, px(10)))
                    table.insert(items, hstack({ w = iw, h = px(36), gap = px(10) }, {
                        medal(px(36), latest, true, rarity(latest.rarity)),
                        vstack({ w = iw - px(46) }, {
                            text(latest.name, { s = 13, b = true, w = iw - px(46), data = true }),
                            text(latest.when or "", { s = 12, col = INK.g4, w = iw - px(46) }),
                        }),
                    }))
                end
                return padded(w, hh, items)
            end)
        end
    end
    if iw > ih * 1.4 then
        -- Name size, description lines, time to go, the label. A short tile
        -- (a phone's one-row widget) loses the label and the description
        -- before the medal loses its words.
        for _i, v in ipairs({ { 16, 2, true, true }, { 15, 1, true, true }, { 15, 1, false, true }, { 14, 1, false, true },
                { 14, 1, false, false }, { 14, 0, true, false }, { 14, 0, false, false } }) do
            table.insert(variants, function()
                local dia = math.min(ih, round(iw * 0.36))
                local tw = iw - dia - px(14)
                if tw < px(110) then return skip("no room for words") end
                -- The badge's name steps down to 12 before it is cut.
                local name_s = BoardUI.fitSize(b.name, { s = v[1], b = true }, tw, 12)
                return padded(w, hh, {
                    hstack({ w = iw, h = ih, gap = px(14) }, {
                        medal(dia, b, earned, rarity(b.rarity)),
                        vstack({ w = tw }, {
                            v[4] and text(label, { s = 12, col = INK.g4, w = tw }) or false,
                            text(b.name, { s = name_s, b = true, w = tw, data = true }),
                            v[2] > 0 and text(b.desc, { s = 12, col = INK.g4, w = tw, lines = v[2], data = true }) or false,
                            space(nil, px(4)),
                            progressRuns(12),
                            v[3] and not earned and b.eta and text(b.eta, { s = 12, col = INK.g4, w = tw }) or false,
                        }),
                    }),
                })
            end)
        end
    end
    for _i, with_name in ipairs({ true, false }) do
        table.insert(variants, function()
            local cap_h = with_name and (lh1(12) + lh1(12) + px(6)) or 0
            local dia = math.min(iw, ih - cap_h)
            if dia < px(44) and with_name then return skip("medal too small") end
            dia = math.max(1, dia)
            local name_s = BoardUI.fitSize(b.name, { s = 12, b = true }, iw, 10)
            return padded(w, hh, {
                flex(0),
                medal(dia, b, earned, rarity(b.rarity)),
                with_name and space(nil, px(6)) or false,
                with_name and text(b.name, { s = name_s, b = true, w = iw, align = "center", data = true }) or false,
                with_name and hstack({ w = iw }, { flex(0), progressRuns(12), flex(0) }) or false,
                flex(0),
            }, "center")
        end)
    end
    return pick(variants)
end

-- ================================================================ gathering dust
-- Dust over the cover and a cobweb across its top corner, each thread drawn
-- dark and then light so it shows on any cover, with a small spider let
-- down on a thread.
local function dustArt(cw, ch, seed)
    local r = rng(seed)
    local body = {}
    local count = round(cw * ch / (px(5.5) * px(5.5)))
    for _i = 1, count do
        local x, y = r() * cw, r() * ch
        local rr = math.max(0.6, px(0.35 + r() * 0.8))
        table.insert(body, '<circle cx="' .. n(x) .. '" cy="' .. n(y) .. '" r="' .. n(rr) .. '" fill="' .. (r() > 0.5 and "#999999" or "#dddddd") .. '"/>')
    end
    local L = math.min(cw, ch) * 0.62
    local ox, oy = cw, 0
    local angs = {}
    for i, t in ipairs({ 0.5, 0.78, 1.05, 1.32 }) do angs[i] = math.pi / 2 + t * math.pi / 2 * 0.95 end
    local threads = {}
    for _i, a in ipairs(angs) do
        table.insert(threads, "M" .. n(ox) .. " " .. n(oy) .. " L" .. n(ox + L * math.cos(a)) .. " " .. n(oy + L * math.sin(a)))
    end
    for _i, k in ipairs({ 0.3, 0.5, 0.7, 0.9 }) do
        local parts = {}
        for i, a in ipairs(angs) do
            local x, y = ox + L * k * math.cos(a), oy + L * k * math.sin(a)
            if i == 1 then
                table.insert(parts, "M" .. n(x) .. " " .. n(y))
            else
                local pa = angs[i - 1]
                local mx, my = ox + L * k * 0.86 * math.cos((a + pa) / 2), oy + L * k * 0.86 * math.sin((a + pa) / 2)
                table.insert(parts, " Q" .. n(mx) .. " " .. n(my) .. " " .. n(x) .. " " .. n(y))
            end
        end
        table.insert(threads, table.concat(parts))
    end
    local thread_w = math.max(1, px(0.8))
    for _i, t in ipairs(threads) do table.insert(body, '<path d="' .. t .. '" fill="none" stroke="#333333" stroke-width="' .. n(thread_w + px(1)) .. '" stroke-linecap="round"/>') end
    for _i, t in ipairs(threads) do table.insert(body, '<path d="' .. t .. '" fill="none" stroke="#ffffff" stroke-width="' .. n(thread_w) .. '" stroke-linecap="round"/>') end
    local sx, sy0 = ox + L * 0.62 * math.cos(angs[2]), oy + L * 0.62 * math.sin(angs[2])
    local sy = sy0 + ch * 0.2
    table.insert(body, '<line x1="' .. n(sx) .. '" y1="' .. n(sy0) .. '" x2="' .. n(sx) .. '" y2="' .. n(sy) .. '" stroke="#333333" stroke-width="' .. n(math.max(1, px(0.8))) .. '"/>')
    local br = px(3.2)
    local legs = {}
    for _i, sgn in ipairs({ -1, 1 }) do
        for _j, leg in ipairs({ { -0.6, 1.0, -0.9 }, { -0.2, 1.25, -0.2 }, { 0.2, 1.25, 0.5 }, { 0.6, 1.0, 1.2 } }) do
            local kx, ky = sx + sgn * br * 1.2, sy + br * leg[1]
            table.insert(legs, "M" .. n(sx) .. " " .. n(sy + br * leg[1] * 0.5) .. " L" .. n(kx + sgn * br * leg[2] * 0.4) .. " " .. n(ky - br * 0.6)
                .. " L" .. n(kx + sgn * br * leg[2]) .. " " .. n(ky + br * leg[3]) .. " ")
        end
    end
    local leg_path = table.concat(legs)
    table.insert(body, '<path d="' .. leg_path .. '" fill="none" stroke="#ffffff" stroke-width="' .. n(math.max(1, px(1)) + px(1.2)) .. '" stroke-linecap="round" stroke-linejoin="round"/>')
    table.insert(body, '<path d="' .. leg_path .. '" fill="none" stroke="#000000" stroke-width="' .. n(math.max(1, px(1))) .. '" stroke-linecap="round" stroke-linejoin="round"/>')
    table.insert(body, '<circle cx="' .. n(sx) .. '" cy="' .. n(sy + br * 0.35) .. '" r="' .. n(br) .. '" fill="#000000" stroke="#ffffff" stroke-width="' .. n(px(1)) .. '"/>')
    table.insert(body, '<circle cx="' .. n(sx) .. '" cy="' .. n(sy - br * 0.85) .. '" r="' .. n(br * 0.6) .. '" fill="#000000" stroke="#ffffff" stroke-width="' .. n(px(0.8)) .. '"/>')
    return svg(round(cw), round(ch), table.concat(body))
end

local function dustyCover(book, cw, ch, edge)
    local cov = BoardUI.cover(book, cw, ch, {
        path = book.cover_path,
        loading = book.cover_state == "loading",
        border = math.max(1, px(1)),
        border_col = edge or INK.gb,
        -- A film of dust: the cover a shade paler.
        lighten = 0.22,
    })
    return overlay(cw, ch, { { widget = cov }, { widget = dustArt(cw, ch, tonumber(book.id) or 1) } })
end

local function roundButton(name, action)
    local d0 = px(30)
    return BoardUI.hit(BoardUI.circle(d0, { border = math.max(1, px(1.5)), bg = INK.white }, icon(name, px(15), { sw = 2.25 })), action)
end

local function pill(label, icon_name, action)
    local h = px(30)
    local inner = hstack({ h = h, gap = px(6) }, { space(px(10) - px(6), 1), icon(icon_name, px(15), { sw = 2.5, col = "white" }), text(label, { s = 13, b = true, col = INK.white }), space(px(12) - px(6), 1) })
    return BoardUI.hit(BoardUI.box({ w = inner:getSize().w, h = h, radius = math.floor(h / 2), bg = INK.black }, inner), action)
end

function Decor.dust(ctx, w, hh)
    local dd = ctx.d.dust or { count = 0 }
    local pad = px(12)
    local iw, ih = w - 2 * pad, hh - 2 * pad
    local book = dd.book
    if not book then
        return emptyTile(w, hh, _("Gathering dust"), nil, _("Books you download and never open collect dust here."), _("Unopened books collect dust here."))
    end
    local since
    if (dd.months or 0) >= 1 then
        since = T(_.ngettext("Never opened in %1 month", "Never opened in %1 months", dd.months), dd.months)
    else
        since = T(_.ngettext("Never opened in %1 day", "Never opened in %1 days", math.max(1, dd.days or 0)), math.max(1, dd.days or 0))
    end
    local caption
    if (dd.months or 0) >= 1 then
        caption = T(_.ngettext("%1 month unopened", "%1 months unopened", dd.months), dd.months)
    else
        caption = T(_.ngettext("%1 day unopened", "%1 days unopened", math.max(1, dd.days or 0)), math.max(1, dd.days or 0))
    end
    local function buttons()
        return hstack({ gap = px(8) }, {
            pill(_("Open"), "book-open", { kind = "book", book = book, resume = true }),
            roundButton("trash", { kind = "dust-remove", book = book }),
            roundButton("arrow-right", { kind = "dust-next" }),
        })
    end
    local variants = {}
    if ih > px(150) then
        for _i, with_foot in ipairs({ true, false }) do
            table.insert(variants, function()
                local foot_h = with_foot and lh1(12) + px(8) or 0
                local ch = math.min(ih - lh1(13) - px(10) - px(30) - px(12) - foot_h, round(iw * 0.5 * 1.5))
                local cw = round(ch * 2 / 3)
                if ch < px(110) then return skip("cover too small") end
                local tw = iw - cw - px(14)
                return padded(w, hh, {
                    head(iw, _("Gathering dust"), text(T(_.ngettext("%1 book", "%1 books", dd.count), dd.count), { s = 12, col = INK.g4 })),
                    space(nil, px(10)),
                    hstack({ w = iw, gap = px(14), valign = "top" }, {
                        dustyCover(book, cw, ch, BoardColour.coverEdge(ctx, INK.gb)),
                        vstack({ w = tw }, {
                            text(book.title or "", { s = 16, b = true, serif = true, lines = 3, w = tw, data = true }),
                            text(book.authors and book.authors[1] or "", { s = 13, col = INK.g4, w = tw, data = true }),
                            space(nil, px(10)),
                            text(since, { s = 12, col = INK.g4, lines = 3, w = tw }),
                        }),
                    }),
                    flex(0),
                    buttons(),
                    with_foot and space(nil, px(8)) or false,
                    with_foot and text(T(_.ngettext("%1 more never opened, %2 MB in all", "%1 more never opened, %2 MB in all", dd.count - 1), dd.count - 1, dd.total_mb or 0),
                        { s = 12, col = INK.g4, w = iw }) or false,
                })
            end)
        end
    end
    if iw > ih * 1.4 then
        -- Title lines, the since line, the buttons, the label; the label goes
        -- before the since line does.
        for _i, v in ipairs({ { 2, true, true, true }, { 1, true, true, true }, { 1, true, true, false }, { 1, false, true, true }, { 2, true, false, true }, { 1, true, false, true } }) do
            table.insert(variants, function()
                local ch, cw = ih, round(ih * 2 / 3)
                local tw = iw - cw - px(12)
                if tw < px(150) then return skip("no room for words") end
                return padded(w, hh, {
                    hstack({ w = iw, h = ih, gap = px(12) }, {
                        dustyCover(book, cw, ch, BoardColour.coverEdge(ctx, INK.gb)),
                        vstack({ w = tw, h = ih }, {
                            v[4] and text(_("Gathering dust"), { s = 12, col = INK.g4, w = tw }) or false,
                            text(book.title or "", { s = 14, b = true, serif = true, lines = v[1], w = tw, data = true }),
                            v[2] and text(since, { s = 12, col = INK.g4, lines = 2, w = tw }) or false,
                            flex(0),
                            v[3] and buttons() or false,
                        }),
                    }),
                })
            end)
        end
    end
    for _i, with_caption in ipairs({ true, false }) do
        table.insert(variants, function()
            local cap_h = with_caption and lh1(12) + px(6) or 0
            local ch = math.min(ih - cap_h, round(iw * 1.5))
            local cw = round(ch * 2 / 3)
            if ch < px(50) and with_caption then return skip("cover too small") end
            ch, cw = math.max(1, ch), math.max(1, cw)
            return padded(w, hh, {
                dustyCover(book, cw, ch, BoardColour.coverEdge(ctx, INK.gb)),
                with_caption and space(nil, px(6)) or false,
                with_caption and text(caption, { s = 12, b = true, w = iw, align = "center" }) or false,
            }, "center")
        end)
    end
    return pick(variants)
end

-- ------------------------------------------------------------- install
-- What a widget's layout choice depends on beyond its size, so the board's
-- memory of which layout fitted is not reused for other data.
Decor.SIG = {
    buddy = function(ctx) return Decor.buddyPose(ctx.d) .. ":" .. tostring(ctx.d.today_min) .. ":" .. tostring(ctx.d.streak and ctx.d.streak.current) end,
    chapters = function(ctx)
        local cs = ctx.d.chapters
        return cs and (tostring(cs.book.id) .. ":" .. cs.cur .. ":" .. tostring(cs.minutes(cs.next))) or "-"
    end,
    badge = function(ctx)
        local b = ctx.d.badges or {}
        return tostring(b.next and b.next.key) .. ":" .. tostring(b.next and b.next.progress) .. ":" .. tostring(b.latest and b.latest.key) .. ":" .. tostring(b.fresh)
    end,
    dust = function(ctx)
        local dd = ctx.d.dust or {}
        return tostring(dd.book and dd.book.id) .. ":" .. tostring(dd.days) .. ":" .. tostring(dd.count)
    end,
    glyph = function(ctx) return tostring(ctx.d.glyph and ctx.d.glyph.cp) end,
    moon = function(ctx) return tostring(ctx.d.moon and ctx.d.moon.phase) end,
    odometer = function(ctx)
        local p = ctx.d.pages or {}
        return tostring(p.total) .. ":" .. tostring(p.today) .. ":" .. tostring(p.since)
    end,
    rings = function(ctx)
        local months = ctx.d.months or {}
        return tostring(months[1] and months[1].month) .. ":" .. tostring(#months)
    end,
}

Decor.TYPES = { "buddy", "analog", "moon", "odometer", "glyph", "rings", "chapters", "badge", "dust" }

function Decor.install(W, helpers)
    head, formatCount = helpers.head, helpers.formatCount
    for _i, name in ipairs(Decor.TYPES) do W[name] = Decor[name] end
end

return Decor
