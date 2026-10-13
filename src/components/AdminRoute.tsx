import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { ShieldX, Loader2 } from 'lucide-react';

export const AdminRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isAdmin, isApproved, isEnabled, loading, isConfigured } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#070a12] flex flex-col items-center justify-center text-slate-400 gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-rose-500" />
        <p className="text-sm font-medium">Validating administrator authorization...</p>
      </div>
    );
  }

  // Redirect to login if unauthenticated
  if (isConfigured && !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // If user is logged in but does not hold the admin role or is not approved
  if (isConfigured && user && (!isAdmin || !isApproved || !isEnabled)) {
    return (
      <div className="min-h-screen bg-[#090d16] flex flex-col items-center justify-center p-6 text-center">
        <div className="max-w-md p-8 rounded-2xl bg-slate-900 border border-amber-500/30 text-slate-200">
          <div className="h-12 w-12 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center mx-auto mb-4">
            <ShieldX className="h-6 w-6" />
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">Unauthorized Access</h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-6">
            The Administration Console is restricted to users with the <span className="text-rose-400 font-mono">admin</span> role. Your current role is restricted.
          </p>
          <a
            href="/dashboard"
            className="inline-block w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-medium text-sm transition-colors border border-slate-700"
          >
            Return to User Dashboard
          </a>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
