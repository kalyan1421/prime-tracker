import { MulterError } from 'multer';
import { MulterExceptionFilter } from './multer-exception.filter';

function hostWith(res: any) {
  return { switchToHttp: () => ({ getResponse: () => res }) } as any;
}

function fakeResponse() {
  const res: any = { statusCode: 0, body: undefined };
  res.status = jest.fn((code: number) => { res.statusCode = code; return res; });
  res.json = jest.fn((body: any) => { res.body = body; return res; });
  return res;
}

describe('MulterExceptionFilter', () => {
  // Before this filter existed, an over-limit upload threw a MulterError before any
  // controller or DTO ran, with nothing registered to catch it — Nest's default handler
  // reported it as a bare 500 with no indication what actually went wrong.
  it('reports an over-limit upload as 413, not a bare 500', () => {
    const res = fakeResponse();
    new MulterExceptionFilter().catch(new MulterError('LIMIT_FILE_SIZE'), hostWith(res));

    expect(res.status).toHaveBeenCalledWith(413);
    expect(res.body.message).toMatch(/too large/i);
    expect(res.body.message).toMatch(/50 ?MB/i);
  });

  it('reports every other multer failure as 400, not 500', () => {
    const res = fakeResponse();
    new MulterExceptionFilter().catch(new MulterError('LIMIT_UNEXPECTED_FILE'), hostWith(res));

    expect(res.status).toHaveBeenCalledWith(400);
  });
});
