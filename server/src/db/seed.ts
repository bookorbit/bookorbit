import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import { authors, bookAuthors, bookMetadata, books, libraryFolders, libraries } from './schema';

async function seed() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgres://projectx:projectx@postgres:5432/projectx',
  });
  const db = drizzle(pool, { schema });

  console.log('Clearing existing data...');
  await db.delete(bookAuthors);
  await db.delete(bookMetadata);
  await db.delete(books);
  await db.delete(authors);
  await db.delete(libraryFolders);
  await db.delete(libraries);

  console.log('Seeding library...');
  const [library] = await db.insert(libraries).values({ name: 'My Library', scanMode: 'manual' }).returning();

  const [folder] = await db.insert(libraryFolders).values({ libraryId: library.id, path: '/books' }).returning();

  console.log('Seeding authors...');
  const authorNames = [
    { name: 'Andy Weir', sortName: 'Weir, Andy' },
    { name: 'N.K. Jemisin', sortName: 'Jemisin, N.K.' },
    { name: 'Becky Chambers', sortName: 'Chambers, Becky' },
    { name: 'Liu Cixin', sortName: 'Liu, Cixin' },
  ];
  const insertedAuthors = await db.insert(authors).values(authorNames).returning();

  console.log('Seeding books...');
  const seedBooks = [
    { title: 'Project Hail Mary', authorIdx: 0, year: 2021 },
    { title: 'The Fifth Season', authorIdx: 1, year: 2015 },
    { title: 'A Long Way to a Small Angry Planet', authorIdx: 2, year: 2014 },
    { title: 'The Three-Body Problem', authorIdx: 3, year: 2008 },
  ];

  const BATCH = 500;
  const allBooks = seedBooks.map((b, i) => ({
    libraryId: library.id,
    libraryFolderId: folder.id,
    folderPath: `/books/${b.title.toLowerCase().replace(/\s+/g, '-')}`,
    status: 'present' as const,
  }));

  const insertedBooks: (typeof books.$inferSelect)[] = [];
  for (let i = 0; i < allBooks.length; i += BATCH) {
    const batch = await db
      .insert(books)
      .values(allBooks.slice(i, i + BATCH))
      .returning();
    insertedBooks.push(...batch);
  }

  const metaValues = seedBooks.map((b, i) => ({
    bookId: insertedBooks[i]!.id,
    title: b.title,
    publishedYear: b.year,
  }));
  await db.insert(bookMetadata).values(metaValues);

  const authorJoins = seedBooks.map((b, i) => ({
    bookId: insertedBooks[i]!.id,
    authorId: insertedAuthors[b.authorIdx]!.id,
    displayOrder: 0,
  }));
  await db.insert(bookAuthors).values(authorJoins);

  await pool.end();
  console.log(`Done. Seeded ${insertedBooks.length} books.`);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
