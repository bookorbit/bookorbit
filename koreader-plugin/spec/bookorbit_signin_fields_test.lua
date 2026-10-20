-- The sign-in page's fields: each opens the BookOrbit text panel, Enter moves
-- on to the next empty field, the password signs in, and a rejected login
-- says so on the page.

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path
package.loaded["gettext"] = function(text) return text end
package.loaded["ffi/util"] = { template = function(text, ...) return (text:gsub("%%1", tostring((...)))) end }
package.loaded["ffi/sha2"] = { md5 = function(text) return "md5:" .. text end }
package.loaded["util"] = { trim = function(text) return (text:gsub("^%s+", ""):gsub("%s+$", "")) end }
package.loaded["device"] = { setIgnoreInput = function() end }
package.loaded["ui/network/manager"] = { runWhenConnected = function(_self, fn) fn() end }
package.loaded["ui/uimanager"] = { show = function() end, tickAfterNext = function(_self, fn) fn() end }
for _, name in ipairs({ "bookorbit_board_metrics", "bookorbit_board_ui", "bookorbit_dialog_ui", "bookorbit_menu_ui" }) do
    package.loaded[name] = {}
end

local auth_result = { nil, 401 }
package.loaded["bookorbit_api"] = {
    normalizeServerUrl = function(value)
        if type(value) ~= "string" or not value:match("^https?://[%w.-]+%.%a+") then return nil end
        return (value:gsub("/+$", "")) .. "/api/v1"
    end,
    new = function(opts)
        return { auth = function() return auth_result[1], auth_result[2] end, opts = opts }
    end,
}
package.loaded["bookorbit_menu_page"] = {
    new = function(_self, o)
        o.refreshes = 0
        function o:refresh() self.refreshes = self.refreshes + 1 end
        function o:close() self.closed = true end
        return o
    end,
}
local entries = {}
package.loaded["bookorbit_text_entry"] = { open = function(opts) table.insert(entries, opts) end }
package.loaded["bookorbit_toast"] = { loading = function() return { close = function() end } end }

local SignIn = require("bookorbit_signin_page")

local function assertEqual(actual, expected, label)
    if actual ~= expected then error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual))) end
end

local signed_in
local plugin = {
    settings = {},
    apiOpts = function() return {} end,
    errorLabel = function(_self, err) return "error " .. tostring(err) end,
    completeSignIn = function(_self, server, username, userkey) signed_in = { server = server, username = username, userkey = userkey } end,
}

-- A first sign-in: server, then straight on to the username and password.
local page = SignIn.open(plugin)
page.on_action(page, { kind = "edit", field = "server" })
local server = entries[#entries]
assertEqual(server.value, "https://", "an empty server field starts with the scheme")
assertEqual(server.validate("books"), "Enter a valid http:// or https:// server address.", "an address that is not a web address keeps the panel open")
assertEqual(server.validate("https://books.example.com"), nil, "a web address is accepted")
server.on_submit("https://books.example.com")
assertEqual(page.form.server, "https://books.example.com", "the server is stored as typed")
assertEqual(#entries, 2, "Enter moves on to the username")
assertEqual(entries[2].title, "Username", "the username panel opens next")
entries[2].on_submit("reader")
assertEqual(#entries, 3, "then the password")
assertEqual(entries[3].password, true, "the password panel masks what is typed")

-- A rejected login shows on the page; the password panel signs in directly.
entries[3].on_submit("wrong")
assertEqual(page.closed, nil, "a rejected login leaves the page open")
assertEqual(page.form.error ~= nil, true, "and says why on the page")
assertEqual(signed_in, nil, "nothing is stored")

-- Editing a field clears the problem; a good password signs in.
auth_result = { { ok = true } }
page.on_action(page, { kind = "edit", field = "password" })
entries[#entries].on_submit("secret")
assertEqual(page.form.error, nil, "a new value clears the old problem")
assertEqual(page.closed, true, "a signed-in page closes")
assertEqual(signed_in.server, "https://books.example.com/api/v1", "the normalized server is stored")
assertEqual(signed_in.userkey, "md5:secret", "with the password's key")

-- Signing in again: the server opens without the API path, and Sign in with a
-- field missing opens that field instead of a message.
entries, signed_in = {}, nil
plugin.settings = { server_url = "https://books.example.com/api/v1", username = "reader" }
page = SignIn.open(plugin)
page.on_action(page, { kind = "edit", field = "server" })
assertEqual(entries[1].value, "https://books.example.com", "the server is edited as it was typed")
page.on_action(page, { kind = "sign-in" })
assertEqual(entries[2].title, "Password", "Sign in opens the missing password")
assertEqual(signed_in, nil, "and does not try to sign in without it")

print("bookorbit_signin_fields_test.lua: ok")
