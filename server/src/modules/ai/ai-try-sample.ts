import type { JsonSchema } from './ai-client.types';

/**
 * The opening of Pride and Prejudice (Jane Austen, 1813, public domain). Try it runs a small
 * story-guide step on it, so an admin can judge a model before spending on a real book.
 */
export const AI_TRY_PASSAGE = `It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.

However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered the rightful property of some one or other of their daughters.

"My dear Mr. Bennet," said his lady to him one day, "have you heard that Netherfield Park is let at last?"

Mr. Bennet replied that he had not.

"But it is," returned she; "for Mrs. Long has just been here, and she told me all about it."

Mr. Bennet made no answer.

"Do you not want to know who has taken it?" cried his wife impatiently.

"You want to tell me, and I have no objection to hearing it."

This was invitation enough.

"Why, my dear, you must know, Mrs. Long says that Netherfield is taken by a young man of large fortune from the north of England; that he came down on Monday in a chaise and four to see the place, and was so much delighted with it, that he agreed with Mr. Morris immediately; that he is to take possession before Michaelmas, and some of his servants are to be in the house by the end of next week."

"What is his name?"

"Bingley."

"Is he married or single?"

"Oh! Single, my dear, to be sure! A single man of large fortune; four or five thousand a year. What a fine thing for our girls!"

"How so? How can it affect them?"

"My dear Mr. Bennet," replied his wife, "how can you be so tiresome! You must know that I am thinking of his marrying one of them."

"Is that his design in settling here?"

"Design! Nonsense, how can you talk so! But it is very likely that he may fall in love with one of them, and therefore you must visit him as soon as he comes."

"I see no occasion for that. You and the girls may go, or you may send them by themselves, which perhaps will be still better, for as you are as handsome as any of them, Mr. Bingley may like you the best of the party."

"My dear, you flatter me. I certainly have had my share of beauty, but I do not pretend to be anything extraordinary now. When a woman has five grown-up daughters, she ought to give over thinking of her own beauty."

"In such cases, a woman has not often much beauty to think of."

"But, my dear, you must indeed go and see Mr. Bingley when he comes into the neighbourhood."

"It is more than I engage for, I assure you."

"But consider your daughters. Only think what an establishment it would be for one of them. Sir William and Lady Lucas are determined to go, merely on that account, for in general, you know, they visit no newcomers. Indeed you must go, for it will be impossible for us to visit him if you do not."

"You are over-scrupulous, surely. I dare say Mr. Bingley will be very glad to see you; and I will send a few lines by you to assure him of my hearty consent to his marrying whichever he chooses of the girls; though I must throw in a good word for my little Lizzy."

"I desire you will do no such thing. Lizzy is not a bit better than the others; and I am sure she is not half so handsome as Jane, nor half so good-humoured as Lydia. But you are always giving her the preference."`;

export const AI_TRY_KINDS = ['person', 'place', 'group', 'thing'] as const;

export const AI_TRY_SYSTEM = `You build a reader's guide to the people and places in a novel. From the passage, list every named character and named place, and any named group or object that matters to the story. Use the name as the passage writes it; when one character is called several ways, list them once under the fullest name. Describe each in one short sentence using only what this passage says, without spoilers from later in the book.`;

export const AI_TRY_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    names: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          kind: { type: 'string', enum: [...AI_TRY_KINDS] },
          description: { type: 'string' },
        },
        required: ['name', 'kind', 'description'],
        additionalProperties: false,
      },
    },
  },
  required: ['names'],
  additionalProperties: false,
};

/** Room for a reasoning model to think and still answer; a reply cut short is retried with double. */
export const AI_TRY_MAX_OUTPUT_TOKENS = 4000;

/** The connection test's request: small, and any model that can do the real work can do this. */
export const AI_TEST_SYSTEM = 'You are checking that a connection works. Follow the instructions exactly.';
export const AI_TEST_USER = 'Reply with a JSON object whose "ok" is true and whose "word" is "orbit".';
export const AI_TEST_SCHEMA: JsonSchema = {
  type: 'object',
  properties: { ok: { type: 'boolean' }, word: { type: 'string' } },
  required: ['ok', 'word'],
  additionalProperties: false,
};
export const AI_TEST_MAX_OUTPUT_TOKENS = 1024;

/** The connection test's picture row: reading any title in the drawn covers passes. */
export const AI_IMAGE_TEST_USER = 'List the title of each book in this picture.';
export const AI_IMAGE_TEST_SCHEMA: JsonSchema = {
  type: 'object',
  properties: { titles: { type: 'array', items: { type: 'string' } } },
  required: ['titles'],
  additionalProperties: false,
};
