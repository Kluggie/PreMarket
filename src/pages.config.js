import Landing from './pages/Landing';
import Dashboard from './pages/Dashboard';
import Templates from './pages/Templates';
import Pricing from './pages/Pricing';
import Profile from './pages/Profile';
import Organization from './pages/Organization';
import CreateProposal from './pages/CreateProposal';
import Proposals from './pages/Proposals';
import __Layout from './Layout.jsx';


export const PAGES = {
    "Landing": Landing,
    "Dashboard": Dashboard,
    "Templates": Templates,
    "Pricing": Pricing,
    "Profile": Profile,
    "Organization": Organization,
    "CreateProposal": CreateProposal,
    "Proposals": Proposals,
}

export const pagesConfig = {
    mainPage: "Landing",
    Pages: PAGES,
    Layout: __Layout,
};