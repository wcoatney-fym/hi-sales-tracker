import { useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { Shield, Loader2, Trophy, Flame, Star } from "lucide-react";
import { useAgentAuth } from "../hooks/useAgentAuth";

export default function AgentLogin() {
  const navigate = useNavigate();
  const { login, isAuthenticated, loading: authLoading } = useAgentAuth();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [writingNumber, setWritingNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  if (authLoading) {
    return (
      <main className="min-h-screen bg-navy-dark flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-gold" />
      </main>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/agent/profile" replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await login(firstName, lastName, writingNumber);
      navigate("/agent/profile");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-navy-dark flex items-center justify-center px-4 py-12 pb-24 lg:pb-12">
      <div className="w-full max-w-md">
        {/* Decorative top */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-gold to-gold-dark shadow-lg shadow-gold/20 mb-4">
            <Shield size={32} className="text-navy-dark" />
          </div>
          <h1 className="text-2xl font-bold text-white">Agent Portal</h1>
          <p className="text-sm text-slate-400 mt-2">
            Sign in to view your stats, achievements, and challenges
          </p>
        </div>

        {/* Floating gamification badges */}
        <div className="flex justify-center gap-6 mb-6 opacity-40">
          <Trophy size={20} className="text-gold animate-pulse" />
          <Flame size={20} className="text-orange-400 animate-pulse" style={{ animationDelay: "0.3s" }} />
          <Star size={20} className="text-emerald-400 animate-pulse" style={{ animationDelay: "0.6s" }} />
        </div>

        {/* Login Card */}
        <form
          onSubmit={handleSubmit}
          className="card-navy p-6 sm:p-8 border border-slate-700/50"
        >
          {error && (
            <div className="mb-5 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                First Name
              </label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                className="w-full px-4 py-3 rounded-lg bg-navy-dark border border-slate-600/50 text-white placeholder-slate-500 focus:outline-none focus:border-gold/50 focus:ring-1 focus:ring-gold/30 transition-colors"
                placeholder="Enter your first name"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Last Name
              </label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
                className="w-full px-4 py-3 rounded-lg bg-navy-dark border border-slate-600/50 text-white placeholder-slate-500 focus:outline-none focus:border-gold/50 focus:ring-1 focus:ring-gold/30 transition-colors"
                placeholder="Enter your last name"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                UNL or GTL Writing Number
              </label>
              <input
                type="text"
                value={writingNumber}
                onChange={(e) => setWritingNumber(e.target.value)}
                required
                className="w-full px-4 py-3 rounded-lg bg-navy-dark border border-slate-600/50 text-white placeholder-slate-500 focus:outline-none focus:border-gold/50 focus:ring-1 focus:ring-gold/30 transition-colors"
                placeholder="Enter your writing number"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full mt-6 py-3 rounded-lg bg-gold text-navy-dark font-semibold text-sm hover:bg-gold-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Signing In...
              </>
            ) : (
              "Sign In"
            )}
          </button>

          <p className="text-xs text-slate-500 text-center mt-4">
            Your session will be remembered for 90 days
          </p>
        </form>
      </div>
    </main>
  );
}
