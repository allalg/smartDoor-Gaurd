import React from 'react';
import { NavLink, Outlet, Link } from 'react-router-dom';
import { Navbar } from './Navbar';
import {
  ShieldAlert,
  Users,
  ScrollText,
  AlertTriangle,
  LayoutDashboard,
  Server,
  Lock,
  ArrowLeft,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export const AdminLayout: React.FC = () => {
  const { isConfigured, profile } = useAuth();

  const adminNavItems = [
    { name: 'Overview', path: '/admin', icon: LayoutDashboard, exact: true },
    { name: 'User Management', path: '/admin/users', icon: Users },
    { name: 'Access Logs', path: '/admin/access-logs', icon: ScrollText },
    { name: 'Intrusion Alerts', path: '/admin/alerts', icon: AlertTriangle },
  ];

  return (
    <div className="min-h-screen bg-[#070a12] text-slate-100 flex flex-col">
      <Navbar />

      {!isConfigured && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2.5 text-xs text-amber-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-amber-400 animate-ping" />
            <span>
              <strong>Supabase demo mode:</strong> Connect valid credentials to manage live access records and user roles.
            </span>
          </div>
        </div>
      )}

      {/* Admin header banner */}
      <div className="bg-rose-950/20 border-b border-rose-900/30 px-4 sm:px-6 lg:px-8 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-1 rounded bg-rose-500/20 text-rose-400">
              <Lock className="h-4 w-4" />
            </div>
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-rose-400">
                Security Administration Console
              </span>
              <span className="text-[11px] text-slate-400 ml-2 hidden sm:inline">
                Role: <span className="font-mono text-slate-200">{profile?.role || 'admin'}</span>
              </span>
            </div>
          </div>

          <Link
            to="/dashboard"
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Return to User Dashboard</span>
          </Link>
        </div>
      </div>

      <div className="flex-1 flex max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 gap-8">
        {/* Desktop Admin Sidebar */}
        <aside className="hidden md:flex flex-col w-64 shrink-0 gap-6">
          <nav className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 px-3 mb-1">
              Admin Operations
            </span>
            {adminNavItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.exact}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                      isActive
                        ? 'bg-rose-500/10 text-rose-300 border border-rose-500/25 shadow-sm shadow-rose-500/5'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 border border-transparent'
                    }`
                  }
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.name}</span>
                </NavLink>
              );
            })}
          </nav>

          <div className="mt-auto p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/80 text-xs text-slate-400 space-y-2">
            <div className="flex items-center gap-2 text-rose-400 font-medium text-[11px]">
              <Server className="h-3.5 w-3.5" />
              <span>RLS Enforcement</span>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Administrative queries are verified by Supabase Row-Level Security policies and trusted Edge Functions.
            </p>
          </div>
        </aside>

        {/* Admin Content Area */}
        <main className="flex-1 min-w-0 pb-20 md:pb-6">
          <Outlet />
        </main>
      </div>

      {/* Mobile Admin Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#070a12]/95 backdrop-blur-lg border-t border-slate-800/90 px-3 py-2 flex items-center justify-around">
        {adminNavItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.exact}
              className={({ isActive }) =>
                `flex flex-col items-center gap-1 py-1 px-2.5 rounded-lg text-xs font-medium transition-colors ${
                  isActive ? 'text-rose-400' : 'text-slate-400 hover:text-slate-200'
                }`
              }
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px]">{item.name}</span>
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
};
