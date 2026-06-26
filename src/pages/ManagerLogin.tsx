import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ShieldCheck, Loader2, AlertCircle } from "lucide-react";
import { useManagerAuth } from "../hooks/useManagerAuth";

export default function ManagerLogin() {
  const navigate = useNavigate();
  const { login, loading, error, isAuthenticated } = useManagerAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState("");

  if (isAuthenticated) {
    return <Navigate to="/manager" replace />;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError("");
    if (!username.trim() || !password) {
      setFormError("Username and password are required.");
      return;
    }
    const result = await login(username.trim(), password);
    if (result) navigate("/manager");
  };

  return (
    <main className="max-w-md mx-auto px-4 sm:px-6 py-12 sm:py-20 pb-24 lg:pb-20">
      <div className="card-navy-light p-8 animate-fade-in">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-gold/10 rounded-xl flex items-center justify-center mx-auto mb-4">
            <ShieldCheck className="text-gold" size={28} />
          </div>
          <h1 className="text-xl font-bold text-white">Agency Manager Portal</h1>
          <p className="mt-1 text-sm text-slate-400">
            Sign in to work your agency's at-risk book
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              placeholder="Your manager username"
              className="input-field"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="Enter password"
              className="input-field"
            />
          </div>

          {(formError || error) && (
            <div className="flex items-center gap-2 p-3 bg-red-500/10 rounded-lg border border-red-500/30">
              <AlertCircle className="text-red-400 flex-shrink-0" size={16} />
              <span className="text-sm text-red-300">{formError || error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="animate-spin" size={18} />
                Signing in...
              </>
            ) : (
              "Sign In"
            )}
          </button>
        </form>
      </div>
    </main>
  );
}
