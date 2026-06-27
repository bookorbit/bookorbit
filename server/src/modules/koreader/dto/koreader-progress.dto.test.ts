import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SaveProgressDto } from './koreader-progress.dto';

const BASE = { document: 'abc123', percentage: 0.42 };

describe('SaveProgressDto', () => {
  it('accepts an xpointer string progress from reflowable documents', async () => {
    const dto = plainToInstance(SaveProgressDto, { ...BASE, progress: '/body/DocFragment[8]/body/p[12]/text().0' });
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.progress).toBe('/body/DocFragment[8]/body/p[12]/text().0');
  });

  it('coerces the numeric page progress sent for paged documents into a string', async () => {
    const dto = plainToInstance(SaveProgressDto, { ...BASE, progress: 42 });
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.progress).toBe('42');
  });

  it('keeps progress undefined when omitted', async () => {
    const dto = plainToInstance(SaveProgressDto, { ...BASE });
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.progress).toBeUndefined();
  });

  it('rejects progress values that are neither string nor number', async () => {
    const dto = plainToInstance(SaveProgressDto, { ...BASE, progress: true });
    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.property).toBe('progress');
  });
});
