import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import NavigationTracker from '@/lib/NavigationTracker'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import Directory from '@/pages/Directory';
import DirectoryPersonDetail from '@/pages/DirectoryPersonDetail';
import DirectoryOrgDetail from '@/pages/DirectoryOrgDetail';
import RecipientEditStep2 from '@/pages/RecipientEditStep2';
import RecipientEditStep3 from '@/pages/RecipientEditStep3';

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

const SharedReportAliasRedirect = () => {
  const location = useLocation();
  return <Navigate to={`/SharedReport${location.search || ''}`} replace />;
};

const PublicRoutes = () => {
  return (
    <Routes>
      <Route
        path="/directory"
        element={
          <LayoutWrapper currentPageName="Directory">
            <Directory />
          </LayoutWrapper>
        }
      />
      <Route
        path="/directory/people/:id"
        element={
          <LayoutWrapper currentPageName="Directory">
            <DirectoryPersonDetail />
          </LayoutWrapper>
        }
      />
      <Route
        path="/directory/orgs/:id"
        element={
          <LayoutWrapper currentPageName="Directory">
            <DirectoryOrgDetail />
          </LayoutWrapper>
        }
      />
      <Route
        path="/SharedReport"
        element={
          <LayoutWrapper currentPageName="SharedReport">
            <Pages.SharedReport />
          </LayoutWrapper>
        }
      />
      <Route path="/shared-report" element={<SharedReportAliasRedirect />} />
      <Route
        path="/proposals/:proposalId/recipient-edit"
        element={
          <LayoutWrapper currentPageName="ProposalDetail">
            <RecipientEditStep2 />
          </LayoutWrapper>
        }
      />
      <Route
        path="/proposals/:proposalId/recipient-edit/highlighting"
        element={
          <LayoutWrapper currentPageName="ProposalDetail">
            <RecipientEditStep3 />
          </LayoutWrapper>
        }
      />
      <Route path="/" element={
        <LayoutWrapper currentPageName={mainPageKey}>
          <MainPage />
        </LayoutWrapper>
      } />
      {Object.entries(Pages).map(([path, Page]) => (
        <Route
          key={path}
          path={`/${path}`}
          element={
            <LayoutWrapper currentPageName={path}>
              <Page />
            </LayoutWrapper>
          }
        />
      ))}
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

const AuthenticatedApp = ({ isPublicDirectoryRoute }) => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      if (isPublicDirectoryRoute) {
        return <PublicRoutes />;
      }
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      if (isPublicDirectoryRoute) {
        return <PublicRoutes />;
      }
      // Redirect to login automatically
      navigateToLogin();
      return null;
    }

    return (
      <div className="fixed inset-0 flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold text-slate-900">Authentication is unavailable</h1>
          <p className="mt-2 text-sm text-slate-600">
            {authError.message || 'Server auth configuration is not ready.'}
          </p>
        </div>
      </div>
    );
  }

  return <PublicRoutes />;
};

const AppRoutes = () => {
  const location = useLocation();
  const isPublicDirectoryRoute =
    location.pathname === '/directory' ||
    location.pathname.startsWith('/directory/') ||
    location.pathname === '/SharedReport' ||
    location.pathname === '/shared-report';
  return <AuthenticatedApp isPublicDirectoryRoute={isPublicDirectoryRoute} />;
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <NavigationTracker />
          <AppRoutes />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App
