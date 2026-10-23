--[[--
The list pages composed from the list kit: what each page holds and how many
entries fit it. The catalog asks `capacity` before it fetches, so a server
page is exactly one screen.
]]

local T = require("ffi/util").template
local _ = require("gettext")

local BoardMetrics = require("bookorbit_board_metrics")
local BoardUI = require("bookorbit_board_ui")
local ListData = require("bookorbit_list_data")
local ListView = require("bookorbit_list_view")
local MenuUI = require("bookorbit_menu_ui")

local INK = BoardMetrics.INK
local px, lh1, lh = BoardMetrics.px, BoardMetrics.lh1, BoardMetrics.lh
local text, runs, vstack, hstack, flex, space, icon = BoardUI.text, BoardUI.runs, BoardUI.vstack, BoardUI.hstack, BoardUI.flex, BoardUI.space, BoardUI.icon
local region = ListView.region

local Pages = {}

local function wOf(w) return w:getSize().w end
local function hOf(w) return w:getSize().h end

-- ------------------------------------------------------------ geometry
-- How a list page is laid out on this screen. o: toolbar, offline, rail,
-- view ("list"/"grid"), kind, min_row, gutter.
function Pages.geometry(screen_w, screen_h, o)
    local f = ListView.frame(screen_w, screen_h, { toolbar = o.toolbar ~= false, offline = o.offline })
    if o.view == "grid" then
        local gw = f.w - (o.rail and ListView.RAIL_W() or 0)
        local g = ListView.gridGeom(gw, f.content_h - px(6), { cols = ListView.gridCols(gw), aspect = o.kind == "authors" and 1 or 1.5 })
        return { f = f, g = g, gw = gw, per = g.per }
    end
    local total = f.w - (o.rail and ListView.RAIL_W() or 0)
    local cols = o.cols or ListView.indexColumns(total)
    local rows = ListData.fillRows(f.content_h, px(o.min_row or ListView.ROW))
    return { f = f, cols = cols, n = rows.n, rh = rows.rh, per = rows.n * cols }
end

-- Entries per screen for a list (the server page size).
function Pages.capacity(screen_w, screen_h, o)
    return Pages.geometry(screen_w, screen_h, o).per
end

-- ------------------------------------------------------------- toolbars
function Pages.toolbar(m)
    return m.toolbar and { buttons = m.toolbar, view = m.view_toggle and m.view or nil } or nil
end

-- --------------------------------------------------------------- lists
-- A paged list of books, authors or series as rows or a grid. m: kind, view,
-- entries, rail, letters, present, carried, groupOf, gutter, row_kind,
-- select, selected(book), action(entry, i).
function Pages.listBody(m, f)
    if #m.entries == 0 and m.empty then
        return ListView.empty(f.w, f.content_h, m.empty)
    end
    if m.view == "grid" then
        local geo = Pages.geometry(m.screen_w, m.screen_h, { toolbar = m.toolbar ~= nil, offline = m.offline ~= nil, rail = m.rail, view = "grid", kind = m.kind })
        local g = geo.g
        local build
        if m.kind == "authors" then build = function(e) return ListView.authorCell(g, e) end
        elseif m.kind == "series" then build = function(e) return ListView.seriesCell(g, e) end
        else build = function(b) return ListView.bookCell(g, b, { select = m.select, selected = m.selected and m.selected(b) }) end end
        local grid = ListView.cellsGrid(geo.gw, g, m.entries, build, m.action)
        local body = vstack({ w = geo.gw }, { space(nil, px(6)), grid })
        if m.rail then return ListView.withRail(f.w, f.content_h, body, m.letters, m.present) end
        return body
    end
    local geo = Pages.geometry(m.screen_w, m.screen_h, { toolbar = m.toolbar ~= nil, offline = m.offline ~= nil, rail = m.rail, view = "list", min_row = m.min_row })
    local row
    if m.kind == "authors" then row = function(w, hh, e) return ListView.authorRow(w, hh, e) end
    elseif m.kind == "series" then row = function(w, hh, e) return ListView.seriesRow(w, hh, e) end
    else row = function(w, hh, b) return ListView.bookRow(w, hh, b, { select = m.select, selected = m.selected and m.selected(b), context = m.row_context }) end end
    return ListView.indexList(f.w, f.content_h, {
        entries = m.entries, rows_per_col = geo.n, row_h = geo.rh, cols = geo.cols, gutter = m.gutter or 34,
        rail = m.rail, groupOf = m.groupOf, carried = m.carried, row = row, action = m.action,
        present = m.present, letters = m.letters, first_only = m.first_only,
    })
end

