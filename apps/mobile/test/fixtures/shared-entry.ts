import type { ApiSuccessResponse, BoardRole } from '@kanban/shared';
import { verifySharedCompatibility } from '../../src/bootstrap/shared-compatibility';

// Compile a shared wire type through Expo's tsconfig; bundle/evaluate its runtime
// counterpart through Metro. No fixture response is rendered as business data.
const role: ApiSuccessResponse<BoardRole>['data'] = verifySharedCompatibility();

Object.assign(globalThis, { __kanvexaSharedRole: role });
