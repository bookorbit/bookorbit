import { ScannerController } from './scanner.controller';

describe('ScannerController', () => {
  it('delegates scan requests to ScannerService.startScan with manual trigger', () => {
    const scannerService = { startScan: vi.fn().mockResolvedValue({ jobId: 11 }), refreshCovers: vi.fn() } as any;
    const controller = new ScannerController(scannerService);

    void controller.scan(42);

    expect(scannerService.startScan).toHaveBeenCalledWith(42, 'manual');
  });

  it('delegates cover refresh requests to ScannerService.refreshCovers', () => {
    const scannerService = { startScan: vi.fn(), refreshCovers: vi.fn().mockResolvedValue({ queued: 3 }) } as any;
    const controller = new ScannerController(scannerService);

    void controller.refreshCovers(9);

    expect(scannerService.refreshCovers).toHaveBeenCalledWith(9);
  });
});
