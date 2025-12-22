import { Injectable } from '@nestjs/common';

import { LibraryRepository } from './library.repository';

@Injectable()
export class LibraryService {
  constructor(private readonly libraryRepo: LibraryRepository) {}

  findAll() {
    return this.libraryRepo.findAll();
  }
}
