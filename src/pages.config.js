import About from './pages/About';
import Admin from './pages/Admin';
import Billing from './pages/Billing';
import Contact from './pages/Contact';
import CreateProposal from './pages/CreateProposal';
import CreateProposalWithDrafts from './pages/CreateProposalWithDrafts';
import Dashboard from './pages/Dashboard';
import Documentation from './pages/Documentation';
import GeminiTest from './pages/GeminiTest';
import Landing from './pages/Landing';
import Organization from './pages/Organization';
import Pricing from './pages/Pricing';
import Privacy from './pages/Privacy';
import Profile from './pages/Profile';
import ProposalDetail from './pages/ProposalDetail';
import Proposals from './pages/Proposals';
import Settings from './pages/Settings';
import TemplateBuilder from './pages/TemplateBuilder';
import TemplateDedupe from './pages/TemplateDedupe';
import Templates from './pages/Templates';
import Terms from './pages/Terms';
import Verification from './pages/Verification';
import DocumentComparisonCreate from './pages/DocumentComparisonCreate';
import DocumentComparisonDetail from './pages/DocumentComparisonDetail';
import __Layout from './Layout.jsx';


export const PAGES = {
    "About": About,
    "Admin": Admin,
    "Billing": Billing,
    "Contact": Contact,
    "CreateProposal": CreateProposal,
    "CreateProposalWithDrafts": CreateProposalWithDrafts,
    "Dashboard": Dashboard,
    "Documentation": Documentation,
    "GeminiTest": GeminiTest,
    "Landing": Landing,
    "Organization": Organization,
    "Pricing": Pricing,
    "Privacy": Privacy,
    "Profile": Profile,
    "ProposalDetail": ProposalDetail,
    "Proposals": Proposals,
    "Settings": Settings,
    "TemplateBuilder": TemplateBuilder,
    "TemplateDedupe": TemplateDedupe,
    "Templates": Templates,
    "Terms": Terms,
    "Verification": Verification,
    "DocumentComparisonCreate": DocumentComparisonCreate,
    "DocumentComparisonDetail": DocumentComparisonDetail,
}

export const pagesConfig = {
    mainPage: "Landing",
    Pages: PAGES,
    Layout: __Layout,
};