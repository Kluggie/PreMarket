/**
 * pages.config.js - Page routing configuration
 * 
 * This file is AUTO-GENERATED. Do not add imports or modify PAGES manually.
 * Pages are auto-registered when you create files in the ./pages/ folder.
 * 
 * THE ONLY EDITABLE VALUE: mainPage
 * This controls which page is the landing page (shown when users visit the app).
 * 
 * Example file structure:
 * 
 *   import HomePage from './pages/HomePage';
 *   import Dashboard from './pages/Dashboard';
 *   import Settings from './pages/Settings';
 *   
 *   export const PAGES = {
 *       "HomePage": HomePage,
 *       "Dashboard": Dashboard,
 *       "Settings": Settings,
 *   }
 *   
 *   export const pagesConfig = {
 *       mainPage: "HomePage",
 *       Pages: PAGES,
 *   };
 * 
 * Example with Layout (wraps all pages):
 *
 *   import Home from './pages/Home';
 *   import Settings from './pages/Settings';
 *   import __Layout from './Layout.jsx';
 *
 *   export const PAGES = {
 *       "Home": Home,
 *       "Settings": Settings,
 *   }
 *
 *   export const pagesConfig = {
 *       mainPage: "Home",
 *       Pages: PAGES,
 *       Layout: __Layout,
 *   };
 *
 * To change the main page from HomePage to Dashboard, use find_replace:
 *   Old: mainPage: "HomePage",
 *   New: mainPage: "Dashboard",
 *
 * The mainPage value must match a key in the PAGES object exactly.
 */
import About from './pages/About';
import Admin from './pages/Admin';
import Billing from './pages/db/BillingDb';
import Contact from './pages/Contact';
import CreateProposal from './pages/db/CreateProposalDb';
import CreateProposalWithDrafts from './pages/CreateProposalWithDrafts';
import Dashboard from './pages/db/DashboardDb';
import Directory from './pages/Directory';
import DirectoryOrgDetail from './pages/DirectoryOrgDetail';
import DirectoryPersonDetail from './pages/DirectoryPersonDetail';
import DocumentComparisonCreate from './pages/DocumentComparisonCreate';
import DocumentComparisonDetail from './pages/DocumentComparisonDetail';
import Documentation from './pages/Documentation';
import GeminiTest from './pages/GeminiTest';
import Landing from './pages/Landing';
import Organization from './pages/Organization';
import Pricing from './pages/Pricing';
import Privacy from './pages/Privacy';
import Profile from './pages/Profile';
import ProposalDetail from './pages/db/ProposalDetailDb';
import Proposals from './pages/db/ProposalsDb';
import ReportViewer from './pages/ReportViewer';
import Settings from './pages/Settings';
import SharedReport from './pages/db/SharedReportDb';
import TemplateBuilder from './pages/TemplateBuilder';
import TemplateDedupe from './pages/TemplateDedupe';
import Templates from './pages/Templates';
import Terms from './pages/Terms';
import Verification from './pages/Verification';
import __Layout from './Layout.jsx';


export const PAGES = {
    "About": About,
    "Admin": Admin,
    "Billing": Billing,
    "Contact": Contact,
    "CreateProposal": CreateProposal,
    "CreateProposalWithDrafts": CreateProposalWithDrafts,
    "Dashboard": Dashboard,
    "Directory": Directory,
    "DirectoryOrgDetail": DirectoryOrgDetail,
    "DirectoryPersonDetail": DirectoryPersonDetail,
    "DocumentComparisonCreate": DocumentComparisonCreate,
    "DocumentComparisonDetail": DocumentComparisonDetail,
    "Documentation": Documentation,
    "GeminiTest": GeminiTest,
    "Landing": Landing,
    "Organization": Organization,
    "Pricing": Pricing,
    "Privacy": Privacy,
    "Profile": Profile,
    "ProposalDetail": ProposalDetail,
    "Proposals": Proposals,
    "ReportViewer": ReportViewer,
    "Settings": Settings,
    "SharedReport": SharedReport,
    "TemplateBuilder": TemplateBuilder,
    "TemplateDedupe": TemplateDedupe,
    "Templates": Templates,
    "Terms": Terms,
    "Verification": Verification,
}

export const pagesConfig = {
    mainPage: "Landing",
    Pages: PAGES,
    Layout: __Layout,
};
