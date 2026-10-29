--[[--
Sign in to BookOrbit: the server and the KOReader login on one page.

Each field opens a BookOrbit text panel over the page, with KOReader's
keyboard; Enter moves on to the next empty field, and from the password
straight to signing in. What went wrong shows on the page. Test checks the
address before any password is typed: a BookOrbit server answers the login
endpoint with "not signed in", which tells it apart from a wrong address. The
QR code opens Settings, KOReader on that server, so a login can be created on
a phone.
]]

local Device = require("device")
local NetworkMgr = require("ui/network/manager")
local UIManager = require("ui/uimanager")
local md5 = require("ffi/sha2").md5
local util = require("util")
local _ = require("gettext")
local T = require("ffi/util").template

local BookOrbitApi = require("bookorbit_api")
local BoardMetrics = require("bookorbit_board_metrics")
local BoardUI = require("bookorbit_board_ui")
local DialogUI = require("bookorbit_dialog_ui")
local MenuPage = require("bookorbit_menu_page")
local MenuUI = require("bookorbit_menu_ui")

local INK = BoardMetrics.INK
local px = BoardMetrics.px
local text, vstack, hstack, flex, space, icon = BoardUI.text, BoardUI.vstack, BoardUI.hstack, BoardUI.flex, BoardUI.space, BoardUI.icon

local SignIn = {}

local Toast = setmetatable({}, { __index = function(_t, k) return require("bookorbit_toast")[k] end })
local TextEntry = setmetatable({}, { __index = function(_t, k) return require("bookorbit_text_entry")[k] end })

-- The web address of Settings, KOReader on the server the API lives on.
function SignIn.settingsUrl(server_url)
    if type(server_url) ~= "string" or server_url == "" then return nil end
    local origin = server_url:gsub("/api/v1/?$", ""):gsub("/+$", "")
    return origin .. "/settings/koreader"
end

local function field(w, value, o)
    local h = px(48)
    local b = math.max(1, px(o.focus and 2.5 or 1.5))
    local items = { icon(o.icon, px(18), { sw = 2 }) }
    local trail = o.trail
    local tw = w - 2 * b - 2 * px(14) - px(18) - px(10) - (trail and (trail:getSize().w + px(10)) or 0)
    table.insert(items, text(value ~= "" and value or o.placeholder, { s = 16, col = value ~= "" and INK.black or INK.g6, w = tw, data = true }))
    if trail then table.insert(items, trail) end
    local box = BoardUI.box({ w = w, h = h, radius = px(10), border = b, border_col = INK.black, bg = INK.white },
        hstack({ w = w - 2 * b, h = h - 2 * b }, { space(px(14), 1), hstack({ gap = px(10) }, items), flex(0) }))
    return o.action and BoardUI.hit(box, o.action) or box
end

local function qr(text_, size)
    local ok, QRWidget = pcall(require, "ui/widget/qrwidget")
    if not ok or not text_ then return nil end
    local ok2, widget = pcall(function() return QRWidget:new{ text = text_, width = size, height = size } end)
    return ok2 and widget or nil
end

-- A one-line outcome under a field: found, or what went wrong.
local function outcome(w, glyph, str)
    return hstack({ w = w, gap = px(6), valign = "top" }, { icon(glyph, px(16), { sw = 2.25 }), text(str, { s = 13, b = true, w = w - px(16) - px(6), lines = 3, data = true }) })
end

