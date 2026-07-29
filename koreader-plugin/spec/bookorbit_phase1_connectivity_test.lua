local function read(path)
    local file = assert(io.open(path, "rb"))
    local content = file:read("*a")
    file:close()
    return content
end

local plugin_dir = "koreader-plugin/bookorbit.koplugin/"
local sources = {
    read(plugin_dir .. "main.lua"),
    read(plugin_dir .. "bookorbit_progress_sync.lua"),
    read(plugin_dir .. "bookorbit_main_menu.lua"),
    read(plugin_dir .. "bookorbit_updater.lua"),
}
local updater = sources[4]

for _, source in ipairs(sources) do
    assert(not source:find("isOnline", 1, true), "automatic code must not use DNS-based isOnline")
    assert(not source:find("willRerunWhenOnline", 1, true), "network reruns must use the connected gate")
    assert(not source:find("goOnlineToRun", 1, true), "lifecycle code must not block while enabling Wi-Fi")
end

local main = sources[1]
assert(main:find("skip_sync_when_offline = false", 1, true),
    "Phase 1 must preserve the existing offline default")
local close_handler = assert(main:match(
    "function BookOrbit:_onCloseDocument%(%)%s*(.-)%s*function BookOrbit:_onPageUpdate"))
local suspend_handler = assert(main:match(
    "function BookOrbit:_onSuspend%(%)%s*(.-)%s*function BookOrbit:_onNetworkConnected"))

for _, handler in ipairs({ close_handler, suspend_handler }) do
    local enqueue_at = assert(handler:find("enqueueLifecycleSnapshot", 1, true))
    local drain_at = assert(handler:find("requestLifecycleOutboxDrain", 1, true))
    assert(enqueue_at < drain_at, "lifecycle data must be durable before drain scheduling")
    assert(not handler:find("BookOrbitBookSync.run", 1, true), "lifecycle handler must not run network sync")
end

local update_handler = assert(main:match(
    "function BookOrbit:requestUpdateCheck%(interactive, source%)%s*(.-)%s*function BookOrbit:runPendingUpdateCheck"))
assert(not update_handler:find("submitSyncJob", 1, true),
    "update checks must not occupy the critical sync coordinator")
assert(update_handler:find("NetworkMgr:isConnected", 1, true),
    "automatic update checks must skip disconnected state")
assert(update_handler:find("self.automatic_update_check_pending = false", 1, true),
    "the deferred update check must be consumed by the tick that runs it")
assert(updater:find("Trapper:dismissableRunInSubprocess", 1, true),
    "manual update checks remain cancellable")

for _, handler in ipairs({ close_handler, suspend_handler }) do
    local login_at = assert(handler:find("isLoggedIn", 1, true),
        "lifecycle handlers must not queue work while logged out")
    assert(login_at < assert(handler:find("enqueueLifecycleSnapshot", 1, true)),
        "the login check must precede the enqueue")
end

local drain_handler = assert(main:match(
    "function BookOrbit:requestLifecycleOutboxDrain%(source, interactive%)%s*(.-)%s*function BookOrbit:getSyncCoordinatorStatus"))
assert(drain_handler:find("if not interactive or self.settings.skip_sync_when_offline then return false end",
    1, true), "only interactive drains may bring up connectivity")

print("bookorbit_phase1_connectivity_test.lua: ok")
