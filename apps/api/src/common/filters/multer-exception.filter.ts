import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter, PayloadTooLargeException } from '@nestjs/common';
import { Response } from 'express';
import { MulterError } from 'multer';

/**
 * Every FileInterceptor in the app sets a `limits.fileSize`, but multer reports an
 * over-limit upload by throwing a MulterError from inside the interceptor, before any
 * controller method or DTO validation runs. With no filter catching it, that error fell
 * through to Nest's default handler — an unhandled exception, reported as a bare 500 —
 * so someone uploading a 60MB file saw "Internal server error" instead of "File is too
 * large", with nothing to say what actually went wrong or what the limit even is.
 */
@Catch(MulterError)
export class MulterExceptionFilter implements ExceptionFilter {
  catch(exception: MulterError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception.code === 'LIMIT_FILE_SIZE') {
      const mapped = new PayloadTooLargeException('File is too large. The maximum upload size is 50 MB.');
      return response.status(mapped.getStatus()).json(mapped.getResponse());
    }

    const mapped = new BadRequestException(exception.message || 'File upload failed.');
    return response.status(mapped.getStatus()).json(mapped.getResponse());
  }
}
