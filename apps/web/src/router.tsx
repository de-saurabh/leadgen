import { createBrowserRouter } from 'react-router';
import { AdminBusinessesPage } from './routes/AdminBusinessesPage';
import { AppLayout } from './routes/AppLayout';
import { HomePage } from './routes/HomePage';
import { LoginPage } from './routes/LoginPage';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'admin', element: <AdminBusinessesPage /> },
    ],
  },
]);
