import React from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Shield, ShieldAlert, LogOut, User as UserIcon, Radio, LayoutDashboard, History } from 'lucide-react';

export const Navbar: React.FC = () => {
  const { user, profile, isAdmin, signOut, isConfigured } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const isInAdmin = location.pathname.startsWith('/admin');

  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-800/80 bg-[#090d16]/90 backdrop-blur-md">
      <div className="flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Brand / Logo */}
        <div className="flex items-center gap-3">
          <Link to={isAdmin && isInAdmin ? "/admin" : "/dashboard"} className="flex items-center gap-2.5 group">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 group-hover:border-emerald-500/40 transition-colors">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-semibold tracking-tight text-white">SmartDoor</span>
                <span className="text-xs px-1.5 py-0.5 rounded font-mono font-medium bg-slate-800 text-slate-300 border border-slate-700/60">
                  GUARD
                </span>
              </div>
              <p className="text-[10px] text-slate-500 font-mono tracking-wider hidden sm:block">ESP32 BLE AUTH</p>
            </div>
          </Link>

          {!isConfigured && (
            <div className="hidden md:flex items-center gap-1.5 text-xs text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-full border border-amber-500/20">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
              Demo Mode (.env setup required)
            </div>
          )}
        </div>

        {/* Right action area */}
        <div className="flex items-center gap-2 sm:gap-4">
          {/* Admin toggle badge if admin user */}
          {isAdmin && (
            <Link
              to={isInAdmin ? "/dashboard" : "/admin"}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all ${
                isInAdmin
                  ? "bg-slate-800/80 text-slate-300 border-slate-700 hover:bg-slate-800 hover:text-white"
                  : "bg-rose-500/10 text-rose-400 border-rose-500/30 hover:bg-rose-500/20"
              }`}
            >
              {isInAdmin ? (
                <>
                  <LayoutDashboard className="h-3.5 w-3.5" />
                  <span>Switch to User View</span>
                </>
              ) : (
                <>
                  <ShieldAlert className="h-3.5 w-3.5" />
                  <span>Admin Portal</span>
                </>
              )}
            </Link>
          )}

          {user && (
            <div className="flex items-center gap-3">
              <Link
                to="/profile"
                className="flex items-center gap-2.5 p-1 sm:px-2.5 sm:py-1.5 rounded-lg hover:bg-slate-800/60 transition-colors border border-transparent hover:border-slate-800"
              >
                <div className="h-7 w-7 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs text-emerald-400 font-semibold uppercase">
                  {profile?.display_name ? profile.display_name[0] : (user.email ? user.email[0] : 'U')}
                </div>
                <div className="text-left hidden sm:block">
                  <div className="text-xs font-medium text-slate-200 truncate max-w-[120px]">
                    {profile?.display_name || user.email?.split('@')[0]}
                  </div>
                  <div className="text-[10px] text-slate-500 capitalize">{profile?.role || 'User'}</div>
                </div>
              </Link>

              <button
                onClick={handleSignOut}
                title="Log out"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 hover:border-rose-500/20 transition-all"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
