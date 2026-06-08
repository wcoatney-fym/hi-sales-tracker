import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Header from "./components/layout/Header";
import Leaderboard from "./pages/Leaderboard";
import IntakeForm from "./pages/IntakeForm";
import ThankYou from "./pages/ThankYou";
import AdminLogin from "./pages/AdminLogin";
import AdminDashboard from "./pages/AdminDashboard";
import AgentLogin from "./pages/AgentLogin";
import AgentProfile from "./pages/AgentProfile";
import MobileNav from "./components/layout/MobileNav";
import { AgentAuthProvider } from "./hooks/useAgentAuth";

export default function App() {
  return (
    <BrowserRouter>
      <AgentAuthProvider>
      <div className="min-h-screen bg-navy-dark">
        <Header />
        <Routes>
          <Route path="/" element={<AgentProfile />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/submit" element={<IntakeForm />} />
          <Route path="/thank-you" element={<ThankYou />} />
          <Route path="/agent" element={<AgentLogin />} />
          <Route path="/agent/profile" element={<Navigate to="/" replace />} />
          <Route path="/admin" element={<AdminLogin />} />
          <Route path="/admin/dashboard" element={<AdminDashboard />} />
          <Route path="/admin/dashboard/:agencySlug" element={<AdminDashboard />} />
        </Routes>
        <MobileNav />
      </div>
      </AgentAuthProvider>
    </BrowserRouter>
  );
}
