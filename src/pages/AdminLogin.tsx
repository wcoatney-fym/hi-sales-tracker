import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Shield, Loader2, AlertCircle } from "lucide-react";
import { useAdminAuth } from "../hooks/useAdminAuth";
import { useManagerAuth } from "../hooks/useManagerAuth";
import FormField from "../components/ui/FormField";

export default function AdminLogin() {
  const { login, loading, error, isAuthenticated, isGlobalAdmin, agencySlug, verifying } = useAdminAuth();
  const { login: managerLogin, loading: managerLoading } = useManagerAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  // Combined auth error: only surfaced after BOTH admin and manager auth fail,
  // so a manager username doesn't flash the admin "Invalid credentials" first.
  const [authError, setAuthError] = useState("");

  if (verifying) {
    return (
      <main className="max-w-md mx-auto px-4 py-20 flex items-center justify-center">
        <Loader2 className="animate-spin text-gold" size={32} />
      </main>
    );
  }

  if (isAuthenticated) {
    if (isGlobalAdmin) {
      return <Navigate to="/admin/dashboard" replace />;
    }
    return <Navigate to={`/admin/dashboard/${agencySlug}`} replace />;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};

    if (!email.trim()) {
      errs.email = "Username is required";
    }

    if (!password) {
      errs.password = "Password is required";
    }

    setFormErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setAuthError("");

    // 1) Try admin credentials (email-domain match). On success, the
    //    isAuthenticated branch above redirects into the admin dashboard.
    const adminResult = await login(email.trim(), password);
    if (adminResult) return;

    // 2) Fall back to per-person Agency Manager credentials (username match),
    //    so managers can sign in through the same admin portal entry point.
    const managerProfile = await managerLogin(email.trim(), password);
    if (managerProfile) {
      navigate("/manager");
      return;
    }

    setAuthError("Invalid credentials");
  };

  return (
    <main className="max-w-md mx-auto px-4 sm:px-6 py-12 sm:py-20 pb-24 lg:pb-20">
      <div className="card-navy-light p-8 animate-fade-in">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-gold/10 rounded-xl flex items-center justify-center mx-auto mb-4">
            <Shield className="text-gold" size={28} />
          </div>
          <h1 className="text-xl font-bold text-white">Admin Portal</h1>
          <p className="mt-1 text-sm text-slate-400">
            Sign in to manage your agency
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <FormField
            label="Username"
            htmlFor="adminEmail"
            required
            error={formErrors.email}
          >
            <input
              id="adminEmail"
              type="text"
              className={`input-field ${formErrors.email ? "input-error" : ""}`}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setFormErrors((prev) => {
                  const n = { ...prev };
                  delete n.email;
                  return n;
                });
              }}
              placeholder="Username or email"
              autoComplete="username"
            />
          </FormField>

          <FormField
            label="Password"
            htmlFor="adminPassword"
            required
            error={formErrors.password}
          >
            <input
              id="adminPassword"
              type="password"
              className={`input-field ${formErrors.password ? "input-error" : ""}`}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setFormErrors((prev) => {
                  const n = { ...prev };
                  delete n.password;
                  return n;
                });
              }}
              placeholder="Enter password"
              autoComplete="current-password"
            />
          </FormField>

          {(authError || error) && (
            <div className="flex items-center gap-2 p-3 bg-red-500/10 rounded-lg border border-red-500/30">
              <AlertCircle
                className="text-red-400 flex-shrink-0"
                size={16}
              />
              <span className="text-sm text-red-300">{authError || error}</span>
            </div>
          )}

          <button
            type="submit"
            className="btn-primary w-full flex items-center justify-center gap-2"
            disabled={loading || managerLoading}
          >
            {loading || managerLoading ? (
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
