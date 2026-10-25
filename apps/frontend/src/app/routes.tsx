import type { RouteObject } from 'react-router';
import { LoginPage } from '../features/auth/pages/LoginPage';
import { ProfilePage } from '../features/auth/pages/ProfilePage';
import { RegisterPage } from '../features/auth/pages/RegisterPage';
import { CheckEmailPage } from '../features/auth/pages/CheckEmailPage';
import { VerifyEmailPage } from '../features/auth/pages/VerifyEmailPage';
import { BoardMembersPage } from '../features/board-members/pages/BoardMembersPage';
import { BoardDetailPage } from '../features/boards/pages/BoardDetailPage';
import { BoardsPage } from '../features/boards/pages/BoardsPage';
import { LandingPage } from '../features/landing/pages/LandingPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { RouteErrorPage } from '../pages/RouteErrorPage';
import { PublicOnly, RequireAuth } from './guards';
import { AuthenticatedLayout } from './layout/AuthenticatedLayout';

export const routes: RouteObject[] = [
  {
    // Catches render errors from every page below so no raw error screen is shown.
    errorElement: <RouteErrorPage />,
    children: [
      // Public for everyone; never waits for the session check.
      { index: true, element: <LandingPage /> },
      { path: 'check-email', element: <CheckEmailPage /> },
      { path: 'verify-email', element: <VerifyEmailPage /> },
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
              {
                path: 'boards/:boardId/members',
                element: <BoardMembersPage />,
              },
              { path: 'profile', element: <ProfilePage /> },
            ],
          },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
