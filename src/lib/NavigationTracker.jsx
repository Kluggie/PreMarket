import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { pagesConfig } from '@/pages.config';
import { appLogsClient } from '@/api/appLogsClient';

export default function NavigationTracker() {
  const location = useLocation();
  const { isAuthenticated } = useAuth();
  const { Pages, mainPage } = pagesConfig;
  const mainPageKey = mainPage ?? Object.keys(Pages)[0];

  useEffect(() => {
    const pathname = location.pathname;
    let pageName;

    if (pathname === '/' || pathname === '') {
      pageName = mainPageKey;
    } else {
      const pathSegment = pathname.replace(/^\//, '').split('/')[0];
      const pageKeys = Object.keys(Pages);
      const matchedKey = pageKeys.find((key) => key.toLowerCase() === pathSegment.toLowerCase());
      pageName = matchedKey || null;
    }

    if (isAuthenticated && pageName) {
      appLogsClient.logUserInApp(pageName).catch(() => {
        // Logging is best-effort.
      });
    }
  }, [location, isAuthenticated, Pages, mainPageKey]);

  return null;
}
