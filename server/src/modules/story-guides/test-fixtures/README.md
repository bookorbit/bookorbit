# Story guide fixtures

A Study in Scarlet by Arthur Conan Doyle (1887), Project Gutenberg eBook #244, as Gutenberg's own
EPUB 3, Kindle KF8 (`.azw3`) and older Kindle MOBI6 (`.mobi`) files. The text is in the public
domain; each file keeps Project Gutenberg's licence section unchanged, as its licence asks.

- `expected/<file>.json.gz`: per section, the text the app's reader index reads (`index`,
  `linear`, `length` in UTF-16 code units, `blocks`, `hash` and `text`). The app keeps the same
  files, so a reader on either side that drifts fails a test.
- `public-domain/a-study-in-scarlet.steps.json.gz`: every step's output from one run of the
  reference pipeline (GPT-6 Luna at medium effort for the steps, GPT-6.1 Terra for the review),
  for the step tests. Offsets in it are into that pipeline's own text, not the reader's.
- `public-domain/a-study-in-scarlet.hand.json`: every tie the opening chapters state, each with
  its quote, checked by hand against the book.

This is the server's whole public-domain set: one first-person novel.