-- --------------------------------------------------------------- shelves
-- Libraries, collections and scopes on one page; wide screens set the
-- sections in two columns.
function Pages.shelvesBody(m, f)
    local groups = {
        { _("Libraries"), "library", m.libraries or {} },
        { _("Collections"), "folder-open", m.collections or {} },
        { _("SmartScopes"), "aperture", m.scopes or {} },
    }
    local wide = ListView.screenW() >= 760
    local gap_s = px(14)
    local columns = wide and { { groups[1] }, { groups[2], groups[3] } } or { groups }
    local col_w = wide and math.floor((f.w - px(28)) / 2) or f.w
    local rh = px(72)
    for _i, cg in ipairs(columns) do
        local heads, rows = #cg, 0
        for _j, g in ipairs(cg) do rows = rows + #g[3] end
        rh = math.min(rh, math.floor((f.content_h - heads * px(36) - (heads - 1) * gap_s) / math.max(1, rows)))
    end
    local col_els = {}
    for _i, cg in ipairs(columns) do
        local kids = {}
        for gi, g in ipairs(cg) do
            if gi > 1 then table.insert(kids, space(nil, gap_s)) end
            table.insert(kids, ListView.sectionHead(col_w, { icon = g[2], label = g[1], count = #g[3] }))
            for i, s in ipairs(g[3]) do
                local inner = vstack({ w = col_w, h = rh }, { i > 1 and ListView.rule(col_w) or false, flex(0), ListView.shelfRow(col_w, rh, s), flex(0) })
                table.insert(kids, region(inner, { kind = "open-shelf", shelf = s }, "shelf-" .. g[1] .. "-" .. i, "shelf-" .. s.section .. "-" .. tostring(s.id)))
            end
        end
        table.insert(col_els, vstack({ w = col_w }, kids))
    end
    return hstack({ w = f.w, valign = "top", gap = px(28) }, col_els)
end

-- ------------------------------------------------------------ a series
-- Where a series page's books go: page 1 under the summary, later pages
-- with the list alone (landscape keeps the summary column on every page).
-- A grid shrinks its covers to keep a series on one page only down to three
-- quarters of the All books size; past that it pages at full size.
function Pages.seriesLayout(screen_w, screen_h, view, n, offline)
    local f = ListView.frame(screen_w, screen_h, { toolbar = false, offline = offline })
    local side = BoardMetrics.get().w > BoardMetrics.get().h
    local side_w = side and math.floor(f.w * 0.38 + 0.5) or f.w
    local list_w = side and (f.w - side_w - px(28)) or f.w
    local hero_h = side and f.content_h or math.max(px(156), math.min(px(200), math.floor(f.content_h * 0.27 + 0.5)))
    local head = px(44) + px(8)
    local h1 = (side and f.content_h or (f.content_h - hero_h - px(16))) - head
    local hn = side and h1 or (f.content_h - head)
    local cap1, capn, g1, gn
    if view == "grid" then
        local std = ListView.stdGeom(screen_w, screen_h)
        local cols = ListView.gridCols(list_w)
        local function cap(h) return cols * math.max(1, math.floor((h + px(18)) / (std.cover_h + ListView.CAP() + px(18)))) end
        local fit = ListView.fitStd(screen_w, screen_h, list_w, h1, n)
        if fit.cover_h >= std.cover_h * 0.75 then
            return { pages = 1, first = n, rest = n, list_w = list_w, list_h1 = h1, list_hn = hn, g1 = fit, single = true }
        end
        cap1, capn = cap(h1), cap(hn)
        g1 = ListView.fitStd(screen_w, screen_h, list_w, nil, 1)
        gn = g1
    else
        cap1 = ListData.fillRows(h1, px(56)).n
        capn = ListData.fillRows(hn, px(56)).n
    end
    local pages = n <= cap1 and 1 or (1 + math.ceil((n - cap1) / capn))
    return { pages = pages, first = cap1, rest = capn, list_w = list_w, list_h1 = h1, list_hn = hn, g1 = g1, gn = gn }
end

-- The stack, how far through it you are as a ruler of its books, Up next and
-- Continue; then its books in reading order, as rows or covers. Landscape
-- puts the summary beside the books.
function Pages.seriesBody(m, f)
    local all_books = m.entries
    local layout = Pages.seriesLayout(m.screen_w, m.screen_h, m.view, #all_books, m.offline ~= nil)
    local page = math.max(1, math.min(layout.pages, m.local_page or 1))
    local books = {}
    local start = page == 1 and 1 or (layout.first + (page - 2) * layout.rest + 1)
    local stop = page == 1 and layout.first or (start + layout.rest - 1)
    for i = start, math.min(#all_books, stop) do table.insert(books, all_books[i]) end
    local next_book = m.next_book
    local side = BoardMetrics.get().w > BoardMetrics.get().h
    local side_w = side and math.floor(f.w * 0.38 + 0.5) or f.w
    local list_w = side and (f.w - side_w - px(28)) or f.w
    local hero_h = side and f.content_h or math.max(px(156), math.min(px(200), math.floor(f.content_h * 0.27 + 0.5)))
    local deck_h = side and math.min(px(220), math.floor(f.content_h * 0.42 + 0.5)) or hero_h
    local deck_w = math.floor(deck_h * 0.74 + 0.5)
    local tw = side and side_w or (f.w - deck_w - px(20))
    local states = m.states or {}
    local n = math.max(1, #states)
    local gap = px(4)
    local seg_w = math.floor((tw - (n - 1) * gap) / n)
    local cur = m.current_index
    local segs, nums = {}, {}
    for i, s in ipairs(states) do
        local h = px(i == cur and 10 or 8)
        local col = s == "finished" and INK.black or s == "reading" and INK.g8 or INK.gd
        local seg = BoardUI.rect(seg_w, h, col, px(5))
        if i == cur then
            local r1, r2 = math.max(1, px(1.5)), math.max(2, px(3))
            seg = BoardUI.overlay(seg_w + 2 * r2, h + 2 * r2, {
                { widget = BoardUI.rect(seg_w + 2 * r2, h + 2 * r2, INK.black, px(5) + r2) },
                { widget = BoardUI.rect(seg_w + 2 * r1, h + 2 * r1, INK.white, px(5) + r1), x = r2 - r1, y = r2 - r1 },
                { widget = BoardUI.rect(seg_w, h, col, px(5)), x = r2, y = r2 },
            })
        end
        table.insert(segs, seg)
        if seg_w >= px(16) then
            table.insert(nums, text(tostring(m.indexes and m.indexes[i] or i), { s = 11, b = i == cur, col = i == cur and INK.black or INK.g4, w = seg_w, align = "center" }))
        end
    end
    local seg_row = {}
    for i, s in ipairs(segs) do
        local sw = wOf(s)
        local pad = math.floor((sw - seg_w) / 2)
        table.insert(seg_row, BoardUI.overlay(seg_w, px(10), { { widget = s, x = -pad, y = math.floor((px(10) - hOf(s)) / 2) } }))
    end
    local ruler = vstack({ w = tw }, {
        hstack({ gap = gap, h = px(10) }, seg_row),
        #nums > 0 and space(nil, px(4)) or false,
        #nums > 0 and hstack({ gap = gap }, nums) or false,
    })
    local p = m.progress
    local summary = {
        runs({ { t = T(_("%1 of %2 read"), p.finished, p.count), b = true, col = INK.black, s = 19 }, { t = "   " .. T(_("%1 in progress"), p.reading) } }, { s = 13, col = INK.g4, w = tw }),
        space(nil, px(8)), ruler, space(nil, px(8) + px(4) + px(8)),
    }
    if next_book then
        table.insert(summary, text(T(_("Up next · Book %1"), tostring(next_book.seriesIndex or "")), { s = 12, b = true, col = INK.g4, w = tw }))
        table.insert(summary, space(nil, px(8)))
        table.insert(summary, text(next_book.title or "", { s = 16, b = true, lines = 2, w = tw, data = true }))
        table.insert(summary, space(nil, px(8)))
        local cont = region(ListView.pill(ListData.stateOf(next_book) == "reading" and _("Continue") or T(_("Start book %1"), tostring(next_book.seriesIndex or "")), { icon = "book-open", h = 40, s = 14, pad_x = 18 }),
            { kind = "open-book", book = next_book }, "series-hero", "continue")
        local right = nil
        if ListData.stateOf(next_book) == "reading" then
            local left = m.next_minutes and (" · " .. T(_("%1 left"), ListData.duration(m.next_minutes))) or (" · " .. (require("bookorbit_board_data").relativeDay(next_book.lastReadAt) or ""))
            right = runs({ { t = ListData.pctLabel(next_book) or "0%", b = true, col = INK.black }, { t = left } }, { s = 13, col = INK.g4, data = true })
        end
        table.insert(summary, hstack({ gap = px(12) }, { cont, right or false }))
    end
    local summary_col = vstack({ w = tw }, summary)
    local deck = region(hstack({ w = side and side_w or deck_w, h = deck_h, valign = "bottom" }, { side and space(1, 1) or flex(0), ListView.stackFit(m.deck or books, deck_w, deck_h), flex(0) }),
        next_book and { kind = "open-book", book = next_book } or { kind = "noop" }, "series-hero", "deck")
    local hero
    if side then
        hero = vstack({ w = side_w, h = hero_h }, { space(nil, px(6)), deck, space(nil, px(18)), summary_col, flex(0) })
    else
        hero = hstack({ w = f.w, h = hero_h, gap = px(20) }, { deck, vstack({ w = tw, h = hero_h }, { flex(0), summary_col, flex(0) }) })
    end
    local head = ListView.sectionHead(list_w, { icon = "layers-2", label = m.order_label or _("Reading order"), count = #all_books, right = ListView.viewToggle(m.view, "series-head") })
    local list_h = page == 1 and layout.list_h1 or layout.list_hn
    local content
    if m.view == "grid" then
        local g = layout.single and layout.g1 or ListView.fitStd(m.screen_w, m.screen_h, list_w, nil, 1)
        local short = ListData.distinctTitles(books)
        content = ListView.cellsGrid(list_w, g, books, function(b)
            return ListView.bookCell(g, b, {
                title = function(x) return tostring(x.seriesIndex or "") .. ". " .. (short[x.id] or x.title or "") end,
                meta = function(x)
                    local st = ListData.stateOf(x)
                    if st == "reading" then
                        local ml = m.minutes_left and m.minutes_left(x)
                        local day = not ml and require("bookorbit_board_data").relativeDay(x.lastReadAt)
                        return { { t = ListData.pctLabel(x) or "0%", b = true }, { t = ml and T(_(" · %1 left"), ListData.shortDuration(ml)) or day and (" · " .. day) or "" } }
                    elseif st == "finished" then return { { t = _("Read"), b = true } } end
                    return { { t = _("Not started") } }
                end,
            })
        end, m.action)
    else
        local rows = ListData.fillRows(list_h, px(56))
        content = ListView.indexList(list_w, list_h, {
            entries = books, rows_per_col = rows.n, row_h = rows.rh, cols = 1, gutter = 34, rail = false,
            groupOf = function(b) return "#" .. tostring(b.seriesIndex or "") end, group_rules = false,
            row = function(w, hh, b) return ListView.bookRow(w, hh, b, { context = "series" }) end, action = m.action,
        })
    end
    local list = vstack({ w = list_w }, { head, space(nil, px(8)), content })
    if side then return hstack({ w = f.w, valign = "top", gap = px(28) }, { hero, list }) end
    if page > 1 then return vstack({ w = f.w }, { list }) end
    return vstack({ w = f.w }, { space(nil, px(4)), hero, space(nil, px(12)), list })
end

-- ------------------------------------------------------------ an author
-- Who they are (photo, what you have read, the bio when the library has
-- one, Download all), then their books grouped by series, as covers or rows.
-- Landscape sets the card in a column on the left. Books that do not fit go
-- on further pages, a group split across pages repeating its head; a grid
-- shrinks its covers to stay on one page only down to three quarters size.
local function authorGeometry(m, f)
    local side = BoardMetrics.get().w > BoardMetrics.get().h
    local gap_s = px(28)
    local card_w = side and math.floor(f.w * 0.36 + 0.5) or f.w
    local book_w = side and (f.w - card_w - gap_s) or f.w
    local pad = px(14)
    local ph = px(side and 88 or 64)
    local top_h = side and math.max(ph, lh1(15) + 3 * lh1(13) + px(8)) or math.max(ph, lh1(15) + lh1(13) + px(4))
    local card_fixed = 2 * pad + top_h + px(12) + px(34)
    return { side = side, gap_s = gap_s, card_w = card_w, book_w = book_w, pad = pad, ph = ph, top_h = top_h, card_fixed = card_fixed }
end

function Pages.authorLayout(m, f)
    local geo = authorGeometry(m, f)
    local head_h = px(36) + px(10)
    local avail1 = geo.side and f.content_h or (f.content_h - geo.card_fixed - px(16))
    local availn = f.content_h
    local groups = m.groups
    local blocks = {}
    if m.view == "list" then
        local function two(n) return geo.book_w / BoardMetrics.get().dp >= 760 and n > 3 end
        local row_h = px(ListView.ROW)
        local pages, cur, used = {}, { blocks = {} }, 0
        local avail = avail1
        for _gi, gr in ipairs(groups) do
            local per_row = two(#gr.books) and 2 or 1
            local i = 1
            while i <= #gr.books do
                local gap = #cur.blocks > 0 and px(10) or 0
                local room_rows = math.floor((avail - used - gap - head_h) / row_h)
                if room_rows < 1 then
                    table.insert(pages, cur); cur = { blocks = {} }; used = 0; avail = availn
                    gap = 0
                    room_rows = math.floor((avail - head_h) / row_h)
                end
                local take = math.min(#gr.books - i + 1, math.max(1, room_rows) * per_row)
                local part = {}
                for k = i, i + take - 1 do table.insert(part, gr.books[k]) end
                table.insert(cur.blocks, { group = gr, books = part })
                used = used + gap + head_h + math.ceil(take / per_row) * row_h
                i = i + take
            end
        end
        table.insert(pages, cur)
        -- Rows stretch a little (up to 62dp from 56dp) only on a single page.
        local list_row_h = row_h
        return { geo = geo, pages = pages, row_h = list_row_h, avail1 = avail1, head_h = head_h }
    end
    local std = ListView.fitStd(m.screen_w, m.screen_h, geo.book_w, nil, 1)
    local function shelvesH(g)
        local total = 0
        for gi, gr in ipairs(groups) do
            local rows = math.ceil(#gr.books / g.cols)
            total = total + head_h + rows * (g.cover_h + ListView.CAP()) + (rows - 1) * g.gy + (gi > 1 and px(10) or 0)
        end
        return total
    end
    local g = std
    if shelvesH(std) > avail1 then
        local rows_all = 0
        for _i, gr in ipairs(groups) do rows_all = rows_all + math.ceil(#gr.books / std.cols) end
        local ch = math.floor((avail1 - #groups * head_h - (#groups - 1) * px(10) - (rows_all - #groups) * std.gy) / rows_all - ListView.CAP())
        if ch >= std.cover_h * 0.75 then
            g = {}
            for k, v in pairs(std) do g[k] = v end
            g.cover_h, g.cover_w = ch, math.floor(ch / 1.5 + 0.5)
        end
    end
    local cell_h = g.cover_h + ListView.CAP()
    local pages, cur, used = {}, { blocks = {} }, 0
    local avail = avail1
    for _gi, gr in ipairs(groups) do
        local i = 1
        while i <= #gr.books do
            local gap = #cur.blocks > 0 and px(10) or 0
            local room_rows = math.floor((avail - used - gap - head_h + g.gy) / (cell_h + g.gy))
            if room_rows < 1 then
                table.insert(pages, cur); cur = { blocks = {} }; used = 0; avail = availn
                gap = 0
                room_rows = math.max(1, math.floor((avail - head_h + g.gy) / (cell_h + g.gy)))
            end
            local take = math.min(#gr.books - i + 1, room_rows * g.cols)
            local part = {}
            for k = i, i + take - 1 do table.insert(part, gr.books[k]) end
            table.insert(cur.blocks, { group = gr, books = part })
            local rows = math.ceil(take / g.cols)
            used = used + gap + head_h + rows * cell_h + (rows - 1) * g.gy
            i = i + take
        end
    end
    table.insert(pages, cur)
    return { geo = geo, pages = pages, g = g, avail1 = avail1, head_h = head_h }
end

-- The most bio lines (up to max) whose text box fits in room.
local function bioLines(room, max)
    local n = math.max(0, math.min(max, math.floor(room / lh(13))))
    while n > 0 and BoardMetrics.textBoxHeight(n, 13) > room do n = n - 1 end
    return n
end

function Pages.authorBody(m, f)
    local a = m.author
    local layout = Pages.authorLayout(m, f)
    local geo = layout.geo
    local side = geo.side
    local page = math.max(1, math.min(#layout.pages, m.local_page or 1))
    local blocks = layout.pages[page].blocks
    local card_w, book_w, pad = geo.card_w, geo.book_w, geo.pad
    local iw = card_w - 2 * pad
    local ph = geo.ph
    local pic = ListView.photo(a, ph)
    local head_h = layout.head_h
    local count = a.count or 0
    local facts = { ListData.bookCount(count) }
    if (a.finished or 0) > 0 then table.insert(facts, T(_("%1 read"), a.finished)) end
    if (a.reading or 0) > 0 then table.insert(facts, T(_("%1 reading"), a.reading)) end
    local on_dev = (a.on_device or 0) > 0 and T(_("%1 on this device"), a.on_device) or _("None on this device yet")
    local function topRow(w)
        local tw = w - (pic and (ph + px(14)) or 0)
        local col
        if side then
            col = vstack({ w = tw }, {
                text(ListData.bookCount(count), { s = 15, b = true, w = tw }),
                #facts > 1 and text(table.concat({ unpack(facts, 2) }, " · "), { s = 13, b = true, w = tw }) or false,
                space(nil, px(4)),
                text(on_dev, { s = 13, col = INK.g4, w = tw }),
                a.birth_year and text(T(_("Born %1"), a.birth_year), { s = 13, col = INK.g4, w = tw }) or false,
            })
        else
            local sub = on_dev .. (a.birth_year and (" · " .. T(_("born %1"), a.birth_year)) or "")
            col = vstack({ w = tw }, { text(table.concat(facts, " · "), { s = 15, b = true, w = tw }), space(nil, px(4)), text(sub, { s = 13, col = INK.g4, w = tw }) })
        end
        return hstack({ w = w, gap = px(14) }, { pic or false, col })
    end
    local function buttons(with_bio)
        local dl = region(ListView.pill(T(_("Download all %1"), count), { kind = "outline", icon = "download", h = 34, s = 13, pad_x = 14 }), { kind = "download-all" }, "author-card", "download-all")
        local bio = with_bio and region(ListView.pill(_("Full bio"), { kind = "ghost", h = 34, s = 13, pad_x = 10 }), { kind = "full-bio" }, "author-card", "full-bio") or nil
        return hstack({ gap = px(8) }, { dl, bio or false })
    end
    -- What the page's books take, so the bio can have the rest.
    local function blocksH()
        local total = 0
        for bi, blk in ipairs(blocks) do
            local n = #blk.books
            if m.view == "list" then
                local per_row = (book_w / BoardMetrics.get().dp >= 760 and #blk.group.books > 3) and 2 or 1
                total = total + head_h + math.ceil(n / per_row) * px(ListView.ROW)
            else
                local rows = math.ceil(n / layout.g.cols)
                total = total + head_h + rows * (layout.g.cover_h + ListView.CAP()) + (rows - 1) * layout.g.gy
            end
            if bi > 1 then total = total + px(10) end
        end
        return total
    end
    local card, card_h
    if page == 1 or side then
        if side then
            card_h = f.content_h
            local room = card_h - 2 * pad - 2 * MenuUI.line() - geo.top_h - px(16) - px(34) - px(16)
            local desc_lines = a.description and bioLines(room, 18) or 0
            local bio = desc_lines >= 2 and text(a.description, { s = 13, serif = true, col = INK.g2, lines = desc_lines, w = iw, data = true }) or nil
            card = MenuUI.card(card_w, { vstack({ w = iw, h = card_h - 2 * pad - 2 * MenuUI.line() }, { topRow(iw), bio and space(nil, px(16)) or false, bio or false, flex(px(16)), buttons(bio ~= nil) }) }, { pad = 14, vpad = 14 })
        else
            local room = f.content_h - geo.card_fixed - px(16) - blocksH() - px(12)
            local desc_lines = a.description and bioLines(room, 8) or 0
            if desc_lines < 2 then desc_lines = 0 end
            card_h = geo.card_fixed + (desc_lines > 0 and (px(12) + BoardMetrics.textBoxHeight(desc_lines, 13)) or 0)
            local bio = desc_lines > 0 and text(a.description, { s = 13, serif = true, col = INK.g2, lines = desc_lines, w = iw, data = true }) or nil
            card = MenuUI.card(card_w, { vstack({ w = iw, h = card_h - 2 * pad - 2 * MenuUI.line() }, { flex(0), topRow(iw), bio and space(nil, px(12)) or false, bio or false, space(nil, px(12)), buttons(bio ~= nil), flex(0) }) }, { pad = 14, vpad = 14 })
        end
    end
    local kids = {}
    for bi, blk in ipairs(blocks) do
        local gr = blk.group
        if bi > 1 then table.insert(kids, space(nil, px(10))) end
        table.insert(kids, ListView.sectionHead(book_w, { icon = gr.standalone and "book" or "layers-2", label = gr.key, count = #gr.books, right = bi == 1 and ListView.viewToggle(m.view, "author-head") or nil }))
        table.insert(kids, space(nil, px(10)))
        if m.view == "list" then
            local two = book_w / BoardMetrics.get().dp >= 760 and #gr.books > 3
            local cw2 = two and math.floor((book_w - px(28)) / 2) or book_w
            local rh = px(ListView.ROW)
            local function rowsOf(part, offset)
                local out = {}
                for k, b in ipairs(part) do
                    local inner = vstack({ w = cw2, h = rh }, { k > 1 and ListView.rule(cw2) or false, flex(0), ListView.bookRow(cw2, rh, b, { context = "author" }), flex(0) })
                    table.insert(out, region(inner, m.action(b), "author-" .. bi .. "-" .. (offset + k), "book-" .. tostring(b.id)))
                end
                return out
            end
            if two then
                local half = math.ceil(#blk.books / 2)
                table.insert(kids, hstack({ w = book_w, valign = "top", gap = px(28) }, { vstack({ w = cw2 }, rowsOf({ unpack(blk.books, 1, half) }, 0)), vstack({ w = cw2 }, rowsOf({ unpack(blk.books, half + 1) }, half)) }))
            else
                table.insert(kids, vstack({ w = book_w }, rowsOf(blk.books, 0)))
            end
        else
            local short = ListData.distinctTitles(gr.books)
            local g = layout.g
            table.insert(kids, ListView.cellsGrid(book_w, g, blk.books, function(b)
                return ListView.bookCell(g, b, {
                    title = function(x) return (x.seriesIndex and not gr.standalone) and (tostring(x.seriesIndex) .. ". " .. (short[x.id] or x.title or "")) or (x.title or "") end,
                    author = false,
                })
            end, m.action))
        end
    end
    local books = vstack({ w = book_w }, kids)
    if side then return hstack({ w = f.w, valign = "top", gap = geo.gap_s }, { card, books }) end
    if card then return vstack({ w = f.w }, { card, space(nil, px(16)), books }) end
    return vstack({ w = f.w }, { books })
end

-- -------------------------------------------------------------- search
-- An author is their name over their covers; a series its books in order;
-- books are a cover grid. Landscape sets authors and series side by side.
local function blockCover(b, cw, ch)
    return ListView.markedCover(b, cw, ch)
end

local function authorBlock(a, cw, lh_block)
    local ch = math.floor(cw * 1.5 + 0.5)
    local gap = px(6)
    local books = {}
    for i = 1, math.min(4, #(a.previewBooks or {})) do books[i] = a.previewBooks[i] end
    local photo_w = 0
    local photo_path = a.photo_path
    if photo_path then photo_w = math.floor(ch * 0.72 + 0.5) end
    local covers_w = (photo_w > 0 and (photo_w + gap) or 0) + #books * cw + math.max(0, #books - 1) * gap
    local count = tonumber(a.count) or 0
    local more = count > #books and (" · +" .. (count - #books)) or ""
    local meta = (tonumber(a.readingCount) or 0) > 0 and { { t = ListData.bookCount(count) }, { t = " · " .. T(_("%1 reading"), a.readingCount), b = true, col = INK.black } } or { { t = ListData.bookCount(count) .. more } }
    local name_w = ListView.textWidth(a.title or "", { s = 13, b = true }) + 1
    local meta_w = ListView.runsWidth(meta, { s = 11 }) + 1
    local w = math.max(covers_w, math.min(math.max(name_w, meta_w), px(150)))
    local row = {}
    if photo_path then
        table.insert(row, ListView.photoRect(photo_path, photo_w, ch, px(8)))
    end
    for _i, b in ipairs(books) do table.insert(row, blockCover(b, cw, ch)) end
    return vstack({ w = w, h = lh_block }, {
        text(a.title or "", { s = 13, b = true, w = w, data = true }),
        runs(meta, { s = 11, col = INK.g4, w = w, data = true }),
        space(nil, px(6)),
        hstack({ gap = gap, valign = "top" }, row),
    }), w
end

local function seriesBlock(s, cw, lh_block, max_w)
    local ch = math.floor(cw * 1.5 + 0.5)
    local gap = px(5)
    local members = s.previewBooks or {}
    local n = #members
    local fit_n = math.max(1, math.floor((max_w + gap) / (cw + gap)))
    local more = (tonumber(s.count) or n) > n and ((tonumber(s.count) or n) - n) or 0
    if n > fit_n then more = more + (n - fit_n + 1); n = fit_n - 1 end
    local tiles = n + (more > 0 and 1 or 0)
    local covers_w = tiles * cw + math.max(0, tiles - 1) * gap
    local meta = ListData.seriesMeta(s)
    local styled = {}
    for _i, p in ipairs(meta) do table.insert(styled, { t = p.t, b = p.b, col = p.b and INK.black or INK.g4 }) end
    local name_w = ListView.textWidth(s.title or "", { s = 13, b = true }) + 1
    local meta_w = ListView.runsWidth(styled, { s = 11 }) + 1
    local w = math.min(max_w, math.max(covers_w, math.min(math.max(name_w, meta_w), px(170))))
    local row = {}
    for i = 1, n do table.insert(row, blockCover(members[i], cw, ch)) end
    if more > 0 then
        table.insert(row, BoardUI.box({ w = cw, h = ch, radius = px(6), bg = INK.ge }, hstack({ w = cw, h = ch }, { flex(0), text("+" .. more, { s = 14, b = true }), flex(0) })))
    end
    return vstack({ w = w, h = lh_block }, {
        text(s.title or "", { s = 13, b = true, w = w, data = true }),
        runs(styled, { s = 11, col = INK.g4, w = w, data = true }),
        space(nil, px(6)),
        hstack({ gap = gap, valign = "top" }, row),
    }), w
end

local function blockLine(w, blocks, gap)
    local items, used = {}, 0
    for _i, b in ipairs(blocks) do
        local bw = wOf(b.widget)
        if #items > 0 and used + gap + bw > w then break end
        if #items > 0 then table.insert(items, space(gap, 1)) end
        table.insert(items, b.widget)
        used = used + (#items > 1 and gap or 0) + bw
    end
    return hstack({ w = w, valign = "top" }, items)
end

function Pages.searchBody(m, f)
    local r = m.results
    local field_h = px(44)
    local field_inner = hstack({ w = f.w - 2 * math.max(1, px(1.5)), h = field_h - 2 * math.max(1, px(1.5)) }, {
        space(px(16) - math.max(1, px(1.5)), 1), icon("search", px(18), { sw = 2.5 }), space(px(10), 1),
        text(m.query or "", { s = 16, b = true, w = f.w - px(16) - px(18) - px(10) - px(44) - px(4), data = true }),
        flex(0),
        region(hstack({ w = px(44), h = px(40) }, { flex(0), icon("x", px(18), { sw = 2 }), flex(0) }), { kind = "search-clear" }, "search-field", "search-clear"),
    })
    local field = region(BoardUI.box({ w = f.w, h = field_h, radius = math.floor(field_h / 2), border = math.max(1, px(1.5)), border_col = INK.black, bg = INK.white }, field_inner), { kind = "search-edit" }, "search-field", "search-field")
    local total = #r.authors + #r.series + (r.books_total or #r.books)
    local function chip(label, on, scope)
        return region(MenuUI.chip(label, { h = 30, ink = on }), { kind = "search-scope", scope = scope }, "search-chips", "chip-" .. scope)
    end
    local chips = hstack({ gap = px(8) }, {
        chip(T(_("Everything %1"), total), m.scope == "all", "all"),
        chip(T(_("Authors %1"), #r.authors), m.scope == "authors", "authors"),
        chip(T(_("Series %1"), #r.series), m.scope == "series", "series"),
        chip(T(_("Books %1"), r.books_total or #r.books), m.scope == "books", "books"),
    })
    local cw = px(46)
    local lh_block = lh1(13) + lh1(11) + px(6) + math.floor(cw * 1.5 + 0.5) + px(7)
    local function blocksFor(list, make, max_w)
        local out = {}
        for i, e in ipairs(list) do
            local widget = make(e, max_w)
            table.insert(out, { widget = region(widget, { kind = e._kind == "series" and "open-series" or "open-author", entry = e }, "search-" .. (e._kind or "author"), (e._kind or "author") .. "-" .. i) })
        end
        return out
    end
    local function aBlock(a) local w = authorBlock(a, cw, lh_block); return w end
    local function sBlock(s, max_w) local w = seriesBlock(s, cw, lh_block, max_w); return w end
    local sec = px(36) + px(10)
    local top = field_h + px(10) + px(30) + px(6)
    local side = BoardMetrics.get().w > BoardMetrics.get().h
    local used = top + (side and 1 or 2) * (sec + lh_block + px(14)) + sec
    local book_room = f.content_h - used
    local std = ListView.stdGeom(m.screen_w, m.screen_h)
    local cols = ListView.gridCols(f.w)
    local fit_rows = math.max(1, math.floor((book_room + px(18)) / (std.cover_h + ListView.CAP() + px(18))))
    local shown = {}
    for i = 1, math.min(#r.books, cols * fit_rows) do shown[i] = r.books[i] end
    local g = ListView.fitStd(m.screen_w, m.screen_h, f.w, book_room, #shown)
    local more = (#shown < (r.books_total or #r.books)) and region(hstack({ gap = px(2) }, { text(_("See all"), { s = 13, b = true }), icon("chevron-right", px(14), { sw = 2.5 }) }), { kind = "search-scope", scope = "books" }, "search-books-head", "see-all") or nil
    for _i, e in ipairs(r.series) do e._kind = "series" end
    local kids = { field, space(nil, px(10)), chips, space(nil, px(6)) }
    if side then
        local aw = math.floor((f.w - px(28)) * 0.62)
        local sw = math.floor((f.w - px(28)) * 0.38)
        table.insert(kids, hstack({ w = f.w, valign = "top", gap = px(28) }, {
            vstack({ w = aw }, { ListView.sectionHead(aw, { icon = "feather", label = _("Authors"), count = #r.authors }), space(nil, px(10)), blockLine(aw, blocksFor(r.authors, aBlock, aw), px(22)) }),
            vstack({ w = sw }, { ListView.sectionHead(sw, { icon = "layers-2", label = _("Series"), count = #r.series }), space(nil, px(10)), blockLine(sw, blocksFor(r.series, sBlock, sw), px(22)) }),
        }))
        table.insert(kids, space(nil, px(14)))
    else
        table.insert(kids, ListView.sectionHead(f.w, { icon = "feather", label = _("Authors"), count = #r.authors }))
        table.insert(kids, space(nil, px(10)))
        table.insert(kids, blockLine(f.w, blocksFor(r.authors, aBlock, f.w), px(22)))
        table.insert(kids, space(nil, px(14)))
        table.insert(kids, ListView.sectionHead(f.w, { icon = "layers-2", label = _("Series"), count = #r.series }))
        table.insert(kids, space(nil, px(10)))
        table.insert(kids, blockLine(f.w, blocksFor(r.series, sBlock, f.w), px(22)))
        table.insert(kids, space(nil, px(14)))
    end
    table.insert(kids, ListView.sectionHead(f.w, { icon = "book", label = _("Books"), count = r.books_total or #r.books, right = more }))
    table.insert(kids, space(nil, px(10)))
    table.insert(kids, ListView.cellsGrid(f.w, g, shown, function(b) return ListView.bookCell(g, b) end, m.action))
    return vstack({ w = f.w }, kids)
end

-- --------------------------------------------------------------- sheets
-- Sort and filter, from the toolbar. sheet: { sorts = { labels, selected },
-- order = { labels, selected } or nil, shows = { labels, selected }, rows =
-- { { icon, label, value, toggle, action } }, footer = true }.
function Pages.sortSheet(sheet)
    return function(screen_w, screen_h)
        return ListView.sheet(screen_w, screen_h, { kind = "top", pop_w = 460, top = px(112), build = function(inner)
            local items = {
                ListView.sheetHead(inner, sheet.title, region(ListView.pill(_("Done"), { h = 36, s = 14, pad_x = 16 }), { kind = "sheet-done" }, "sheet-head", "done")),
                ListView.sheetLabel(inner, _("Sort by")),
                ListView.segmented(inner, sheet.sorts.labels, sheet.sorts.selected, function(i) return { kind = "sheet-sort", index = i } end, { h = 40, s = 13, row = "sheet-sort", key = "sort" }),
            }
            if sheet.order then
                table.insert(items, ListView.segmented(inner, sheet.order.labels, sheet.order.selected, function(i) return { kind = "sheet-order", index = i } end, { h = 36, s = 13, row = "sheet-order", key = "order" }))
            end
            table.insert(items, ListView.sheetLabel(inner, _("Show")))
            table.insert(items, ListView.segmented(inner, sheet.shows.labels, sheet.shows.selected, function(i) return { kind = "sheet-show", index = i } end, { h = 40, s = 13, row = "sheet-show", key = "show" }))
            if sheet.rows and #sheet.rows > 0 then
                local rw = inner - 2 * px(16)
                local rows = {}
                for i, r in ipairs(sheet.rows) do
                    table.insert(rows, ListView.groupRow(rw, { icon = r.icon, label = r.label, value = r.value, toggle = r.toggle, chevron = r.chevron, action = r.action, row = "sheet-row-" .. i, key = r.key, h = 50, s = 15 }))
                end
                table.insert(items, ListView.groupCard(inner, rows))
            end
            local reset = region(text(_("Reset to defaults"), { s = 14, b = true }), { kind = "sheet-reset" }, "sheet-foot", "reset")
            table.insert(items, hstack({ w = inner }, { reset, flex(px(8)), text(sheet.note or _("Saved for every list"), { s = 13, col = INK.g4 }) }))
            return items
        end })
    end
end

-- A list of choices (a library, a format), replacing the sort sheet.
function Pages.pickSheet(sheet)
    return function(screen_w, screen_h)
        return ListView.sheet(screen_w, screen_h, { kind = "top", pop_w = 460, top = px(112), build = function(inner, max_body)
            local back = region(hstack({ h = px(32), gap = px(2) }, { icon("chevron-left", px(22), { sw = 2.25 }), text(_("Back"), { s = 14, b = true }) }), { kind = "sheet-back" }, "sheet-head", "pick-back")
            local head = hstack({ w = inner, h = px(32) }, { back, flex(px(8)), text(sheet.title, { s = 18, b = true }), flex(px(8)), space(wOf(back), 1) })
            -- A long list that cannot fit in one column takes two.
            local n = #sheet.options
            local two = max_body and n > 1 and px(32) + px(14) + n * px(46) + px(8) > max_body
            local gap = px(12)
            local card_w = two and math.floor((inner - gap) / 2) or inner
            local rw = card_w - 2 * px(16)
            local function card(first, last)
                local rows = {}
                for i = first, last do
                    local o = sheet.options[i]
                    table.insert(rows, ListView.groupRow(rw, { label = o.label, radio = o.on, action = { kind = "sheet-pick", value = o.value }, row = "pick-" .. i, key = "pick-" .. i, h = 46, s = 15, bold = o.on }))
                end
                return ListView.groupCard(card_w, rows)
            end
            if not two then return { head, card(1, n) } end
            local half = math.ceil(n / 2)
            return { head, hstack({ w = inner, valign = "top", gap = gap }, { card(1, half), card(half + 1, n) }) }
        end })
    end
end

function Pages.jumpSheet(sheet)
    return function(screen_w, screen_h)
        return ListView.sheet(screen_w, screen_h, { kind = "bottom", pop_w = 460, build = function(inner)
            local close = region(hstack({ w = px(44), h = px(44) }, { flex(0), icon("x", px(22), { sw = 2 }), flex(0) }), { kind = "close-sheet" }, "sheet-head", "jump-close")
            local items = { ListView.sheetHead(inner, _("Jump to"), close) }
            if sheet.present then
                table.insert(items, ListView.jumpKeys(inner, sheet.present, sheet.current))
                table.insert(items, ListView.rule(inner))
            end
            table.insert(items, ListView.pageStepper(inner, sheet.page, sheet.pages))
            return items
        end })
    end
end

return Pages
