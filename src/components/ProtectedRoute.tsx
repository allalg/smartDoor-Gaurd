import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { ShieldAlert, Loader2 } from 'lucide-react';

export const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isEnabled, loading, isConfigured } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#090d16] flex flex-col items-center justify-center text-slate-400 gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
        <p className="text-sm font-medium">Verifying security session...</p>
      </div>
    );
  }

  // If Supabase is configured and there is no active user, redirect to login
  if (isConfigured && !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // If user account has been disabled by admin
  if (user && !isEnabled) {
    return (
      <div className="min-h-screen bg-[#090d16] flex flex-col items-center justify-center p-6 text-center">
        <div className="max-w-md p-8 rounded-2xl bg-slate-900 border border-rose-500/30 text-slate-200">
          <div className="h-12 w-12 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center mx-auto mb-4">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">Account Access Suspended</h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-6">
            Your door access credentials have been disabled by a system administrator. Please contact your facility administrator for assistance.
          </p>
          <button
            onClick={() => window.location.href = '/login'}
            className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-medium text-sm transition-colors border border-slate-700"
          >
            Back to Sign In
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
