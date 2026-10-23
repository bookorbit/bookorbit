-- Downloads keep the server's folder layout under one root. Falling back to the
-- folder last browsed made that root move: fetching a book again while browsing
-- inside "Standalone" landed it in "Standalone/Standalone".

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local settings = {}
G_reader_settings = { readSetting = function(_, key) return settings[key] end }

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local function root(values, device_home)
    settings = values
    package.loaded["device"] = { home_dir = device_home }
    package.loaded["bookorbit_download_root"] = nil
    return require("bookorbit_download_root").get()
end

assertEqual(root({ download_dir = "/path/to/books", home_dir = "/path/to/home", lastdir = "/path/to/books/Standalone" }, "/mnt/onboard"),
    "/path/to/books", "a chosen download folder always wins")
assertEqual(root({ home_dir = "/path/to/home", lastdir = "/path/to/home/Standalone" }, "/mnt/onboard"),
    "/path/to/home", "the Home folder comes before the folder last browsed")
assertEqual(root({ lastdir = "/mnt/onboard/Standalone" }, "/mnt/onboard"),
    "/mnt/onboard", "the device's home folder comes before the folder last browsed")
assertEqual(root({ lastdir = "/path/to/elsewhere/Standalone" }, nil),
    "/path/to/elsewhere/Standalone", "the folder last browsed is the last resort")

print("bookorbit_download_root_test: ok")