local function build(page, sw, sh)
    local s = page.form
    local mx = MenuUI.mx()
    local top, bottom = px(6), px(12)
    local w = sw - 2 * mx
    local pad = px(18)
    local url = SignIn.settingsUrl(BookOrbitApi.normalizeServerUrl(s.server))

    -- The card's parts at an inner width iw; gap is the room above and
    -- below each part, tighter on a short screen.
    local function serverPart(iw, gap)
        local status
        if s.test == "found" then
            status = outcome(iw, "circle-check", _("BookOrbit found"))
        elseif s.test == "failed" then
            status = outcome(iw, "triangle-alert", s.test_message or _("No BookOrbit server answered there"))
        end
        return vstack({ w = iw, pad = { gap, 0, gap, 0 } }, {
            text(_("Server"), { s = 13, b = true }),
            space(nil, px(8)),
            field(iw, MenuUI.serverHost(s.server) or "", { icon = "globe", placeholder = "books.example.com", action = { kind = "edit", field = "server" },
                trail = MenuUI.pill(_("Test"), { kind = "outline", h = 32, s = 13, pad_x = 12, action = { kind = "test" } }) }),
            status and space(nil, px(8)) or false,
            status or false,
        })
    end
    local function helpPart(iw)
        local qr_size = px(88)
        local code = url and qr(url, qr_size)
        local help_w = iw - (code and (qr_size + px(14)) or 0)
        local help = vstack({ w = help_w }, {
            text(_("No KOReader login yet?"), { s = 14, b = true, w = help_w }),
            space(nil, px(2)),
            text(code and _("Scan to create one in BookOrbit on your phone, or open Settings, KOReader on the web.")
                or _("Create one in BookOrbit on the web: Settings, KOReader."), { s = 13, col = INK.g4, lines = 3, w = help_w }),
        })
        return code and hstack({ w = iw, gap = px(14) }, { help, code }) or help
    end
    local function loginPart(iw, gap, with_help)
        return vstack({ w = iw, pad = { gap, 0, gap, 0 } }, {
            text(_("KOReader login"), { s = 13, b = true }),
            space(nil, px(8)),
            field(iw, s.username or "", { icon = "circle-user-round", placeholder = _("Username"), action = { kind = "edit", field = "username" }, focus = s.focus == "username" }),
            space(nil, px(8)),
            field(iw, s.password and string.rep("•", #s.password) or "", { icon = "key-round", placeholder = _("Password"), action = { kind = "edit", field = "password" }, focus = s.focus == "password" }),
            s.error and space(nil, px(8)) or false,
            s.error and outcome(iw, "triangle-alert", s.error) or false,
            with_help and space(nil, px(12)) or false,
            with_help and helpPart(iw) or false,
        })
    end
    local function actions(card_w)
        return {
            MenuUI.pill(_("Sign in"), { h = 50, s = 16, w = card_w, action = { kind = "sign-in" } }),
            space(nil, px(8)),
            hstack({ w = card_w }, { flex(0), MenuUI.pill(_("Not now"), { kind = "ghost", h = 40, s = 14, action = { kind = "close" } }), flex(0) }),
        }
    end
    -- One card: the server over the login, Sign in under it.
    local function oneColumn(with_help)
        local card_w = math.min(w, px(560))
        local iw = card_w - 2 * pad
        local card = MenuUI.card(card_w, { serverPart(iw, px(16)), BoardUI.rect(iw, MenuUI.hair(), INK.gb), loginPart(iw, px(16), with_help) }, { pad = 18, strong = true })
        local items = { card, space(nil, px(14)) }
        for _i, item in ipairs(actions(card_w)) do table.insert(items, item) end
        return vstack({ w = card_w }, items)
    end
    -- A wide, short screen: the server (and the help) beside the login and
    -- Sign in.
    local function twoColumns(with_help, gap)
        local col_gap = px(24)
        local col_w = math.min(math.floor((w - col_gap) / 2), px(460))
        local iw = col_w - 2 * pad
        local left_items = { serverPart(iw, gap) }
        if with_help then
            table.insert(left_items, BoardUI.rect(iw, MenuUI.hair(), INK.gb))
            table.insert(left_items, vstack({ w = iw, pad = { gap, 0, gap, 0 } }, { helpPart(iw) }))
        end
        local left = MenuUI.card(col_w, left_items, { pad = 18, strong = true })
        local right_items = { MenuUI.card(col_w, { loginPart(iw, gap, false) }, { pad = 18, strong = true }), space(nil, px(14)) }
        for _i, item in ipairs(actions(col_w)) do table.insert(right_items, item) end
        return hstack({ gap = col_gap, valign = "top" }, { left, vstack({ w = col_w }, right_items) })
    end

    local header = MenuUI.pageHeader(w, _("Sign in to BookOrbit"), {
        back = false, sub = _("Sync progress and highlights, and browse your library"),
        right = MenuUI.iconButton("x", { kind = "close" }), right_inset = MenuUI.tapInset(24),
    })
    local footer = text(_("The BookOrbit icon stays in KOReader's menu bar, so you can sign in later."), { s = 13, col = INK.g4, w = w, lines = 2, align = "center" })
    -- On a short screen the note under the page goes first, then the help
    -- beside the QR code; a wide one then sets the login beside the server,
    -- tightening its gaps last. The fields and Sign in always stay.
    local room = sh - top - bottom - header:getSize().h - 2 * px(8)
    local variants = {
        function() return oneColumn(true) end,
        function() return oneColumn(false) end,
    }
    if MenuUI.wide() then
        table.insert(variants, function() return twoColumns(true, px(16)) end)
        table.insert(variants, function() return twoColumns(false, px(16)) end)
        table.insert(variants, function() return twoColumns(false, px(8)) end)
    end
    local pick, pick_h = #variants, nil
    for index, make in ipairs(variants) do
        local clean, probe = BoardUI.fits(function() return BoardUI.collectHits(make) end)
        local h = probe and probe.getSize and probe:getSize().h or math.huge
        if probe and probe.free then probe:free() end
        if index == 1 then pick_h = h end
        if clean and h <= room then pick, pick_h = index, h; break end
    end
    local with_footer = pick == 1 and pick_h + footer:getSize().h <= room
    local body = variants[pick]()
    return vstack({ w = sw, h = sh, pad = { top, mx, bottom, mx } }, {
        header,
        flex(px(8)),
        hstack({ w = w }, { flex(0), body, flex(0) }),
        flex(px(8)),
        with_footer and footer or false,
    })
end

-- The server as it is typed: without the API path the plugin adds.
local function serverInput(server)
    if not server or server == "" then return "https://" end
    return (server:gsub("/api/v1/?$", ""))
end

local function ready(s)
    return BookOrbitApi.normalizeServerUrl(s.server) and (s.username or "") ~= "" and (s.password or "") ~= ""
end

local function firstMissing(s)
    if not BookOrbitApi.normalizeServerUrl(s.server) then return "server" end
    if (s.username or "") == "" then return "username" end
    if (s.password or "") == "" then return "password" end
end

local signIn

local function edit(page, name)
    local s = page.form
    local fields = {
        server = { title = _("Server address"), icon = "globe", hint = "https://books.example.com",
            note = _("The address you open BookOrbit at in a browser.") },
        username = { title = _("Username"), icon = "circle-user-round",
            note = _("Your KOReader login, made in BookOrbit on the web: Settings, KOReader.") },
        password = { title = _("Password"), icon = "key-round", password = true },
    }
    local f = fields[name]
    local last = name == "password"
    TextEntry.open{
        title = f.title,
        icon = f.icon,
        hint = f.hint,
        password = f.password,
        value = name == "server" and serverInput(s.server) or (s[name] or ""),
        validate = name == "server" and function(value)
            if not BookOrbitApi.normalizeServerUrl(value) then return _("Enter a valid http:// or https:// server address.") end
        end or nil,
        below = function(_page, w)
            local done = last and BookOrbitApi.normalizeServerUrl(s.server) and (s.username or "") ~= ""
            return {
                f.note and DialogUI.note(w, "info", f.note, { col = INK.g3 }) or false,
                DialogUI.pillRow(w, {
                    { label = _("Cancel"), kind = "outline", action = { kind = "close" } },
                    done and { label = _("Sign in"), action = { kind = "submit" } }
                        or { label = last and _("Done") or _("Next"), action = { kind = "submit" } },
                }),
            }
        end,
        on_submit = function(value)
            if page.closed then return end
            s[name] = value
            s.error = nil
            if name == "server" then s.test = nil end
            if ready(s) and last then
                s.focus = nil
                page:refresh()
                signIn(page)
                return
            end
            local next_field = firstMissing(s)
            s.focus = next_field ~= "server" and next_field or nil
            page:refresh()
            -- Straight on to the next empty field, as a login form does.
            if next_field and next_field ~= name then
                UIManager:tickAfterNext(function() if not page.closed then edit(page, next_field) end end)
            end
        end,
    }
end

-- Shows a loading pill while fn runs; the request cannot be stopped.
local function busy(label, fn)
    local pill = Toast.loading(label, { dismissable = false })
    local a, b = fn()
    pill:close()
    return a, b
end

-- A BookOrbit server answers the login endpoint even without a login; a wrong
-- address does not.
local function test(page, then_fn)
    local s = page.form
    local normalized = BookOrbitApi.normalizeServerUrl(s.server)
    if not normalized then
        s.test = "failed"
        s.test_message = (not s.server or util.trim(s.server) == "") and _("Type the server's address first")
            or _("Enter a valid http:// or https:// server address.")
        page:refresh()
        return
    end
    NetworkMgr:runWhenConnected(function()
        local opts = page.plugin:apiOpts(false)
        opts.server_url, opts.username, opts.userkey = normalized, nil, nil
        local body, err = busy(_("Looking for BookOrbit…"), function() return BookOrbitApi.new(opts):auth() end)
        if body or err == 401 or err == 403 then
            s.test, s.test_message = "found", nil
        else
            s.test = "failed"
            s.test_message = err == 404 and _("That address is not a BookOrbit server") or T(_("Could not reach it: %1"), page.plugin:errorLabel(err))
        end
        page:refresh()
        if then_fn and s.test == "found" then then_fn() end
    end)
end

signIn = function(page)
    local s = page.form
    local plugin = page.plugin
    local missing = firstMissing(s)
    if missing then
        edit(page, missing)
        return
    end
    local normalized = BookOrbitApi.normalizeServerUrl(s.server)
    NetworkMgr:runWhenConnected(function()
        local opts = plugin:apiOpts(false)
        opts.server_url, opts.username, opts.userkey = normalized, s.username, md5(s.password)
        Device:setIgnoreInput(true)
        local body, err = busy(_("Signing in…"), function() return BookOrbitApi.new(opts):auth() end)
        Device:setIgnoreInput(false)
        if body then
            plugin:completeSignIn(normalized, s.username, opts.userkey)
            page:close()
            if page.on_signed_in then page.on_signed_in() end
            return
        elseif err == 401 or err == 403 then
            s.error = _("That username and password were not accepted. Check your KOReader login in BookOrbit on the web: Settings, KOReader.")
        else
            s.error = T(_("Could not reach the BookOrbit server: %1"), plugin:errorLabel(err))
        end
        page:refresh()
    end)
end

local function onAction(page, action)
    local kind = action.kind
    if kind == "edit" then
        edit(page, action.field)
    elseif kind == "test" then
        test(page)
    elseif kind == "sign-in" then
        signIn(page)
    end
    return true
end

-- on_signed_in runs after a successful sign-in, once the page has closed.
function SignIn.open(plugin, on_signed_in)
    local settings = plugin.settings
    local page = MenuPage:new{
        name = "bookorbit_sign_in",
        build = build,
        on_action = onAction,
        plugin = plugin,
        on_signed_in = on_signed_in,
        form = { server = settings.server_url, username = settings.username, focus = settings.server_url and "username" or nil },
    }
    UIManager:show(page, "ui")
    return page
end

return SignIn
