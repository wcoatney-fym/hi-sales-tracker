import { useOnboarding } from "../../hooks/useOnboarding";
import SpotlightTour, { type TourStep } from "./SpotlightTour";

export default function AgentOnboarding() {
  const { completeTour, goalSaved, isReplay } = useOnboarding();

  const steps: TourStep[] = [
    {
      title: "Welcome to Your Portal",
      description:
        "This is your home base for tracking production, competing on the leaderboard, managing your book of business, and submitting new policies. Let's take a quick look around.",
    },
    {
      target: "agent-stats",
      title: "Your Production Stats",
      description:
        "These cards show your real-time production numbers — policies and premium for today, this week, and this month. Watch them update as you submit new business.",
      position: "bottom",
    },
    {
      target: "agent-xp-bar",
      title: "XP and Level Progress",
      description:
        "Every policy you write earns XP. Level up and climb through tiers from Rookie all the way to Diamond. Streaks multiply your XP gains.",
      position: "bottom",
    },
    {
      target: "nav-submit",
      title: "Submit New Business",
      description:
        "Use this to record new enrollments. The 4-step form verifies your identity, captures client info, and logs the policy. This is how you get credit on the leaderboard.",
      position: "bottom",
    },
    {
      target: "nav-leaderboard",
      title: "Leaderboard",
      description:
        "See where you rank against other agents. Rankings reset daily, weekly, and monthly — so every day is a fresh chance to climb. Active challenges and incentives live here too.",
      position: "bottom",
    },
    {
      target: "agent-tab-book",
      title: "My Book of Business",
      description:
        "View all your policies, filter by status, and track at-risk policies that need attention. Log follow-up activities to keep your book healthy.",
      position: "bottom",
    },
    {
      target: "agent-goal-section",
      title: "Set Your Monthly Goal",
      description:
        "Enter your monthly AP (annualized premium) target. This helps you track pace throughout the month and stay motivated. You must set a goal to complete setup.",
      position: "top",
      required: !isReplay,
      requiredCheck: () => goalSaved,
    },
    {
      title: "You're All Set!",
      description:
        "Your portal is ready. Submit your first enrollment, check the leaderboard, and start climbing the ranks. Good luck out there!",
    },
  ];

  return <SpotlightTour steps={steps} onComplete={completeTour} />;
}
