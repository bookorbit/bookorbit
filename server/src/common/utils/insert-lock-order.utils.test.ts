import { inNameOrder } from './insert-lock-order.utils';

describe('inNameOrder', () => {
  it('puts the same names in the same order whatever order they arrive in', () => {
    const first = inNameOrder([{ name: 'Fiction' }, { name: 'Classics' }, { name: 'adventure' }]);
    const second = inNameOrder([{ name: 'adventure' }, { name: 'Fiction' }, { name: 'Classics' }]);

    expect(first.map((row) => row.name)).toEqual(second.map((row) => row.name));
    expect(first.map((row) => row.name)).toEqual(['Classics', 'Fiction', 'adventure']);
  });

  it('keeps the other fields with their row and leaves the input untouched', () => {
    const rows = [
      { name: 'Twain, Mark', sortName: 'Twain' },
      { name: 'Austen, Jane', sortName: 'Austen' },
    ];

    expect(inNameOrder(rows)).toEqual([
      { name: 'Austen, Jane', sortName: 'Austen' },
      { name: 'Twain, Mark', sortName: 'Twain' },
    ]);
    expect(rows[0]!.name).toBe('Twain, Mark');
  });
});
