import type { RouteObject } from 'react-router';
import { LoginPage } from '../features/auth/pages/LoginPage';
import { ProfilePage } from '../features/auth/pages/ProfilePage';
import { RegisterPage } from '../features/auth/pages/RegisterPage';
import { BoardsPage } from '../pages/BoardsPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { PublicOnly, RequireAuth, RootRedirect } from './guards';
import { AuthenticatedLayout } from './layout/AuthenticatedLayout';

export const routes: RouteObject[] = [
  { index: true, element: <RootRedirect /> },
  {
    element: <PublicOnly />,
    children: [
      { path: 'login', element: <LoginPage /> },
      { path: 'register', element: <RegisterPage /> },
    ],
  },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AuthenticatedLayout />,
        children: [
          { path: 'boards', element: <BoardsPage /> },
          { path: 'profile', element: <ProfilePage /> },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
];
