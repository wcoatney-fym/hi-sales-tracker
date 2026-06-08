import { useOnboarding } from "../../hooks/useOnboarding";
import AgentOnboarding from "./AgentOnboarding";
import AdminOnboarding from "./AdminOnboarding";

export default function OnboardingRenderer() {
  const { showTour, role } = useOnboarding();

  if (!showTour) return null;

  if (role === "agent") return <AgentOnboarding />;
  if (role === "admin") return <AdminOnboarding />;

  return null;
}
