import { nativeData, nativeSession } from '../query/native-data.ts';
import { socketOrigin } from './contracts.ts';
import { nativeSocketFactory } from './socket.ts';
import { createNativeRealtime } from './client.ts';

const origin = socketOrigin(process.env.EXPO_PUBLIC_API_BASE_URL, __DEV__);
export const nativeRealtime = createNativeRealtime({
  manager: nativeSession,
  data: nativeData,
  createSocket: origin ? nativeSocketFactory(origin) : null,
});
