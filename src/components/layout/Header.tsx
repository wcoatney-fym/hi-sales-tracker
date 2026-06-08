import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Shield, Menu, X, Trophy, FileText, Lock, User } from "lucide-react";
import { useAgentAuth } from "../../hooks/useAgentAuth";
import { useAdminAuth } from "../../hooks/useAdminAuth";

export default function Header() {
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { isAuthenticated: agentAuthed, loading: agentLoading } = useAgentAuth();
  const { isAuthenticated: adminAuthed, verifying: adminVerifying } = useAdminAuth();

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const isLoggedIn = (!agentLoading && agentAuthed) || (!adminVerifying && adminAuthed);

  const navLinks = [
    { to: "/", label: "My Profile", icon: User },
    { to: "/submit", label: "Submit Enrollment", icon: FileText },
    ...(isLoggedIn ? [{ to: "/leaderboard", label: "Leaderboard", icon: Trophy }] : []),
    { to: "/admin", label: "Admin", icon: Lock },
  ];

  return (
    <header className="bg-navy border-b border-slate-700/50 sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-gold rounded-lg flex items-center justify-center">
              <Shield className="text-navy-dark" size={20} />
            </div>
            <div className="hidden sm:block">
              <span className="text-lg font-bold text-white">
                FYM Financial
              </span>
            </div>
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => {
              const isActive =
                link.to === "/"
                  ? location.pathname === "/"
                  : location.pathname.startsWith(link.to);
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    isActive
                      ? "text-gold bg-gold/10"
                      : "text-slate-300 hover:text-white hover:bg-white/5"
                  }`}
                >
                  <link.icon size={16} />
                  {link.label}
                </Link>
              );
            })}
          </nav>

          <button
            className="md:hidden p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-300 hover:text-white transition-colors"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
          >
            {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      {mobileMenuOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 top-16 bg-black/40 z-40"
            onClick={() => setMobileMenuOpen(false)}
          />
          <nav className="md:hidden absolute left-0 right-0 top-16 bg-navy border-b border-slate-700/50 z-50 animate-fade-in shadow-xl">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3">
              {navLinks.map((link) => {
                const isActive =
                  link.to === "/"
                    ? location.pathname === "/"
                    : location.pathname.startsWith(link.to);
                return (
                  <Link
                    key={link.to}
                    to={link.to}
                    className={`flex items-center gap-3 py-3.5 px-3 text-sm font-medium rounded-lg transition-colors min-h-[48px] ${
                      isActive
                        ? "text-gold bg-gold/10"
                        : "text-slate-300 active:bg-navy-light"
                    }`}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <link.icon size={18} />
                    {link.label}
                  </Link>
                );
              })}
            </div>
          </nav>
        </>
      )}
    </header>
  );
}
