import Admin from './pages/Admin';
import CreateProposal from './pages/CreateProposal';
import Dashboard from './pages/Dashboard';
import Landing from './pages/Landing';
import Organization from './pages/Organization';
import Pricing from './pages/Pricing';
import Profile from './pages/Profile';
import ProposalDetail from './pages/ProposalDetail';
import Proposals from './pages/Proposals';
import Settings from './pages/Settings';
import Templates from './pages/Templates';
import Privacy from './pages/Privacy';
import Terms from './pages/Terms';
import Documentation from './pages/Documentation';
import Contact from './pages/Contact';
import About from './pages/About';
import Verification from './pages/Verification';
import __Layout from './Layout.jsx';


export const PAGES = {
    "Admin": Admin,
    "CreateProposal": CreateProposal,
    "Dashboard": Dashboard,
    "Landing": Landing,
    "Organization": Organization,
    "Pricing": Pricing,
    "Profile": Profile,
    "ProposalDetail": ProposalDetail,
    "Proposals": Proposals,
    "Settings": Settings,
    "Templates": Templates,
    "Privacy": Privacy,
    "Terms": Terms,
    "Documentation": Documentation,
    "Contact": Contact,
    "About": About,
    "Verification": Verification,
}

export const pagesConfig = {
    mainPage: "Landing",
    Pages: PAGES,
    Layout: __Layout,
};