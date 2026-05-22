import type { RequestUser } from '../../common/types/request-user';
import { AnnotationController } from './annotation.controller';
import type { AnnotationQueryDto } from './dto/annotation-query.dto';
import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

function makeUser(overrides?: Partial<RequestUser>): RequestUser {
  return {
    id: 7,
    username: 'reader',
    name: 'Reader',
    email: null,
    active: true,
    isSuperuser: false,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: [],
    ...overrides,

    contentFilters: EMPTY_CONTENT_FILTER_RULES,
  };
}

function makeController() {
  const annotationService = {
    getAnnotations: vi.fn(),
    getAnnotationsPaginated: vi.fn(),
    createAnnotation: vi.fn(),
    updateAnnotation: vi.fn(),
    deleteAnnotation: vi.fn(),
  };

  return {
    controller: new AnnotationController(annotationService as never),
    annotationService,
  };
}

describe('AnnotationController', () => {
  it('delegates getAnnotations with bookId and current user when no page param', async () => {
    const { controller, annotationService } = makeController();
    const expected = [{ id: 1 }];
    annotationService.getAnnotations.mockResolvedValue(expected);
    const user = makeUser();
    const query: AnnotationQueryDto = {};

    const result = await controller.getAnnotations(15, user, query);

    expect(annotationService.getAnnotations).toHaveBeenCalledWith(15, user);
    expect(annotationService.getAnnotationsPaginated).not.toHaveBeenCalled();
    expect(result).toEqual(expected);
  });

  it('delegates getAnnotationsPaginated when page param is present', async () => {
    const { controller, annotationService } = makeController();
    const expected = { items: [], total: 0, page: 1, pageSize: 25, stats: {} };
    annotationService.getAnnotationsPaginated.mockResolvedValue(expected);
    const user = makeUser();
    const query: AnnotationQueryDto = { page: 1, pageSize: 25 };

    const result = await controller.getAnnotations(15, user, query);

    expect(annotationService.getAnnotationsPaginated).toHaveBeenCalledWith(15, user, query);
    expect(annotationService.getAnnotations).not.toHaveBeenCalled();
    expect(result).toEqual(expected);
  });

  it('passes filter params through to paginated service', async () => {
    const { controller, annotationService } = makeController();
    annotationService.getAnnotationsPaginated.mockResolvedValue({ items: [], total: 0 });
    const user = makeUser();
    const query: AnnotationQueryDto = {
      page: 2,
      pageSize: 10,
      sortBy: 'createdAt',
      sortDir: 'desc',
      colors: '#FACC15,#4ADE80',
      search: 'freedom',
      chapter: 'Chapter 1',
    };

    await controller.getAnnotations(15, user, query);

    expect(annotationService.getAnnotationsPaginated).toHaveBeenCalledWith(15, user, query);
  });

  it('delegates createAnnotation with dto payload', async () => {
    const { controller, annotationService } = makeController();
    const dto = { cfi: 'epubcfi(/6/4)', text: 'selected text', note: null };
    const user = makeUser();
    annotationService.createAnnotation.mockResolvedValue({ id: 9 });

    const result = await controller.createAnnotation(22, dto, user);

    expect(annotationService.createAnnotation).toHaveBeenCalledWith(22, user, dto);
    expect(result).toEqual({ id: 9 });
  });

  it('delegates updateAnnotation with route ids and patch dto', async () => {
    const { controller, annotationService } = makeController();
    const dto = { color: '#FACC15', style: 'underline' };
    const user = makeUser();
    annotationService.updateAnnotation.mockResolvedValue({ id: 9, color: '#FACC15' });

    const result = await controller.updateAnnotation(22, 9, dto, user);

    expect(annotationService.updateAnnotation).toHaveBeenCalledWith(22, 9, user, dto);
    expect(result).toEqual({ id: 9, color: '#FACC15' });
  });

  it('awaits deleteAnnotation and returns no content payload', async () => {
    const { controller, annotationService } = makeController();
    const user = makeUser();
    annotationService.deleteAnnotation.mockResolvedValue(undefined);

    await expect(controller.deleteAnnotation(22, 9, user)).resolves.toBeUndefined();
    expect(annotationService.deleteAnnotation).toHaveBeenCalledWith(22, 9, user);
  });
});
