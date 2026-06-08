import { useOnboarding } from "../../hooks/useOnboarding";
import SpotlightTour, { type TourStep } from "./SpotlightTour";

export default function AdminOnboarding() {
  const { completeTour, rosterUploaded, isReplay } = useOnboarding();

  const steps: TourStep[] = [
    {
      title: "Welcome to Your Agency Dashboard",
      description:
        "This is your command center for monitoring production, managing your roster of agents, and tracking at-risk policies across your team.",
    },
    {
      target: "admin-kpi-cards",
      title: "Performance Overview",
      description:
        "These KPI cards summarize your agency's production — total policies, premium, and trends compared to the previous period. Use the date picker to adjust the view.",
      position: "bottom",
    },
    {
      target: "admin-tab-at-risk",
      title: "At-Risk Policies",
      description:
        "This tab shows policies in danger of lapsing. Use it to identify which agents need coaching on retention and track aging by days lapsed.",
      position: "bottom",
    },
    {
      target: "admin-tab-policies",
      title: "Policy Database",
      description:
        "Browse all policies submitted by your agents. Filter by date, agent, carrier, or status. Export to CSV for your own reporting.",
      position: "bottom",
    },
    {
      target: "admin-tab-leaderboard",
      title: "Agent Rankings",
      description:
        "See how your agents stack up against each other. Use this view for coaching conversations and to identify top performers.",
      position: "bottom",
    },
    {
      target: "admin-tab-roster",
      title: "Upload Your Roster",
      description:
        "Add your agents here — upload a CSV or add them one by one. This is required so the system knows which agents belong to your agency. You must add at least one agent to continue.",
      position: "bottom",
      required: !isReplay,
      requiredCheck: () => rosterUploaded,
    },
    {
      title: "You're Ready to Go!",
      description:
        "Your agency dashboard is set up. Monitor production, track at-risk policies, and keep your roster up to date. Your agents can start logging in and submitting business.",
    },
  ];

  return <SpotlightTour steps={steps} onComplete={completeTour} />;
}
