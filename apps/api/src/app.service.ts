import { Injectable } from '@nestjs/common';
import { APP_NAME } from '@kanban/shared';

@Injectable()
export class AppService {
  getHealth() {
    return { name: APP_NAME, status: 'ok' };
  }
}
