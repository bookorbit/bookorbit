import type { RequestUser } from '../../common/types/request-user';
import { AnnotationController } from './annotation.controller';

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
  };
}

function makeController() {
  const annotationService = {
    getAnnotations: vi.fn(),
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
  it('delegates getAnnotations with bookId and current user', async () => {
    const { controller, annotationService } = makeController();
    const expected = [{ id: 1 }];
    annotationService.getAnnotations.mockResolvedValue(expected);
    const user = makeUser();

    const result = await controller.getAnnotations(15, user);

    expect(annotationService.getAnnotations).toHaveBeenCalledWith(15, user);
    expect(result).toEqual(expected);
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
