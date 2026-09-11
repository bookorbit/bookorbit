--[[--
Origin record for the bytes sitting in a partial transfer.

A Range request proves nothing on its own. The validator a resuming client
sends in If-Range is obtained at resume time, so if the remote file changed
while the transfer was interrupted, the server answers with the new file's
validator, the precondition matches trivially, and new bytes are appended to
old ones. The result is a file that publishes as complete and opens.

Closing that requires knowing which representation the bytes on disk came from,
which is a fact only the interrupted attempt held. This module persists it
next to the temporary file, as one bounded line published with an atomic
rename, so a half-written record reads as no record at all.

The guarantee rests on write ordering: the record is written before the first
byte of an attempt lands. A record beside a partial then means every byte in
that partial was received under the representation it names. Recording after
the fact would launder corruption instead, certifying a prefix of unknown
provenance that every later resume compares clean.

Absence of a record is the migration path and needs no format bump: a partial
nobody vouched for is discarded and downloaded again.
]]

local MAGIC = "bookorbit-resume"
local VERSION = 1
local MAX_RECORD_BYTES = 512
local MAX_VALIDATOR_BYTES = 128
local MAX_TOTAL = 2 ^ 53

local ResumeOrigin = {}

ResumeOrigin.MAX_RECORD_BYTES = MAX_RECORD_BYTES
ResumeOrigin.MAX_VALIDATOR_BYTES = MAX_VALIDATOR_BYTES

function ResumeOrigin.path(temp_path)
    return tostring(temp_path or "") .. ".origin"
end

-- Collapses a value into one field of a space-delimited line. Percent-escaping
-- covers the escape character itself first, so decoding stays unambiguous.
local function token(value)
    return (tostring(value or ""):gsub("[%%%s%c]", function(character)
        return string.format("%%%02X", string.byte(character))
    end))
end

-- Only a strong validator says the bytes below the offset are the bytes the
-- server would send now, and only one that survives a round trip through the
-- record can be compared later. Anything else authorizes no resume.
local function isUsableValidator(validator)
    return type(validator) == "string"
        and #validator >= 2
        and #validator <= MAX_VALIDATOR_BYTES
        and validator:sub(1, 1) == '"'
        and validator:sub(-1) == '"'
        and validator:find("%c") == nil
end

local function usableTotal(value)
    local total = tonumber(value)
    if not total or total ~= total or total <= 0 or total >= MAX_TOTAL then return nil end
    return math.floor(total)
end

-- record: url, username, validator, total. The validator goes last because a
-- quoted ETag may contain spaces, which no earlier field may.
function ResumeOrigin.encode(record)
    record = record or {}
    local total = usableTotal(record.total)
    if not total or not isUsableValidator(record.validator) then return nil end
    local line = string.format("%s %d %d %s %s %s\n",
        MAGIC,
        VERSION,
        total,
        token(record.url),
        token(record.username),
        record.validator)
    if #line > MAX_RECORD_BYTES then return nil end
    return line
end

-- The url and username come back as the escaped tokens rather than the
-- original values. Nothing needs to read them, only to compare them, and
-- comparing tokens keeps a decoder bug from turning into a false match.
function ResumeOrigin.decode(text)
    if type(text) ~= "string" or text == "" or #text > MAX_RECORD_BYTES then return nil end
    local magic, version, total, url, username, validator =
        text:match("^(%S+) (%d+) (%d+) (%S+) (%S+) (.-)%s*$")
    if magic ~= MAGIC or tonumber(version) ~= VERSION then return nil end
    total = usableTotal(total)
    if not total or not isUsableValidator(validator) then return nil end
    return { total = total, url = url, username = username, validator = validator }
end

-- A resume is authorized only when every part of the origin still holds: same
-- server and account, same file, same representation, same length. The URL
-- carries the file identity, which the temporary file's own name does not:
-- resume keys are derived from the file id alone, so without this a different
-- server or account would continue into a foreign partial.
function ResumeOrigin.matches(record, expected)
    if type(record) ~= "table" or type(expected) ~= "table" then return false end
    if not isUsableValidator(expected.validator) then return false end
    return record.validator == expected.validator
        and record.total == usableTotal(expected.total)
        and record.url == token(expected.url)
        and record.username == token(expected.username)
end

local function defaultWrite(content, path)
    local handle, err = io.open(path, "w")
    if not handle then return nil, tostring(err or "open_failed") end
    local written, write_err = handle:write(content)
    handle:close()
    if not written then return nil, tostring(write_err or "write_failed") end
    return true
end

local function defaultRead(path)
    local handle = io.open(path, "r")
    if not handle then return nil end
    local content = handle:read(MAX_RECORD_BYTES + 1)
    handle:close()
    return content
end

-- Rewriting an unchanged record is what keeps its timestamp moving with the
-- partial it describes; otherwise it ages out of the stale sweep under a
-- temporary file that is still being filled.
function ResumeOrigin.save(temp_path, record, opts)
    opts = opts or {}
    local content = ResumeOrigin.encode(record)
    if not content then return false end
    local write = opts.write or defaultWrite
    local rename = opts.rename or os.rename
    local remove = opts.remove or os.remove
    local path = ResumeOrigin.path(temp_path)
    local temporary = path .. ".tmp"
    remove(temporary)
    if not write(content, temporary) then
        remove(temporary)
        return false
    end
    if not rename(temporary, path) then
        -- POSIX replaces the destination in one step. Windows' rename refuses an
        -- existing file, so it takes the two step path, where it had no
        -- atomicity to lose anyway.
        remove(path)
        if not rename(temporary, path) then
            remove(temporary)
            return false
        end
    end
    return true
end

function ResumeOrigin.load(temp_path, opts)
    opts = opts or {}
    return ResumeOrigin.decode((opts.read or defaultRead)(ResumeOrigin.path(temp_path)))
end

function ResumeOrigin.cleanup(temp_path, opts)
    opts = opts or {}
    local remove = opts.remove or os.remove
    local path = ResumeOrigin.path(temp_path)
    remove(path .. ".tmp")
    remove(path)
end

return ResumeOrigin
