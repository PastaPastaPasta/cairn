import '@fontsource-variable/bricolage-grotesque/opsz.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-400-italic.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import './styles/tokens.css';
import './styles/govhub-auth.css';
import './styles/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AccountProvider } from './app/account.tsx';
import { AppProvider } from './app/context.tsx';
import { FramedNotice, isFramed } from './app/frame.tsx';
import { Layout } from './app/Layout.tsx';
import { AuthProvider } from './auth/context.tsx';
import { AppRoutes } from './routes.tsx';

const root = createRoot(document.getElementById('root')!);
root.render(
  <StrictMode>
    {isFramed() ? (
      <FramedNotice />
    ) : (
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <AppProvider>
          <AccountProvider>
            <AuthProvider>
              <Layout>
                <AppRoutes />
              </Layout>
            </AuthProvider>
          </AccountProvider>
        </AppProvider>
      </BrowserRouter>
    )}
  </StrictMode>,
);
