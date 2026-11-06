import { createBrowserRouter } from 'react-router';
import { AnalyticsPage } from './routes/AnalyticsPage';
import { BookingsPage } from './routes/BookingsPage';
import { AdminBusinessesPage } from './routes/AdminBusinessesPage';
import { CampaignBuilderPage } from './routes/CampaignBuilderPage';
import { CampaignsPage } from './routes/CampaignsPage';
import { AppLayout } from './routes/AppLayout';
import { HomePage } from './routes/HomePage';
import { LeadPage } from './routes/LeadPage';
import { LeadsPage } from './routes/LeadsPage';
import { LoginPage } from './routes/LoginPage';
import { ResourcesPage } from './routes/ResourcesPage';
import { TeamPage } from './routes/TeamPage';
import { SettingsPage } from './routes/SettingsPage';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'campaigns', element: <CampaignsPage /> },
      { path: 'campaigns/:id', element: <CampaignBuilderPage /> },
      { path: 'leads', element: <LeadsPage /> },
      { path: 'leads/:id', element: <LeadPage /> },
      { path: 'analytics', element: <AnalyticsPage /> },
      { path: 'team', element: <TeamPage /> },
      { path: 'bookings', element: <BookingsPage /> },
      { path: 'bookable', element: <ResourcesPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'admin', element: <AdminBusinessesPage /> },
    ],
  },
]);
