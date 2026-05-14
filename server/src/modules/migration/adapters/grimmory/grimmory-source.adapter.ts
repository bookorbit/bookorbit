import { Injectable } from '@nestjs/common';

import { BookloreSourceAdapter } from '../booklore/booklore-source.adapter';

@Injectable()
export class GrimmorySourceAdapter extends BookloreSourceAdapter {
  override readonly type = 'grimmory';
}
