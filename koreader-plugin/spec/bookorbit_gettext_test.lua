package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local core = setmetatable({
    current_lang = "ru",
    getPlural = function(n)
        if n % 10 == 1 and n % 100 ~= 11 then return 0 end
        if n % 10 >= 2 and n % 10 <= 4 and (n % 100 < 12 or n % 100 > 14) then return 1 end
        return 2
    end,
    ngettext = function(one, many, n) return n == 1 and one or many end,
}, { __call = function(_, text) return text end })
package.loaded.gettext = core
package.loaded.logger = { warn = function() end }
package.loaded.bookorbit_gettext = nil

local gettext = require("bookorbit_gettext")
assert(gettext("BookOrbit Sync") == "Синхронизация BookOrbit")
assert(gettext("%1 book") == "%1 книга")
for count, expected in pairs({ [1] = "%1 книга", [2] = "%1 книги", [5] = "%1 книг", [21] = "%1 книга" }) do
    assert(gettext.ngettext("%1 book", "%1 books", count) == expected)
end
assert(gettext("Missing translation") == "Missing translation")
assert(gettext.ngettext("missing", "missing plural", 2) == "missing plural")
core.current_lang = "en_US"
assert(gettext("BookOrbit Sync") == "BookOrbit Sync")
core.current_lang = "ru"
assert(gettext("BookOrbit Sync") == "Синхронизация BookOrbit")

package.loaded.gettext = function(text) return text end
package.loaded.bookorbit_gettext = nil
local stubbed = require("bookorbit_gettext")
assert(stubbed.ngettext("book", "books", 2) == "books")
print("bookorbit_gettext_test: passed")
