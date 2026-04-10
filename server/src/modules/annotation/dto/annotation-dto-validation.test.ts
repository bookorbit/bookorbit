import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateAnnotationDto } from './create-annotation.dto';
import { UpdateAnnotationDto } from './update-annotation.dto';

async function errorsFor<T extends object>(cls: new () => T, value: Record<string, unknown>) {
  const dto = plainToInstance(cls, value);
  return validate(dto);
}

describe('Annotation DTO validation', () => {
  it('accepts create payload with optional fields and valid style', async () => {
    const errors = await errorsFor(CreateAnnotationDto, {
      cfi: 'epubcfi(/6/4!/4/2/1:0)',
      text: 'Selected text',
      color: '#FACC15',
      style: 'underline',
      note: 'reader note',
      chapterTitle: 'Chapter 1',
    });

    expect(errors).toHaveLength(0);
  });

  it('rejects invalid create payload boundaries', async () => {
    expect((await errorsFor(CreateAnnotationDto, { cfi: '', text: 'ok' })).length).toBeGreaterThan(0);
    expect((await errorsFor(CreateAnnotationDto, { cfi: 'x', text: '' })).length).toBeGreaterThan(0);
    expect((await errorsFor(CreateAnnotationDto, { cfi: 'x', text: 'ok', color: 'x'.repeat(21) })).length).toBeGreaterThan(0);
    expect((await errorsFor(CreateAnnotationDto, { cfi: 'x', text: 'ok', style: 'invalid' })).length).toBeGreaterThan(0);
    expect((await errorsFor(CreateAnnotationDto, { cfi: 'x', text: 'ok', chapterTitle: 'x'.repeat(501) })).length).toBeGreaterThan(0);
  });

  it('accepts update payload with nullable note and optional style', async () => {
    const nullNoteErrors = await errorsFor(UpdateAnnotationDto, { note: null, style: 'highlight' });
    const normalErrors = await errorsFor(UpdateAnnotationDto, { note: 'updated', color: '#38BDF8' });

    expect(nullNoteErrors).toHaveLength(0);
    expect(normalErrors).toHaveLength(0);
  });

  it('rejects invalid update payload types', async () => {
    expect((await errorsFor(UpdateAnnotationDto, { note: 123 })).length).toBeGreaterThan(0);
    expect((await errorsFor(UpdateAnnotationDto, { color: 'x'.repeat(21) })).length).toBeGreaterThan(0);
    expect((await errorsFor(UpdateAnnotationDto, { style: 'invalid' })).length).toBeGreaterThan(0);
  });
});
