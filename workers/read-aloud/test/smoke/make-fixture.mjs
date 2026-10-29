// Builds the smoke-test book at test time: a three-chapter EPUB 3 with front matter, and its
// narration spoken by macOS `say`, one MP3 per chapter. Chapter two is a VBR MP3 so the run also
// covers STAlign's VBR to CBR re-encode. Nothing here is tracked; the caller passes a temp folder.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const CHAPTERS = [
  {
    title: "Chapter One: The Lighthouse Keeper",
    paragraphs: [
      "Mara had kept the lighthouse on the northern point for eleven winters. Each evening she climbed the narrow stairs, counted the steps aloud, and trimmed the wick before the sun touched the water.",
      "The ships that passed never knew her name, but they knew her light. On the night of the great storm, the wind tore the shutters from the lower windows and the sea climbed higher than she had ever seen it.",
      "Still she climbed, and still she counted, and the lamp burned steady until morning.",
    ],
  },
  {
    title: "Chapter Two: The Letter",
    paragraphs: [
      "In the spring a letter arrived with the supply boat. It was written in a careful hand and sealed with green wax.",
      "The sender was a young sailor who had seen her light during the storm and had steered his small boat safely into the harbor. He wrote that he had no way to repay her, except to say thank you, and to promise that he would keep a light burning in his own window for anyone lost at sea.",
      "Mara read the letter twice, then placed it on the shelf beside the oil lamps.",
    ],
  },
  {
    title: "Chapter Three: The Visitor",
    paragraphs: [
      "Many years later, an old man walked along the cliff path and knocked on the lighthouse door. He carried a lantern, though it was the middle of the day.",
      "Mara did not recognize his face, but she recognized the green wax on the letter he held out to her. They sat together in the small kitchen and drank tea while the gulls cried outside.",
      "When the sun went down, they climbed the stairs together, counting each step aloud, and lit the lamp side by side.",
    ],
  },
];

const TITLE = "The Keeper of the Northern Light";

/** Returns the EPUB path and the MP3 paths in listening order. */
export function makeFixture(directory) {
  const book = join(directory, "library", "Anonymous", TITLE);
  const build = join(directory, "build");
  mkdirSync(book, { recursive: true });
  mkdirSync(join(build, "META-INF"), { recursive: true });
  mkdirSync(join(build, "OEBPS"), { recursive: true });

  writeFileSync(join(build, "mimetype"), "application/epub+zip");
  writeFileSync(
    join(build, "META-INF", "container.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`,
  );
  writeFileSync(join(build, "OEBPS", "title.xhtml"), xhtml("Title", `<h1>${TITLE}</h1>\n<p>Anonymous</p>`));
  writeFileSync(
    join(build, "OEBPS", "nav.xhtml"),
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en">
<head><title>Contents</title></head>
<body><nav epub:type="toc" id="toc"><ol>
${CHAPTERS.map((chapter, index) => `<li><a href="chapter-${index + 1}.xhtml">${chapter.title}</a></li>`).join("\n")}
</ol></nav></body>
</html>
`,
  );
  for (const [index, chapter] of CHAPTERS.entries()) {
    const body = [`<h1>${chapter.title}</h1>`, ...chapter.paragraphs.map((text) => `<p>${text}</p>`)].join("\n");
    writeFileSync(join(build, "OEBPS", `chapter-${index + 1}.xhtml`), xhtml(chapter.title, body));
  }
  writeFileSync(
    join(build, "OEBPS", "content.opf"),
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="en">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:5d0a3c1e-7b7e-4c1a-9d43-2f1e8f0a6b21</dc:identifier>
    <dc:title>${TITLE}</dc:title>
    <dc:creator>Anonymous</dc:creator>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>
${CHAPTERS.map((_, index) => `    <item id="chapter-${index + 1}" href="chapter-${index + 1}.xhtml" media-type="application/xhtml+xml"/>`).join("\n")}
  </manifest>
  <spine>
    <itemref idref="title"/>
${CHAPTERS.map((_, index) => `    <itemref idref="chapter-${index + 1}"/>`).join("\n")}
  </spine>
</package>
`,
  );
  const epubPath = join(book, `${TITLE}.epub`);
  execFileSync("zip", ["-X0q", epubPath, "mimetype"], { cwd: build });
  execFileSync("zip", ["-Xr9Dq", epubPath, "META-INF", "OEBPS"], { cwd: build });

  const audioPaths = [];
  for (const [index, chapter] of CHAPTERS.entries()) {
    const textPath = join(build, `chapter-${index + 1}.txt`);
    const aiffPath = join(build, `chapter-${index + 1}.aiff`);
    writeFileSync(textPath, [chapter.title, ...chapter.paragraphs].join("\n\n"));
    execFileSync("say", ["-r", "175", "-o", aiffPath, "-f", textPath]);
    const mp3Path = join(book, `${String(index + 1).padStart(2, "0")} - ${chapter.title.split(":")[0]}.mp3`);
    const quality = index === 1 ? ["-q:a", "4"] : ["-b:a", "64k"];
    execFileSync("ffmpeg", [
      "-nostdin",
      "-loglevel",
      "error",
      "-y",
      "-i",
      aiffPath,
      "-ar",
      "44100",
      "-ac",
      "1",
      "-c:a",
      "libmp3lame",
      ...quality,
      mp3Path,
    ]);
    audioPaths.push(mp3Path);
  }
  return { epubPath, audioPaths, libraryRoot: join(directory, "library") };
}

function xhtml(title, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en">
<head><title>${title}</title></head>
<body>
${body}
</body>
</html>
`;
}
