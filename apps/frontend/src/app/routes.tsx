import type { RouteObject } from 'react-router';
import { LoginPage } from '../features/auth/pages/LoginPage';
import { ProfilePage } from '../features/auth/pages/ProfilePage';
import { RegisterPage } from '../features/auth/pages/RegisterPage';
import { BoardDetailPage } from '../features/boards/pages/BoardDetailPage';
import { BoardsPage } from '../features/boards/pages/BoardsPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { RouteErrorPage } from '../pages/RouteErrorPage';
import { PublicOnly, RequireAuth, RootRedirect } from './guards';
import { AuthenticatedLayout } from './layout/AuthenticatedLayout';

export const routes: RouteObject[] = [
  {
    // Catches render errors from every page below so no raw error screen is shown.
    errorElement: <RouteErrorPage />,
    children: [
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
              { path: 'boards/:boardId', element: <BoardDetailPage /> },
              { path: 'profile', element: <ProfilePage /> },
            ],
          },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
