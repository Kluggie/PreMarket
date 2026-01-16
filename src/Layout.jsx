import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from './utils';
import { base44 } from '@/api/base44Client';
import { 
  Menu, X, ChevronDown, User, LogOut, Settings, Building2, 
  FileText, Inbox, LayoutDashboard, Shield, Bell
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function Layout({ children, currentPageName }) {
  const [user, setUser] = useState(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const loadUser = async () => {
      try {
        const userData = await base44.auth.me();
        setUser(userData);
      } catch (e) {
        setUser(null);
      }
    };
    loadUser();
  }, []);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 10);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const isLandingPage = currentPageName === 'Landing';
  const isAuthPage = ['Login', 'Signup'].includes(currentPageName);

  const handleLogout = async () => {
    await base44.auth.logout(createPageUrl('Landing'));
  };

  const navLinks = user ? [
    { name: 'Home', href: createPageUrl('Landing'), icon: LayoutDashboard },
    { name: 'Dashboard', href: createPageUrl('Dashboard'), icon: LayoutDashboard },
    { name: 'Proposals', href: createPageUrl('Proposals'), icon: FileText },
    { name: 'Templates', href: createPageUrl('Templates'), icon: FileText },
    { name: 'Pricing', href: createPageUrl('Pricing'), icon: FileText },
  ] : [];

  if (isAuthPage) {
    return (
      <div className="min-h-screen bg-slate-50">
        {children}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <style>{`
        :root {
          --primary: 222.2 47.4% 11.2%;
          --primary-foreground: 210 40% 98%;
          --accent: 210 100% 50%;
          --accent-light: 210 100% 96%;
        }
      `}</style>

      {/* Header */}
      <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isScrolled || !isLandingPage 
          ? 'bg-white/95 backdrop-blur-md shadow-sm border-b border-slate-100' 
          : 'bg-transparent'
      }`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <Link to={createPageUrl('Landing')} className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center">
                <span className="text-sm font-bold text-white">PM</span>
              </div>
              <span className="text-xl font-bold text-slate-900">PreMarket</span>
            </Link>

            {/* Desktop Nav */}
            <nav className="hidden md:flex items-center gap-1">
              {!user && (
                <>
                  <Link to={createPageUrl('Landing')} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors">
                    Home
                  </Link>
                  <Link to={createPageUrl('Templates')} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors">
                    Templates
                  </Link>
                  <Link to={createPageUrl('Pricing')} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors">
                    Pricing
                  </Link>
                </>
              )}
              {navLinks.map(link => (
                <Link 
                  key={link.name}
                  to={link.href} 
                  className={`px-4 py-2 text-sm font-medium transition-colors flex items-center gap-2 ${
                    currentPageName === link.name 
                      ? 'text-blue-600' 
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <link.icon className="w-4 h-4" />
                  {link.name}
                </Link>
              ))}
            </nav>

            {/* Right side */}
            <div className="flex items-center gap-3">
              {user ? (
                <>
                  <Link to={createPageUrl('Landing')} className="hidden md:inline-flex">
                    <Button variant="ghost">Home</Button>
                  </Link>
                  <Button variant="ghost" size="icon" className="relative">
                    <Bell className="w-5 h-5 text-slate-600" />
                    <span className="absolute top-1 right-1 w-2 h-2 bg-blue-600 rounded-full"></span>
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" className="flex items-center gap-2 pl-2 pr-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-sm font-medium">
                          {user.full_name?.charAt(0) || user.email?.charAt(0)?.toUpperCase()}
                        </div>
                        <span className="hidden sm:block text-sm font-medium text-slate-700">
                          {user.full_name || 'User'}
                        </span>
                        <ChevronDown className="w-4 h-4 text-slate-400" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <div className="px-3 py-2 border-b border-slate-100">
                        <p className="text-sm font-medium text-slate-900">{user.full_name}</p>
                        <p className="text-xs text-slate-500">{user.email}</p>
                      </div>
                      <DropdownMenuItem asChild>
                        <Link to={createPageUrl('Profile')} className="flex items-center gap-2 cursor-pointer">
                          <User className="w-4 h-4" />
                          My Profile
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link to={createPageUrl('Organization')} className="flex items-center gap-2 cursor-pointer">
                          <Building2 className="w-4 h-4" />
                          Organization
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link to={createPageUrl('Settings')} className="flex items-center gap-2 cursor-pointer">
                          <Settings className="w-4 h-4" />
                          Settings
                        </Link>
                      </DropdownMenuItem>
                      {user.role === 'admin' && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem asChild>
                            <Link to={createPageUrl('Admin')} className="flex items-center gap-2 cursor-pointer">
                              <Shield className="w-4 h-4" />
                              Admin Panel
                            </Link>
                          </DropdownMenuItem>
                        </>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={handleLogout} className="text-red-600 cursor-pointer">
                        <LogOut className="w-4 h-4 mr-2" />
                        Sign Out
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              ) : (
                <>
                  <Button 
                    variant="ghost" 
                    onClick={() => base44.auth.redirectToLogin(createPageUrl('Dashboard'))}
                    className="text-slate-600 hover:text-slate-900 hidden sm:inline-flex"
                  >
                    Sign In
                  </Button>
                  <Button 
                    onClick={() => base44.auth.redirectToLogin(createPageUrl('Dashboard'))}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    {isLandingPage ? 'Get Started' : 'Sign In'}
                  </Button>
                </>
              )}

              {/* Mobile menu button */}
              <Button 
                variant="ghost" 
                size="icon" 
                className="md:hidden"
                onClick={() => setIsMenuOpen(!isMenuOpen)}
              >
                {isMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </Button>
            </div>
          </div>
        </div>

        {/* Mobile menu */}
        {isMenuOpen && (
          <div className="md:hidden bg-white border-t border-slate-100 shadow-lg">
            <div className="px-4 py-4 space-y-1">
              {navLinks.map(link => (
                <Link 
                  key={link.name}
                  to={link.href}
                  onClick={() => setIsMenuOpen(false)}
                  className="flex items-center gap-3 px-4 py-3 text-slate-600 hover:bg-slate-50 rounded-lg transition-colors"
                >
                  <link.icon className="w-5 h-5" />
                  {link.name}
                </Link>
              ))}
            </div>
          </div>
        )}
      </header>

      {/* Main content */}
      <main className={isLandingPage ? '' : 'pt-16'}>
        {children}
      </main>

      {/* Footer */}
      {(isLandingPage || !user) && (
        <footer className="bg-slate-900 text-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
              <div className="col-span-1 md:col-span-2">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center">
                    <span className="text-sm font-bold text-white">PM</span>
                  </div>
                  <span className="text-xl font-bold">PreMarket</span>
                </div>
                <p className="text-slate-400 text-sm max-w-md mb-6">
                  Privacy-preserving pre-qualification platform. Exchange structured proposals and evaluate compatibility through AI-powered assessments.
                </p>
                <div className="flex items-center gap-4">
                  <span className="text-xs text-slate-500 px-3 py-1 bg-slate-800 rounded-full">
                    Pre-qualification only
                  </span>
                </div>
              </div>
              <div>
                <h4 className="font-semibold mb-4">Platform</h4>
                <ul className="space-y-2 text-sm text-slate-400">
                  <li><Link to={createPageUrl('Templates')} className="hover:text-white transition-colors">Templates</Link></li>
                  <li><Link to={createPageUrl('Pricing')} className="hover:text-white transition-colors">Pricing</Link></li>
                  <li><Link to={createPageUrl('Landing')} className="hover:text-white transition-colors">Documentation</Link></li>
                </ul>
              </div>
              <div>
                <h4 className="font-semibold mb-4">Company</h4>
                <ul className="space-y-2 text-sm text-slate-400">
                  <li><Link to={createPageUrl('About')} className="hover:text-white transition-colors">About Us</Link></li>
                  <li><Link to={createPageUrl('Contact')} className="hover:text-white transition-colors">Contact</Link></li>
                  <li><Link to={createPageUrl('Documentation')} className="hover:text-white transition-colors">Documentation</Link></li>
                </ul>
              </div>
              <div>
                <h4 className="font-semibold mb-4">Legal</h4>
                <ul className="space-y-2 text-sm text-slate-400">
                  <li><Link to={createPageUrl('Privacy')} className="hover:text-white transition-colors">Privacy Policy</Link></li>
                  <li><Link to={createPageUrl('Terms')} className="hover:text-white transition-colors">Terms of Service</Link></li>
                </ul>
              </div>
            </div>
            <div className="border-t border-slate-800 mt-12 pt-8">
              <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                <p className="text-xs text-slate-500">
                  © {new Date().getFullYear()} PreMarket. All rights reserved.
                </p>
                <div className="flex flex-wrap justify-center gap-4 text-xs text-slate-500">
                  <span>⚠️ Information platform only</span>
                  <span>•</span>
                  <span>Not a broker or advisor</span>
                  <span>•</span>
                  <span>No transaction handling</span>
                </div>
              </div>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}