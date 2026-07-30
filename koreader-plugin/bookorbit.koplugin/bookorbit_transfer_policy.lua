--[[--
Socket and size budgets for a single file transfer.

Book files outgrow KOReader's inherited file-transfer budget: a 60 second total
socket timeout caps a transfer at whatever an e-reader can move in a minute, so
a large book fails on a slow link even while it is making steady progress. The
block timeout is the stall detector instead, bounding the gap between
successful socket operations, and the total ceiling scales with the size the
server recorded for the file.
]]

local STALL_TIMEOUT = 30
local BASE_TIMEOUT = 120
local MIN_BYTES_PER_SECOND = 8 * 1024
local MAX_TIMEOUT = 6 * 60 * 60

-- Ceiling for a transfer whose size the server did not record.
local MAX_TRANSFER_BYTES = 512 * 1024 * 1024
-- Servers may add container overhead, so the recorded size is a margin rather
-- than an exact ceiling.
local SIZE_MARGIN = 1.25
local SIZE_SLACK_BYTES = 1024 * 1024

local TransferPolicy = {}

TransferPolicy.MAX_TRANSFER_BYTES = MAX_TRANSFER_BYTES

function TransferPolicy.timeouts(expected_bytes)
    local size = math.max(0, tonumber(expected_bytes) or 0)
    return STALL_TIMEOUT, math.min(BASE_TIMEOUT + math.ceil(size / MIN_BYTES_PER_SECOND), MAX_TIMEOUT)
end

function TransferPolicy.maxBytes(expected_bytes)
    local size = tonumber(expected_bytes)
    if not size or size <= 0 then return MAX_TRANSFER_BYTES end
    return math.min(MAX_TRANSFER_BYTES, math.ceil(size * SIZE_MARGIN) + SIZE_SLACK_BYTES)
end

return TransferPolicy
