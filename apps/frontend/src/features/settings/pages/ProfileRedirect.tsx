import { Navigate, useLocation } from 'react-router';

/** `/profile` keeps working: same content at `/settings/profile`, no extra history entry. */
export function ProfileRedirect() {
  const { search, hash, state } = useLocation();
  return (
    <Navigate
      to={{ pathname: '/settings/profile', search, hash }}
      state={state}
      replace
    />
  );
}
