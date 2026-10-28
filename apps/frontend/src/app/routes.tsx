import type { RouteObject } from 'react-router';
import { LoginPage } from '../features/auth/pages/LoginPage';
import { ProfilePage } from '../features/auth/pages/ProfilePage';
import { RegisterPage } from '../features/auth/pages/RegisterPage';
import { CheckEmailPage } from '../features/auth/pages/CheckEmailPage';
import { VerifyEmailPage } from '../features/auth/pages/VerifyEmailPage';
import { ForgotPasswordPage } from '../features/auth/pages/ForgotPasswordPage';
import { ResetPasswordPage } from '../features/auth/pages/ResetPasswordPage';
import { BoardMembersPage } from '../features/board-members/pages/BoardMembersPage';
import { BoardDetailPage } from '../features/boards/pages/BoardDetailPage';
import { BoardsPage } from '../features/boards/pages/BoardsPage';
import { LandingPage } from '../features/landing/pages/LandingPage';
import {
  SettingsIndex,
  SettingsLayout,
} from '../features/settings/components/SettingsLayout';
import { AppearancePage } from '../features/settings/pages/AppearancePage';
import { ConnectedAccountsPage } from '../features/settings/pages/ConnectedAccountsPage';
import { PreferencesPage } from '../features/settings/pages/PreferencesPage';
import { ProfileRedirect } from '../features/settings/pages/ProfileRedirect';
import { SecuritySettingsPage } from '../features/settings/pages/SecuritySettingsPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { RouteErrorPage } from '../pages/RouteErrorPage';
import { WorkspaceLayout } from '../features/workspaces/components/WorkspaceLayout';
import { WorkspaceOverviewPage } from '../features/workspaces/pages/WorkspaceOverviewPage';
import { WorkspacesPage } from '../features/workspaces/pages/WorkspacesPage';
import { WorkspaceBoardsPage } from '../features/workspaces/pages/WorkspaceBoardsPage';
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
      { path: 'forgot-password', element: <ForgotPasswordPage /> },
      { path: 'reset-password', element: <ResetPasswordPage /> },
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
              { path: 'workspaces', element: <WorkspacesPage /> },
              {
                path: 'workspaces/:workspaceId',
                element: <WorkspaceLayout />,
                children: [
                  { index: true, element: <WorkspaceOverviewPage /> },
                  { path: 'boards', element: <WorkspaceBoardsPage /> },
                ],
              },
              { path: 'boards', element: <BoardsPage /> },
              {
                path: 'boards/:boardId',
                element: <BoardDetailPage />,
                children: [{ path: 'cards/:cardId', element: null }],
              },
              {
                path: 'boards/:boardId/members',
                element: <BoardMembersPage />,
              },
              {
                path: 'settings',
                element: <SettingsLayout />,
                children: [
                  { index: true, element: <SettingsIndex /> },
                  { path: 'profile', element: <ProfilePage /> },
                  { path: 'appearance', element: <AppearancePage /> },
                  { path: 'preferences', element: <PreferencesPage /> },
                  { path: 'security', element: <SecuritySettingsPage /> },
                  {
                    path: 'connected-accounts',
                    element: <ConnectedAccountsPage />,
                  },
                ],
              },
              // Old bookmarks and links from before Settings (#92).
              { path: 'profile', element: <ProfileRedirect /> },
            ],
          },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
