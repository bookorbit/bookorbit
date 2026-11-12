# foliate-js

The parts of [foliate-js](https://github.com/johnfactotum/foliate-js) the story guide text reader
needs: `epub.js`, `epubcfi.js`, `mobi.js`, `vendor/zip.js` and `vendor/fflate.js`. It is the copy
the BookOrbit app's reader ships, unchanged, because a story guide's anchors only land when the
server reads exactly the sections and text the reader opens.

- Update it only together with the app's copy, and bump the story guide extraction version
  (`server/src/modules/story-guides/text/extraction-version.ts`) when the text can change.
- `checksums.json` lists the SHA-256 of each file. A server test fails when a file changes without
  it, so an update is always deliberate.
- Licences: foliate-js is MIT (`LICENSE`), zip.js is BSD-3-Clause and fflate is MIT.
