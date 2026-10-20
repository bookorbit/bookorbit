--[[--
The folder catalog downloads land under.

Downloads keep the server's folder layout below this root. KOReader's own last
resort, the folder last browsed, moves with every visit, so a book fetched again
from inside one of those folders landed in a second copy of the layout. The
Home folder stays put, so it comes before it.
]]

local DownloadRoot = {}

function DownloadRoot.get()
    local root = G_reader_settings:readSetting("download_dir") or G_reader_settings:readSetting("home_dir")
    if root then return root end
    local ok, Device = pcall(require, "device")
    if ok and type(Device) == "table" and Device.home_dir then return Device.home_dir end
    return G_reader_settings:readSetting("lastdir")
end

return DownloadRoot
