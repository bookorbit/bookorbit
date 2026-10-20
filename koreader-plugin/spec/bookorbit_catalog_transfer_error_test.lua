local function identity(value)
    return value
end

package.loaded["gettext"] = identity
package.loaded["document/documentregistry"] = {
    hasProvider = function()
        return true
    end,
}
package.loaded["util"] = {
    fixUtf8 = identity,
}
package.loaded["ffi/util"] = {
    template = function(value)
        return value
    end,
}

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local CatalogUtil = require("bookorbit_catalog_util")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

assertEqual(
    CatalogUtil.transferErrorText("unsafe_destination"),
    "The download destination is outside the selected folder or contains a symbolic link.",
    "unsafe destinations are reported as local path failures"
)
assertEqual(
    CatalogUtil.transferErrorText("temp_dir_failed"),
    "Could not create a temporary download folder in the selected folder.",
    "temporary directory failures are reported as local filesystem failures"
)
assertEqual(CatalogUtil.transferErrorText("network_error"), nil, "network errors keep the existing connection message")
assertEqual(CatalogUtil.transferErrorText("hash_mismatch"),
    "The downloaded file failed its integrity check. Retry the download. The previous file was kept.",
    "fingerprint failures explain safe retry")
assertEqual(CatalogUtil.transferErrorText("size_mismatch"),
    "The download was incomplete. Retry the download. The previous file was kept.",
    "length failures explain safe retry")
assertEqual(CatalogUtil.transferErrorText("response_too_large"),
    "The download exceeded its expected size. The previous file was kept.",
    "oversized responses explain preserved files")

print("bookorbit_catalog_transfer_error_test.lua: ok")
