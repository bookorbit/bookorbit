import { KOBO_STORE_RESOURCES } from './kobo-store-resources';

describe('KOBO_STORE_RESOURCES', () => {
  it('exposes core endpoints required by Kobo clients', () => {
    expect(KOBO_STORE_RESOURCES.device_auth).toBe('https://storeapi.kobo.com/v1/auth/device');
    expect(KOBO_STORE_RESOURCES.device_refresh).toBe('https://storeapi.kobo.com/v1/auth/refresh');
    expect(KOBO_STORE_RESOURCES.library_sync).toBe('https://storeapi.kobo.com/v1/library/sync');
    expect(KOBO_STORE_RESOURCES.image_url_template).toBe('https://cdn.kobo.com/book-images/{ImageId}/{Width}/{Height}/false/image.jpg');
    expect(KOBO_STORE_RESOURCES.post_analytics_event).toBe('https://storeapi.kobo.com/v1/analytics/event');
  });

  it('keeps known feature switches as explicit string flags', () => {
    expect(KOBO_STORE_RESOURCES.kobo_audiobooks_enabled).toBe('True');
    expect(KOBO_STORE_RESOURCES.kobo_subscriptions_enabled).toBe('True');
    expect(KOBO_STORE_RESOURCES.kobo_onedrive_link_account_enabled).toBe('False');
  });
});
