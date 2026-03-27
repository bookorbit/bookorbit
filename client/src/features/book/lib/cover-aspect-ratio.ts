import type { InjectionKey, Ref } from 'vue'
import type { CoverAspectRatio } from '@projectx/types'

export const COVER_ASPECT_RATIO_KEY: InjectionKey<Readonly<Ref<CoverAspectRatio>>> = Symbol('coverAspectRatio')
export const DEFAULT_COVER_ASPECT_RATIO: CoverAspectRatio = '2/3'
