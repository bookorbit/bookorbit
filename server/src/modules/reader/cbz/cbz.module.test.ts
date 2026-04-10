import 'reflect-metadata';

vi.mock('../../book/book.module', () => ({ BookModule: class BookModule {} }));

import { BookModule } from '../../book/book.module';
import { CbzController } from './cbz.controller';
import { CbzModule } from './cbz.module';
import { CbzService } from './cbz.service';

describe('CbzModule', () => {
  it('registers expected imports/controllers/providers', () => {
    expect(Reflect.getMetadata('imports', CbzModule)).toEqual([BookModule]);
    expect(Reflect.getMetadata('controllers', CbzModule)).toEqual([CbzController]);
    expect(Reflect.getMetadata('providers', CbzModule)).toEqual([CbzService]);
  });
});
