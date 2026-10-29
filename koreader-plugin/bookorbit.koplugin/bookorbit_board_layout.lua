--[[--
Pure layout for the widget dashboard: the grid a device gets, the dense
packing of a page's widgets, and how a page fits the screen.

A board is a grid of 2, 4 or 6 columns (by width in dp). Its row height
stretches between MIN_ROW and MAX_ROW so the page fills the screen exactly;
a page with too many rows drops widgets from its end, and a page with room to
spare takes optional extras while rows stay comfortable. Nothing here touches
widgets, so the whole fit can be unit tested.
]]

local BoardLayout = {}

BoardLayout.MIN_ROW = 84
BoardLayout.COMFY_ROW = 104
BoardLayout.MAX_ROW = 150
BoardLayout.GAP = 10
BoardLayout.TOP = 6
BoardLayout.HEADER = 64
BoardLayout.HEADER_GAP = 8
BoardLayout.FOOTER = 40
BoardLayout.FOOTER_GAP = 8
BoardLayout.BOTTOM = 8

-- Size codes: S 1x1, M 2x1, L 2x2, W full width x1, XL full width x2. On a
-- two-column board W is M and XL is L.
function BoardLayout.sizeDims(code, cols)
    if code == "S" then return 1, 1 end
    if code == "M" then return math.min(2, cols), 1 end
    if code == "L" then return math.min(2, cols), 2 end
    if code == "W" then return cols, 1 end
    return cols, 2
end

function BoardLayout.editBarTop(tile_y, tile_h, bar_h, gap, available_h)
    local below = tile_y + tile_h + gap
    if below + bar_h <= available_h then return below end
    return math.max(0, tile_y - bar_h - gap)
end

function BoardLayout.columnsFor(width_dp)
    if width_dp >= 900 then return 6 end
    if width_dp >= 560 then return 4 end
    return 2
end

function BoardLayout.marginFor(width_dp)
    if width_dp >= 900 then return 28 end
    if width_dp >= 700 then return 24 end
    if width_dp >= 560 then return 20 end
    return 16
end

-- px: the dp-to-pixel function. Returns everything in pixels. width_dp is
-- the screen's width at interface size 1, so a page keeps its columns at
-- every interface size.
function BoardLayout.geometry(px, screen_w, screen_h, width_dp)
    local g = {}
    g.mx = px(BoardLayout.marginFor(width_dp))
    g.w = screen_w - 2 * g.mx
    g.cols = BoardLayout.columnsFor(width_dp)
    g.gap = px(BoardLayout.GAP)
    g.col_w = math.floor((g.w - (g.cols - 1) * g.gap) / g.cols)
    g.top = px(BoardLayout.TOP)
    g.header_h = px(BoardLayout.HEADER)
    g.header_gap = px(BoardLayout.HEADER_GAP)
    g.footer_h = px(BoardLayout.FOOTER)
    g.footer_gap = px(BoardLayout.FOOTER_GAP)
    g.bottom = px(BoardLayout.BOTTOM)
    g.avail = screen_h - g.top - g.header_h - g.header_gap - g.footer_gap - g.footer_h - g.bottom
    g.min_row = px(BoardLayout.MIN_ROW)
    g.comfy_row = px(BoardLayout.COMFY_ROW)
    g.max_row = px(BoardLayout.MAX_ROW)
    return g
end

-- Width of a tile spanning cw columns starting at column x (0-based). The
-- last column absorbs the rounding remainder so the grid ends on the margin.
function BoardLayout.spanWidth(g, x, cw)
    if x + cw == g.cols then
        return g.w - x * (g.col_w + g.gap)
    end
    return cw * g.col_w + (cw - 1) * g.gap
end

function BoardLayout.cellX(g, x)
    return x * (g.col_w + g.gap)
end

-- First-fit dense packing, row-major. Returns placed copies (with x, y), the
-- number of rows used and the number of empty cells within those rows.
function BoardLayout.pack(items, cols)
    local occ = {}
    local function free(r, c, w, h)
        for y = r, r + h - 1 do
            local line = occ[y]
            if line then
                for x = c, c + w - 1 do
                    if line[x] then return false end
                end
            end
        end
        return true
    end
    local rows = 0
    local placed = {}
    for _i, it in ipairs(items) do
        local cw = math.min(it.cw, cols)
        local done = false
        local r = 0
        while not done do
            for x = 0, cols - cw do
                if free(r, x, cw, it.rh) then
                    for y = r, r + it.rh - 1 do
                        occ[y] = occ[y] or {}
                        for xx = x, x + cw - 1 do occ[y][xx] = true end
                    end
                    rows = math.max(rows, r + it.rh)
                    local p = {}
                    for k, v in pairs(it) do p[k] = v end
                    p.cw, p.x, p.y = cw, x, r
                    table.insert(placed, p)
                    done = true
                    break
                end
            end
            r = r + 1
        end
    end
    local holes = 0
    for y = 0, rows - 1 do
        for x = 0, cols - 1 do
            if not (occ[y] and occ[y][x]) then holes = holes + 1 end
        end
    end
    return { placed = placed, rows = rows, holes = holes }
end

function BoardLayout.rowHeight(g, rows)
    if rows <= 0 then return g.max_row end
    return math.floor((g.avail - (rows - 1) * g.gap) / rows)
end

-- Fits one page: drops trailing widgets until rows are at least MIN_ROW, then
-- adds extras that cost no row (or keep rows comfortable) and leave no new
-- holes. Returns the packing plus the row height to draw it at, and the
-- widgets dropped for room. The first widget always stays: two rows at
-- MIN_ROW fit every screen.
function BoardLayout.fitPage(g, base, extras)
    local items = {}
    for _i, it in ipairs(base or {}) do table.insert(items, it) end
    local dropped = {}
    while #items > 1 and BoardLayout.rowHeight(g, BoardLayout.pack(items, g.cols).rows) < g.min_row do
        table.insert(dropped, 1, table.remove(items))
    end
    for _i, ex in ipairs(extras or {}) do
        local before = BoardLayout.pack(items, g.cols)
        local trial = {}
        for _i, it in ipairs(items) do table.insert(trial, it) end
        table.insert(trial, ex)
        local after = BoardLayout.pack(trial, g.cols)
        if (after.rows == before.rows or BoardLayout.rowHeight(g, after.rows) >= g.comfy_row)
                and after.holes <= before.holes then
            items = trial
        end
    end
    local packed = BoardLayout.pack(items, g.cols)
    packed.row_h = math.min(g.max_row, BoardLayout.rowHeight(g, packed.rows))
    packed.grid_h = packed.rows * packed.row_h + math.max(0, packed.rows - 1) * g.gap
    packed.dropped = dropped
    return packed
end

return BoardLayout
