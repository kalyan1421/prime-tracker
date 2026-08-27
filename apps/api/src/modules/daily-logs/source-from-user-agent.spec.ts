/**
 * WEB vs MOBILE is derived from the user agent because the app is responsive rather than a
 * native build — there is no other signal. It is a display hint only: a wrong guess mislabels
 * an icon. The values that actually matter as evidence (EMAIL, WHATSAPP) are unreachable from
 * this path entirely.
 */
import { DailyLogsController } from './daily-logs.controller';

/** The controller's helper is module-private; exercise it through the route. */
function sourceFor(ua?: string) {
  const captured: any[] = [];
  const service: any = { create: (input: any, source: string) => { captured.push(source); return {}; } };
  new DailyLogsController(service).create('user1', { projectId: 'p1', notes: 'x' } as any, ua);
  return captured[0];
}

describe('daily log source from user agent', () => {
  it('treats a desktop browser as WEB', () => {
    expect(sourceFor('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36'))
      .toBe('WEB');
  });

  it('treats an iPhone as MOBILE', () => {
    expect(sourceFor('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'))
      .toBe('MOBILE');
  });

  it('treats Android as MOBILE', () => {
    expect(sourceFor('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'))
      .toBe('MOBILE');
  });

  it('treats an iPad as MOBILE — a site tablet is still "from site"', () => {
    expect(sourceFor('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'))
      .toBe('MOBILE');
  });

  it('falls back to WEB when there is no user agent at all', () => {
    expect(sourceFor(undefined)).toBe('WEB');
  });

  it('only ever produces WEB or MOBILE, whatever the user agent claims', () => {
    expect(sourceFor('EMAIL')).toBe('WEB');
    expect(sourceFor('WhatsApp/2.24 A')).toBe('WEB');
  });
});
