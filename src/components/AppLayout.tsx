import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Navbar } from './Navbar';
import {
  LayoutDashboard,
  User,
  History,
  Bluetooth,
  Radio,
  ExternalLink,
  ShieldCheck,
  Music2,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export const AppLayout: React.FC = () => {
  const { isConfigured, profile } = useAuth();

  const navItems = [
    { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
    { name: 'Access History', path: '/access-history', icon: History },
    { name: 'Profile & Music', path: '/profile', icon: Music2 },
  ];

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 flex flex-col">
      <Navbar />

      {/* Supabase unconfigured notification notice */}
      {!isConfigured && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2.5 text-xs text-amber-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-amber-400 animate-ping" />
            <span>
              <strong>Supabase credentials not configured:</strong> Update <code>.env</code> with your Supabase Project URL and Anon Key to enable live database and authentication.
            </span>
          </div>
          <span className="text-amber-400/80 font-mono text-[11px] hidden md:inline">VITE_SUPABASE_URL</span>
        </div>
      )}

      <div className="flex-1 flex max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 gap-8">
        {/* Desktop Sidebar */}
        <aside className="hidden md:flex flex-col w-64 shrink-0 gap-6">
          {/* Quick status pill */}
          <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800/80">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-slate-400">Door Node</span>
              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20 font-mono">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                ESP32 Ready
              </span>
            </div>
            <div className="text-sm font-semibold text-white truncate">Main Entrance Lock</div>
            <div className="text-[11px] text-slate-500 font-mono mt-0.5">IR Proximity + BLE</div>
          </div>

          {/* Navigation links */}
          <nav className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 px-3 mb-1">
              User Menu
            </span>
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                      isActive
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-sm shadow-emerald-500/5'
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

          {/* Protocol specs info box */}
          <div className="mt-auto p-3.5 rounded-xl bg-slate-900/40 border border-slate-800/60 text-xs text-slate-400 space-y-2">
            <div className="flex items-center gap-2 text-slate-300 font-medium text-[11px]">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
              <span>Zero-Trust Flow</span>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Browser transmits single-use OTP over BLE. ESP32 validates independently via Supabase backend.
            </p>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 min-w-0 pb-20 md:pb-6">
          <Outlet />
        </main>
      </div>

      {/* Mobile Bottom Navigation (Optimized for Android Chrome) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#090d16]/95 backdrop-blur-lg border-t border-slate-800/90 px-3 py-2 flex items-center justify-around">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `flex flex-col items-center gap-1 py-1 px-3 rounded-lg text-xs font-medium transition-colors ${
                  isActive ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-200'
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
