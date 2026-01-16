import About from './pages/About';
import Admin from './pages/Admin';
import Contact from './pages/Contact';
import Dashboard from './pages/Dashboard';
import Documentation from './pages/Documentation';
import Landing from './pages/Landing';
import Organization from './pages/Organization';
import Pricing from './pages/Pricing';
import Privacy from './pages/Privacy';
import Profile from './pages/Profile';
import Proposals from './pages/Proposals';
import Settings from './pages/Settings';
import Terms from './pages/Terms';
import Verification from './pages/Verification';
import ProposalDetail from './pages/ProposalDetail';
import Templates from './pages/Templates';
import CreateProposal from './pages/CreateProposal';
import TemplateDedupe from './pages/TemplateDedupe';
import __Layout from './Layout.jsx';


export const PAGES = {
    "About": About,
    "Admin": Admin,
    "Contact": Contact,
    "Dashboard": Dashboard,
    "Documentation": Documentation,
    "Landing": Landing,
    "Organization": Organization,
    "Pricing": Pricing,
    "Privacy": Privacy,
    "Profile": Profile,
    "Proposals": Proposals,
    "Settings": Settings,
    "Terms": Terms,
    "Verification": Verification,
    "ProposalDetail": ProposalDetail,
    "Templates": Templates,
    "CreateProposal": CreateProposal,
    "TemplateDedupe": TemplateDedupe,
}

export const pagesConfig = {
    mainPage: "Landing",
    Pages: PAGES,
    Layout: __Layout,
};