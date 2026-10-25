import { vi } from 'vitest';
import type {
  GoogleCredentialResponse,
  GoogleIdentityApi,
} from '../features/auth/google-identity';

export const googleClientId = '123456-test.apps.googleusercontent.com';

/** Official GIS boundary only; never loads Google's script or sends real mail. */
export function installGoogle() {
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', googleClientId);
  let callback: (response: GoogleCredentialResponse) => void;
  const buttons: { element: HTMLElement; state: string; click: () => void }[] =
    [];
  const api: GoogleIdentityApi = {
    initialize: vi.fn((options) => {
      callback = options.callback;
    }),
    renderButton: vi.fn((element, options) => {
      const button = document.createElement('button');
      button.textContent = 'Continue with Google';
      button.onclick = options.click_listener;
      element.append(button);
      buttons.push({
        element,
        state: options.state,
        click: options.click_listener,
      });
    }),
  };
  vi.stubGlobal('google', { accounts: { id: api } });
  return {
    api,
    buttons,
    respond: (credential = 'google-id-token', index = buttons.length - 1) =>
      callback({ credential, state: buttons[index].state }),
  };
}
