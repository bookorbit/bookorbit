-- Proves the origin record stays bounded, publishes atomically, refuses every
-- validator it could not compare later, and authorizes a resume only when the
-- server, the account, the file, the representation and the length all still
-- match what the interrupted attempt was writing under.

package.path = "koreader-plugin/bookorbit.koplugin/?.lua;" .. package.path

local ResumeOrigin = require("bookorbit_resume_origin")

local function assertEqual(actual, expected, label)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", label, tostring(expected), tostring(actual)))
    end
end

local origin = {
    url = "https://books.example.com/api/v1/koreader/catalog/files/1287/download",
    username = "reader",
    validator = '"1a2b-3c4d"',
    total = 4194304,
}

assertEqual(ResumeOrigin.path("/tmp/bo_rf1287.part"), "/tmp/bo_rf1287.part.origin",
    "the record is named after the partial it describes")

local encoded = ResumeOrigin.encode(origin)
assertEqual(#encoded <= ResumeOrigin.MAX_RECORD_BYTES, true, "a record stays bounded")
assertEqual(encoded:sub(-1), "\n", "a record is one line")

local decoded = ResumeOrigin.decode(encoded)
assertEqual(decoded.total, 4194304, "total round-trips")
assertEqual(decoded.validator, '"1a2b-3c4d"', "validator round-trips")
assertEqual(ResumeOrigin.matches(decoded, origin), true, "an unchanged origin authorizes a resume")

-- A quoted ETag may carry spaces, so the validator is the last field and takes
-- whatever is left of the line rather than a single token.
local spaced = ResumeOrigin.decode(ResumeOrigin.encode({
    url = origin.url, username = origin.username, validator = '"1a 2b"', total = 26,
}))
assertEqual(spaced.validator, '"1a 2b"', "a validator containing spaces round-trips")

-- No earlier field may, so anything that would break the line is escaped into
-- one token instead of splitting into two.
local awkward = ResumeOrigin.decode(ResumeOrigin.encode({
    url = origin.url, username = "two words", validator = '"1a-2b"', total = 26,
}))
assertEqual(awkward ~= nil, true, "a username with a space still produces a readable record")
assertEqual(ResumeOrigin.matches(awkward, {
    url = origin.url, username = "two words", validator = '"1a-2b"', total = 26,
}), true, "an escaped field compares as itself")
assertEqual(ResumeOrigin.matches(awkward, {
    url = origin.url, username = "two%20words", validator = '"1a-2b"', total = 26,
}), false, "escaping cannot be forged by writing the escape out")

assertEqual(ResumeOrigin.decode(nil), nil, "a missing record decodes to nothing")
assertEqual(ResumeOrigin.decode(""), nil, "an empty record decodes to nothing")
assertEqual(ResumeOrigin.decode("garbage"), nil, "a malformed record decodes to nothing")
assertEqual(ResumeOrigin.decode('bookorbit-resume 99 26 u r "1a-2b"'), nil,
    "an unknown version decodes to nothing")
assertEqual(ResumeOrigin.decode('bookorbit-progress 1 26 u r "1a-2b"'), nil,
    "another module's record decodes to nothing")
assertEqual(ResumeOrigin.decode(string.rep("x", ResumeOrigin.MAX_RECORD_BYTES + 1)), nil,
    "an oversized record decodes to nothing")

-- Half a line is what a crash mid-write leaves. It must read as no record at
-- all, because a record is a claim about bytes that are still on disk.
assertEqual(ResumeOrigin.decode(encoded:sub(1, 20)), nil, "a truncated record decodes to nothing")

-- Only a strong validator says the bytes below the offset are the bytes the
-- server would send now, and only one that survives the round trip can be
-- compared on the next attempt.
local function encodesValidator(validator)
    return ResumeOrigin.encode({
        url = origin.url, username = origin.username, validator = validator, total = 26,
    }) ~= nil
end
assertEqual(encodesValidator('W/"1a-2b"'), false, "a weak validator is not recorded")
assertEqual(encodesValidator("1a-2b"), false, "an unquoted validator is not recorded")
assertEqual(encodesValidator('"1a-2b'), false, "a half-quoted validator is not recorded")
assertEqual(encodesValidator('"1a\n2b"'), false, "a validator holding a newline is not recorded")
assertEqual(encodesValidator(string.rep("x", ResumeOrigin.MAX_VALIDATOR_BYTES + 1)), false,
    "an oversized validator is not recorded")
assertEqual(encodesValidator(nil), false, "an absent validator is not recorded")
assertEqual(ResumeOrigin.decode('bookorbit-resume 1 26 u r W/"1a-2b"'), nil,
    "a weak validator is refused on the way back in too")

assertEqual(ResumeOrigin.encode({ url = origin.url, username = "r", validator = '"1a-2b"', total = 0 }), nil,
    "a zero length is not recorded")
assertEqual(ResumeOrigin.encode({ url = origin.url, username = "r", validator = '"1a-2b"' }), nil,
    "a missing length is not recorded")
assertEqual(ResumeOrigin.encode({
    url = string.rep("u", ResumeOrigin.MAX_RECORD_BYTES), username = "r", validator = '"1a-2b"', total = 26,
}), nil, "a record that would not fit is not written at all")

-- Every part of the origin has to hold. The temporary file is named after the
-- file id alone, so the server and the account are exactly what its name does
-- not carry.
local function matchesWith(changes)
    local expected = {}
    for key, value in pairs(origin) do expected[key] = value end
    for key, value in pairs(changes) do expected[key] = value end
    return ResumeOrigin.matches(decoded, expected)
end
assertEqual(matchesWith({ validator = '"other"' }), false, "a rewritten representation authorizes nothing")
assertEqual(matchesWith({ total = 26 }), false, "a length that moved authorizes nothing")
assertEqual(matchesWith({ url = origin.url .. "x" }), false, "another file authorizes nothing")
assertEqual(matchesWith({ url = "https://other.example.com/api/v1" }), false, "another server authorizes nothing")
assertEqual(matchesWith({ username = "someone" }), false, "another account authorizes nothing")
assertEqual(ResumeOrigin.matches(nil, origin), false, "no record authorizes nothing")
assertEqual(ResumeOrigin.matches(decoded, { url = origin.url, username = "reader", total = 4194304 }), false,
    "a probe that produced no validator authorizes nothing")

-- Records land on a temporary file and become visible through a rename, so a
-- resuming attempt can never read a half-written claim.
local store = {}
local renames = 0
local function stubbedStore()
    return {
        write = function(content, path)
            store[path] = content
            return true
        end,
        rename = function(from, to)
            renames = renames + 1
            store[to] = store[from]
            store[from] = nil
            return true
        end,
        remove = function(path) store[path] = nil end,
        read = function(path) return store[path] end,
    }
end

local io_stub = stubbedStore()
assertEqual(ResumeOrigin.save("/tmp/spec.part", origin, io_stub), true, "a valid record saves")
assertEqual(store["/tmp/spec.part.origin"] ~= nil, true, "the record is visible under its final name")
assertEqual(store["/tmp/spec.part.origin.tmp"], nil, "no temporary file is left behind")
assertEqual(renames, 1, "publishing uses a rename")
assertEqual(ResumeOrigin.load("/tmp/spec.part", io_stub).validator, '"1a2b-3c4d"', "the saved record loads back")

assertEqual(ResumeOrigin.save("/tmp/spec.part", { url = "u", username = "r", total = 26 }, io_stub), false,
    "a record that cannot be encoded is not written")

ResumeOrigin.cleanup("/tmp/spec.part", io_stub)
assertEqual(store["/tmp/spec.part.origin"], nil, "cleanup removes the record")
assertEqual(ResumeOrigin.load("/tmp/spec.part", io_stub), nil, "a removed record loads as nothing")

-- A publish that fails halfway must leave nothing readable, or the next attempt
-- would compare against a claim no partial ever backed.
local failing = stubbedStore()
failing.rename = function() return nil, "injected" end
assertEqual(ResumeOrigin.save("/tmp/spec2.part", origin, failing), false, "a failed publish reports failure")
assertEqual(store["/tmp/spec2.part.origin"], nil, "a failed publish leaves nothing visible")
assertEqual(store["/tmp/spec2.part.origin.tmp"], nil, "a failed publish removes its temporary file")

-- A short write is what a full disk leaves. Publishing it would rename a
-- truncated claim into the place a later attempt reads as authoritative.
local short = stubbedStore()
short.write = function(_, path)
    store[path] = "bookorbit-res"
    return nil, "no space left on device"
end
assertEqual(ResumeOrigin.save("/tmp/spec3.part", origin, short), false, "a failed write reports failure")
assertEqual(store["/tmp/spec3.part.origin"], nil, "a failed write publishes nothing")
assertEqual(store["/tmp/spec3.part.origin.tmp"], nil, "a failed write removes what it did manage to write")

-- Lua's os.rename refuses an existing destination on Windows. Refreshing a
-- record has to work there too, or a record ages out of the stale sweep under a
-- partial that is still being filled.
local windows = stubbedStore()
local posix_rename = windows.rename
windows.rename = function(from, to)
    if store[to] ~= nil then return nil, "destination exists" end
    return posix_rename(from, to)
end
assertEqual(ResumeOrigin.save("/tmp/spec4.part", origin, windows), true, "a first publish succeeds")
assertEqual(ResumeOrigin.save("/tmp/spec4.part", origin, windows), true, "a record can be refreshed in place")
assertEqual(ResumeOrigin.load("/tmp/spec4.part", windows).validator, '"1a2b-3c4d"',
    "the refreshed record still reads back")
assertEqual(store["/tmp/spec4.part.origin.tmp"], nil, "refreshing leaves no temporary file behind")

print("bookorbit_resume_origin_test.lua: ok")
