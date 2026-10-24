/** GIS stays outside React: one script and one initialization per page/API. */
export interface GoogleCredentialResponse {
  credential: string;
  state?: string;
}

export interface GoogleIdentityApi {
  initialize(options: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    auto_select: false;
    ux_mode: 'popup';
  }): void;
  renderButton(
    element: HTMLElement,
    options: {
      type: 'standard';
      theme: 'outline';
      size: 'large';
      text: 'continue_with';
      width: number;
      shape?: 'rectangular';
      locale?: 'en';
      state: string;
      click_listener: () => void;
    },
  ): void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdentityApi } };
  }
}

export function getGoogleClientId(): string | null {
  const value: unknown = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  return typeof value === 'string' &&
    /^\d+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(value)
    ? value
    : null;
}

// GIS requires the script language as well as the button locale for fixed text.
const SCRIPT_URL = 'https://accounts.google.com/gsi/client?hl=en';
let loading: Promise<GoogleIdentityApi> | undefined;
const initialized = new WeakMap<GoogleIdentityApi, string>();
const receivers = new Map<string, (credential: string) => void>();

export function loadGoogleIdentity(): Promise<GoogleIdentityApi> {
  if (window.google?.accounts.id)
    return Promise.resolve(window.google.accounts.id);
  if (loading) return loading;
  loading = new Promise<GoogleIdentityApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${SCRIPT_URL}"]`,
    );
    const script = existing ?? document.createElement('script');
    const finish = (failed: boolean) => {
      clearTimeout(timeout);
      script.removeEventListener('load', loaded);
      script.removeEventListener('error', errored);
      const api = window.google?.accounts.id;
      if (failed || !api) {
        script.remove();
        reject(new Error('Google sign-in could not load.'));
      } else resolve(api);
    };
    const loaded = () => finish(false);
    const errored = () => finish(true);
    const timeout = setTimeout(errored, 10_000);
    script.addEventListener('load', loaded);
    script.addEventListener('error', errored);
    if (!existing) {
      script.src = SCRIPT_URL;
      script.async = true;
      script.defer = true;
      document.head.append(script);
    }
  }).catch((error: unknown) => {
    loading = undefined; // A later mount can retry a network failure.
    throw error;
  });
  return loading;
}

export function renderGoogleButton(
  api: GoogleIdentityApi,
  clientId: string,
  element: HTMLElement,
  onCredential: (credential: string) => void,
  onClick: () => void,
  fitContainer = false,
): () => void {
  const previous = initialized.get(api);
  if (previous && previous !== clientId)
    throw new Error('Google client configuration changed. Reload this page.');
  if (!previous) {
    api.initialize({
      client_id: clientId,
      auto_select: false,
      ux_mode: 'popup',
      callback: (response) => {
        // Google returns the opaque renderButton state for the originating button.
        // Never forward an old popup to a newly mounted page or a different user.
        if (
          typeof response.state !== 'string' ||
          typeof response.credential !== 'string' ||
          !response.credential ||
          response.credential.length > 8192
        )
          return;
        receivers.get(response.state)?.(response.credential);
      },
    });
    initialized.set(api, clientId);
  }
  const state = crypto.randomUUID();
  receivers.set(state, onCredential);
  let disposed = false;
  let previousWidth = 0;
  let observer: ResizeObserver | undefined;
  const draw = () => {
    if (disposed) return;
    const width = Math.max(200, Math.min(400, element.clientWidth || 280));
    if (width === previousWidth) return;
    previousWidth = width;
    // Replace only our mount's children. Google owns its button/iframe styling.
    element.replaceChildren();
    api.renderButton(element, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      text: 'continue_with',
      ...(fitContainer
        ? { shape: 'rectangular' as const, locale: 'en' as const }
        : {}),
      width,
      state,
      click_listener: onClick,
    });
  };
  try {
    draw();
    if (fitContainer && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(draw);
      observer.observe(element);
    }
  } catch (error) {
    observer?.disconnect();
    receivers.delete(state);
    throw error;
  }
  return () => {
    disposed = true;
    observer?.disconnect();
    receivers.delete(state);
    element.replaceChildren();
  };
}
