import { HttpException, HttpStatus } from '@nestjs/common';

export class ApplicationException extends HttpException {
  constructor(
    status: HttpStatus,
    code: string,
    message: string,
    details?: string[],
  ) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(code)) {
      throw new TypeError(
        'Application error code must be uppercase snake case',
      );
    }
    super({ code, message, ...(details ? { details } : {}) }, status);
  }
}
