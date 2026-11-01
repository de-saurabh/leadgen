import { createBrowserRouter } from 'react-router';
import { AdminBusinessesPage } from './routes/AdminBusinessesPage';
import { CampaignBuilderPage } from './routes/CampaignBuilderPage';
import { CampaignsPage } from './routes/CampaignsPage';
import { AppLayout } from './routes/AppLayout';
import { HomePage } from './routes/HomePage';
import { LoginPage } from './routes/LoginPage';
import { SettingsPage } from './routes/SettingsPage';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'campaigns', element: <CampaignsPage /> },
      { path: 'campaigns/:id', element: <CampaignBuilderPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'admin', element: <AdminBusinessesPage /> },
    ],
  },
]);
