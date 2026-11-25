--[[
The plural rule of every shipped catalog, keyed by its file name: the code of
KOReader's own catalog for that language (es, ru, pt_BR...).

plural_forms is the catalog's Plural-Forms header, character for character;
forms is its nplurals; plural(n) returns the form index the header's formula
gives for n, written in Lua so no catalog text is ever run as code. The CI
catalog check fails when a catalog has no entry here or its header differs.

A catalog copied onto a device without an entry here still loads; its plurals
then follow KOReader's rule for the language.
]]

return {
    es = {
        forms = 2,
        plural_forms = "nplurals=2; plural=n != 1;",
        plural = function(n) return n ~= 1 and 1 or 0 end,
    },
    ru = {
        forms = 4,
        plural_forms = "nplurals=4; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<12 || n%100>14) ? 1 : n%10==0 || (n%10>=5 && n%10<=9) || (n%100>=11 && n%100<=14)? 2 : 3);",
        plural = function(n)
            if n % 10 == 1 and n % 100 ~= 11 then return 0 end
            if n % 10 >= 2 and n % 10 <= 4 and (n % 100 < 12 or n % 100 > 14) then return 1 end
            if n % 10 == 0 or (n % 10 >= 5 and n % 10 <= 9) or (n % 100 >= 11 and n % 100 <= 14) then return 2 end
            return 3
        end,
    },
}
