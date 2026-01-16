import Landing from './pages/Landing';
import Dashboard from './pages/Dashboard';
import Templates from './pages/Templates';
import Pricing from './pages/Pricing';
import __Layout from './Layout.jsx';


export const PAGES = {
    "Landing": Landing,
    "Dashboard": Dashboard,
    "Templates": Templates,
    "Pricing": Pricing,
}

export const pagesConfig = {
    mainPage: "Landing",
    Pages: PAGES,
    Layout: __Layout,
};