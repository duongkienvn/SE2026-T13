/** Push is a separate opt-in channel; these are not notification-preference leaves. */
export interface PushPreferences {
  enabled: boolean;
  deliveryAvailable: boolean;
}
export interface RegisterPushDevice {
  installationId: string;
  expoPushToken: string;
  platform: 'android' | 'ios';
  appEnvironment: 'development' | 'preview' | 'production';
  projectId: string;
}
export interface PushDeviceRegistration {
  installationId: string;
  registered: true;
}
export interface CurrentPushDevice {
  registered: boolean;
  eligible: boolean;
}
export interface PushNotificationData {
  notificationId: string;
  version?: 1;
}
