import { useState, useEffect, useCallback, createContext, useContext } from "react";
import type { ReactNode } from "react";
import { useAgentAuth } from "./useAgentAuth";
import {
  agentGetOnboardingStatus,
  agentCompleteOnboarding,
  adminGetOnboardingStatus,
  adminCompleteOnboarding,
} from "../lib/api";

type OnboardingRole = "agent" | "admin" | null;

interface OnboardingState {
  showTour: boolean;
  isReplay: boolean;
  role: OnboardingRole;
  goalSaved: boolean;
  rosterUploaded: boolean;
  setGoalSaved: (v: boolean) => void;
  setRosterUploaded: (v: boolean) => void;
  completeTour: () => void;
  replayTour: () => void;
}

const OnboardingContext = createContext<OnboardingState | null>(null);

const AGENT_TOUR_KEY = "agent_onboarding_seen";
const ADMIN_TOUR_KEY = "admin_onboarding_seen";

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated: agentAuthed, loading: agentLoading } = useAgentAuth();
  const [showTour, setShowTour] = useState(false);
  const [isReplay, setIsReplay] = useState(false);
  const [role, setRole] = useState<OnboardingRole>(null);
  const [goalSaved, setGoalSaved] = useState(false);
  const [rosterUploaded, setRosterUploaded] = useState(false);
  const [checked, setChecked] = useState(false);

  const checkAgentOnboarding = useCallback(async () => {
    const token = localStorage.getItem("agent_session_token");
    if (!token) { setChecked(true); return; }

    try {
      const result = await agentGetOnboardingStatus(token);
      if (!result.completed) {
        setRole("agent");
        setShowTour(true);
      }
    } catch {
      // If API fails, don't block the user
    } finally {
      setChecked(true);
    }
  }, []);

  const checkAdminOnboarding = useCallback(async () => {
    const token = localStorage.getItem("admin_token");
    if (!token) { setChecked(true); return; }

    try {
      const result = await adminGetOnboardingStatus(token);
      if (!result.completed) {
        setRole("admin");
        setShowTour(true);
      }
    } catch {
      // If API fails, don't block the user
    } finally {
      setChecked(true);
    }
  }, []);

  // React to agent auth state changes
  useEffect(() => {
    if (agentLoading) return;

    if (agentAuthed && !localStorage.getItem(AGENT_TOUR_KEY)) {
      checkAgentOnboarding();
    } else {
      const adminToken = localStorage.getItem("admin_token");
      if (adminToken && !localStorage.getItem(ADMIN_TOUR_KEY)) {
        checkAdminOnboarding();
      } else {
        setChecked(true);
      }
    }
  }, [agentAuthed, agentLoading, checkAgentOnboarding, checkAdminOnboarding]);

  const completeTour = useCallback(async () => {
    setShowTour(false);
    setIsReplay(false);

    if (role === "agent") {
      localStorage.setItem(AGENT_TOUR_KEY, "1");
      const token = localStorage.getItem("agent_session_token");
      if (token) {
        try { await agentCompleteOnboarding(token); } catch { /* ignore */ }
      }
    } else if (role === "admin") {
      localStorage.setItem(ADMIN_TOUR_KEY, "1");
      const token = localStorage.getItem("admin_token");
      if (token) {
        try { await adminCompleteOnboarding(token); } catch { /* ignore */ }
      }
    }
  }, [role]);

  const replayTour = useCallback(() => {
    const agentToken = localStorage.getItem("agent_session_token");
    const adminToken = localStorage.getItem("admin_token");

    if (agentToken) {
      setRole("agent");
    } else if (adminToken) {
      setRole("admin");
    }
    setIsReplay(true);
    setGoalSaved(false);
    setRosterUploaded(false);
    setShowTour(true);
  }, []);

  return (
    <OnboardingContext.Provider
      value={{
        showTour: showTour && checked,
        isReplay,
        role,
        goalSaved,
        rosterUploaded,
        setGoalSaved,
        setRosterUploaded,
        completeTour,
        replayTour,
      }}
    >
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding(): OnboardingState {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error("useOnboarding must be used within OnboardingProvider");
  return ctx;
}
