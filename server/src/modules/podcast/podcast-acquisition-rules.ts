import { BadRequestException } from '@nestjs/common';

import type { PodcastAcquisitionPolicy } from '@bookorbit/types';

export function validatePodcastAcquisitionPolicy(policy: PodcastAcquisitionPolicy, limit?: number | null, windowDays?: number | null): void {
  if (policy === 'newest' && !limit) throw new BadRequestException('Newest acquisition policy requires autoDownloadLimit');
  if (policy === 'window' && !windowDays) throw new BadRequestException('Window acquisition policy requires autoDownloadWindowDays');
}
