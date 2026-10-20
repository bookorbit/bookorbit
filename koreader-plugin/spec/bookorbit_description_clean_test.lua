-- Descriptions arrive as HTML. A heading is its own paragraph: the text after
-- it must not run into it ("Amazon.com ReviewWhat is most notable...").

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

package.loaded["document/documentregistry"] = {}
package.loaded["util"] = {}
package.loaded["ffi/util"] = { template = function(text) return text end }
package.loaded["gettext"] = function(text) return text end

local CatalogUtil = require("bookorbit_catalog_util")

local function assertEqual(actual, expected, label)
    if actual ~= expected then error(string.format("%s: expected %q, got %q", label, tostring(expected), tostring(actual))) end
end

local html = "<p>of those wild days known as growing up.</p><h3>Amazon.com Review</h3><p>What is most notable about this novel.</p>"
assertEqual(CatalogUtil.cleanDescriptionText(html),
    "of those wild days known as growing up.\n\nAmazon.com Review\n\nWhat is most notable about this novel.",
    "a heading sits between paragraphs, apart from both")
assertEqual(CatalogUtil.cleanDescriptionText("<h2 class=\"x\">Title</h2>Body"), "Title\n\nBody", "a heading with attributes is still a heading")
assertEqual(CatalogUtil.cleanDescriptionText("<p>One</p><p>Two</p>"), "One\n\nTwo", "paragraphs are unchanged")

print("bookorbit_description_clean_test.lua: ok")
