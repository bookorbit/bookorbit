import { authorRefsFromAutocomplete, parseGoodreadsAuthorPage, parseGoodreadsAuthorSearch } from './goodreads-author.scraper';

// Mirrors the real page: free-text values are rendered twice, once truncated
// for display and once in full behind the "...more" expander.
function authorPage(options?: { photo?: string; died?: boolean; noAbout?: boolean }): string {
  const photo = options?.photo ?? 'https://images.gr-assets.com/authors/1244291425p5/874602.jpg';
  return `
    <div class="authorLeftContainer">
      <img itemprop="image" src="${photo}" />
    </div>
    <h1 class="authorName"><span itemprop="name">Ursula K. Le Guin</span></h1>
    ${
      options?.noAbout
        ? ''
        : `<div class="aboutAuthorInfo">
             <span id="freeTextContainer1">Truncated preview of the bio</span>
             <span id="freeText1">The complete biography, which is meaningfully longer than the preview.</span>
           </div>`
    }
    <div class="dataTitle">Born</div>
    <div class="dataItem">October 21, 1929</div>
    ${options?.died === false ? '' : '<div class="dataTitle">Died</div><div class="dataItem">January 22, 2018</div>'}
    <div class="dataTitle">Website</div>
    <div class="dataItem"><a href="http://www.ursulakleguin.com/">http://www.ursulakleguin.com/</a></div>
    <div class="dataTitle">Genre</div>
    <div class="dataItem"><a href="/genres/fantasy">Science Fiction &amp; Fantasy</a>, <a href="/genres/ya">Young Adult</a></div>
    <div class="dataTitle">Influences</div>
    <div class="dataItem">
      <span id="freeTextContainer2"><a href="/author/show/1">J.R.R. Tolkien</a>, <a href="/author/show/2">Phil</a></span>
      <span id="freeText2"><a href="/author/show/1">J.R.R. Tolkien</a>, <a href="/author/show/2">Philip K. Dick</a></span>
      <a href="#" onclick="return false;">...more</a>
    </div>
    <div class="followerWidget"><a href="/author/show/999.Someone_Else">Someone Else</a></div>
  `;
}

describe('parseGoodreadsAuthorPage', () => {
  it('extracts the full record from an author page', () => {
    const parsed = parseGoodreadsAuthorPage(authorPage());

    expect(parsed).toMatchObject({
      name: 'Ursula K. Le Guin',
      imageUrl: 'https://images.gr-assets.com/authors/1244291425p5/874602.jpg',
      birthDate: '1929-10-21',
      birthYear: 1929,
      deathDate: '2018-01-22',
      deathYear: 2018,
      website: 'http://www.ursulakleguin.com/',
      genres: ['Science Fiction & Fantasy', 'Young Adult'],
    });
  });

  it('takes the complete biography rather than the truncated preview', () => {
    const parsed = parseGoodreadsAuthorPage(authorPage());

    expect(parsed?.description).toBe('The complete biography, which is meaningfully longer than the preview.');
  });

  it('takes influences from the full list and drops the expander link', () => {
    const parsed = parseGoodreadsAuthorPage(authorPage());

    // "Phil" is the truncated rendering of "Philip K. Dick"; reading the
    // container instead of a single span would return both.
    expect(parsed?.influences).toEqual(['J.R.R. Tolkien', 'Philip K. Dick']);
    expect(parsed?.influences).not.toContain('...more');
  });

  it('ignores the placeholder avatar Goodreads serves for authors with no photo', () => {
    const parsed = parseGoodreadsAuthorPage(
      authorPage({ photo: 'https://s.gr-assets.com/assets/nophoto/user/f_25x33-d79c46f9428d2aea1444d67c091766a6.png' }),
    );

    expect(parsed?.imageUrl).toBeUndefined();
  });

  it('leaves death fields unset for a living author', () => {
    const parsed = parseGoodreadsAuthorPage(authorPage({ died: false }));

    expect(parsed?.deathDate).toBeUndefined();
    expect(parsed?.deathYear).toBeUndefined();
    expect(parsed?.birthYear).toBe(1929);
  });

  it('returns a record without a description when the author has no bio', () => {
    const parsed = parseGoodreadsAuthorPage(authorPage({ noAbout: true }));

    expect(parsed?.name).toBe('Ursula K. Le Guin');
    expect(parsed?.description).toBeUndefined();
  });

  it('returns null when the page carries no author name', () => {
    expect(parseGoodreadsAuthorPage('<html><body>blocked</body></html>')).toBeNull();
    expect(parseGoodreadsAuthorPage('')).toBeNull();
  });
});

describe('parseGoodreadsAuthorSearch', () => {
  it('reads author ids and names from result links, de-duplicating repeats', () => {
    const html = `
      <a href="/author/show/874602.Ursula_K_Le_Guin?from_search=true">Ursula K. Le Guin</a>
      <a href="/author/show/874602.Ursula_K_Le_Guin">again</a>
      <a href="/author/show/19392106.S_D_Schindler">S. D. Schindler</a>
    `;

    expect(parseGoodreadsAuthorSearch(html)).toEqual([
      { providerId: '874602', name: 'Ursula K Le Guin' },
      { providerId: '19392106', name: 'S D Schindler' },
    ]);
  });

  it('skips links with no name slug', () => {
    expect(parseGoodreadsAuthorSearch('<a href="/author/show/123">no slug</a>')).toEqual([]);
  });
});

describe('authorRefsFromAutocomplete', () => {
  it('collects distinct authors from book rows', () => {
    const refs = authorRefsFromAutocomplete([
      { author: { id: 874602, name: 'Ursula K. Le Guin' } },
      { author: { id: 874602, name: 'Ursula K. Le Guin' } },
      { author: { id: '130698', name: 'Ted Chiang' } },
      { author: { name: 'Missing id' } },
      {},
    ]);

    expect(refs).toEqual([
      { providerId: '874602', name: 'Ursula K. Le Guin' },
      { providerId: '130698', name: 'Ted Chiang' },
    ]);
  });

  it('handles an empty or missing payload', () => {
    expect(authorRefsFromAutocomplete([])).toEqual([]);
    expect(authorRefsFromAutocomplete(null)).toEqual([]);
  });
});
