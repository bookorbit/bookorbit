import 'reflect-metadata';

vi.mock('../auth/auth.module', () => ({ AuthModule: class AuthModule {} }));
vi.mock('../book-metadata-fetch/book-metadata-fetch.module', () => ({ BookMetadataFetchModule: class BookMetadataFetchModule {} }));
vi.mock('../metadata/metadata.module', () => ({ MetadataModule: class MetadataModule {} }));
vi.mock('../notification/notification.module', () => ({ NotificationModule: class NotificationModule {} }));

import { AuthModule } from '../auth/auth.module';
import { BookMetadataFetchModule } from '../book-metadata-fetch/book-metadata-fetch.module';
import { MetadataModule } from '../metadata/metadata.module';
import { NotificationModule } from '../notification/notification.module';
import { FileEventProcessorService } from './file-event-processor.service';
import { FileWatcherService } from './file-watcher.service';
import { ScanGateway } from './scan.gateway';
import { ScanJobStore } from './scan-job-store.service';
import { ScannerController } from './scanner.controller';
import { ScannerModule } from './scanner.module';
import { ScannerRepository } from './scanner.repository';
import { ScannerService } from './scanner.service';

describe('ScannerModule', () => {
  it('registers expected imports/controllers/providers/exports', () => {
    const imports = Reflect.getMetadata('imports', ScannerModule) as unknown[];
    expect(imports[0]).toBe(MetadataModule);
    expect(imports[1]).toBe(AuthModule);
    expect(imports[2]).toEqual(expect.objectContaining({ forwardRef: expect.any(Function) }));
    expect(imports[3]).toEqual(expect.objectContaining({ forwardRef: expect.any(Function) }));
    expect(imports[4]).toEqual(expect.objectContaining({ module: expect.any(Function) }));

    expect(Reflect.getMetadata('controllers', ScannerModule)).toEqual([ScannerController]);
    expect(Reflect.getMetadata('providers', ScannerModule)).toEqual([
      ScannerService,
      ScannerRepository,
      ScanGateway,
      ScanJobStore,
      FileEventProcessorService,
      FileWatcherService,
    ]);
    expect(Reflect.getMetadata('exports', ScannerModule)).toEqual([ScannerService, FileWatcherService, ScanGateway]);
  });

  it('wires NotificationModule and BookMetadataFetchModule via forwardRef to avoid circular import issues', () => {
    const imports = Reflect.getMetadata('imports', ScannerModule) as Array<{ forwardRef?: () => unknown }>;
    const forwardRefs = imports.filter((entry) => typeof entry?.forwardRef === 'function');
    const resolved = forwardRefs.map((entry) => entry.forwardRef?.());
    expect(resolved).toContain(NotificationModule);
    expect(resolved).toContain(BookMetadataFetchModule);
  });
});
