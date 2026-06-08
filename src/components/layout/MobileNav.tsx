import { Link, useLocation } from "react-router-dom";
import { Trophy, FileText, User, Lock } from "lucide-react";
import { useAgentAuth } from "../../hooks/useAgentAuth";
import { useAdminAuth } from "../../hooks/useAdminAuth";

export default function MobileNav() {
  const location = useLocation();
  const { isAuthenticated: agentAuthed, loading: agentLoading } = useAgentAuth();
  const { isAuthenticated: adminAuthed, verifying: adminVerifying } = useAdminAuth();

  const isLoggedIn = (!agentLoading && agentAuthed) || (!adminVerifying && adminAuthed);

  const navItems = [
    { to: "/", label: "Profile", icon: User },
    { to: "/submit", label: "Submit", icon: FileText },
    ...(isLoggedIn ? [{ to: "/leaderboard", label: "Board", icon: Trophy }] : []),
    { to: "/admin", label: "Admin", icon: Lock },
  ];

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-navy border-t border-slate-700/50 z-50 safe-area-bottom">
      <div className="flex items-center justify-around h-16 px-2">
        {navItems.map((item) => {
          const isActive =
            item.to === "/"
              ? location.pathname === "/"
              : location.pathname.startsWith(item.to.split("#")[0]) && item.to !== "/";

          return (
            <Link
              key={item.to}
              to={item.to}
              className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg transition-colors min-w-[60px] ${
                isActive ? "text-gold" : "text-slate-400 active:text-slate-200"
              }`}
            >
              <item.icon size={20} />
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
