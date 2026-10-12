import { SetMetadata, Type } from '@nestjs/common';

export const SKIP_RESPONSE_WRAP = Symbol('skipResponseWrap');
export const RESPONSE_MESSAGE = Symbol('responseMessage');
export const RESPONSE_DTO = Symbol('responseDto');

export const SkipResponseWrap = () => SetMetadata(SKIP_RESPONSE_WRAP, true);
export const ResponseMessage = (message: string) =>
  SetMetadata(RESPONSE_MESSAGE, message);
export const SerializeResponse = (type: Type<object>) =>
  SetMetadata(RESPONSE_DTO, type);
