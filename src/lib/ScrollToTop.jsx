import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

function findHashTarget(hash) {
  if (!hash) {
    return null;
  }

  const rawId = hash.replace(/^#/, '');
  if (!rawId) {
    return null;
  }

  const decodedId = decodeURIComponent(rawId);
  return document.getElementById(decodedId) || document.querySelector(`[name="${decodedId}"]`);
}

export default function ScrollToTop() {
  const location = useLocation();

  useEffect(() => {
    let rafId = null;
    let attempts = 0;

    const scrollToHashOrTop = () => {
      if (location.hash) {
        const target = findHashTarget(location.hash);
        if (target) {
          target.scrollIntoView({ block: 'start' });
          return;
        }

        attempts += 1;
        if (attempts < 12) {
          rafId = window.requestAnimationFrame(scrollToHashOrTop);
          return;
        }
      }

      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    };

    rafId = window.requestAnimationFrame(scrollToHashOrTop);

    return () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [location.pathname, location.search, location.hash]);

  return null;
}
