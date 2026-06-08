import { useState, useEffect, useCallback, createContext, useContext } from "react";
import type { ReactNode } from "react";
import { agentLogin, agentVerifySession, agentLogout } from "../lib/api";

export interface AgentData {
  id: string;
  firstName: string;
  lastName: string;
  agencyId: string | null;
  agencySlug: string | null;
  agencyName: string | null;
}

interface AgentAuthState {
  agent: AgentData | null;
  isAuthenticated: boolean;
  loading: boolean;
  error: string;
  sessionToken: string | null;
  login: (firstName: string, lastName: string, writingNumber: string) => Promise<void>;
  logout: () => Promise<void>;
}

const STORAGE_KEY = "agent_session_token";

const AgentAuthContext = createContext<AgentAuthState | null>(null);

export function AgentAuthProvider({ children }: { children: ReactNode }) {
  const [agent, setAgent] = useState<AgentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const sessionToken = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;

  const verify = useCallback(async () => {
    const token = localStorage.getItem(STORAGE_KEY);
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const data = await agentVerifySession(token);
      setAgent({
        id: data.agent.id,
        firstName: data.agent.firstName,
        lastName: data.agent.lastName,
        agencyId: data.agent.agencyId || null,
        agencySlug: data.agent.agencySlug || null,
        agencyName: data.agent.agencyName || null,
      });
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      setAgent(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    verify();
  }, [verify]);

  const login = async (firstName: string, lastName: string, writingNumber: string) => {
    setError("");
    setLoading(true);
    try {
      const data = await agentLogin(firstName, lastName, writingNumber);
      localStorage.setItem(STORAGE_KEY, data.token);
      setAgent({
        id: data.agent.id,
        firstName: data.agent.firstName,
        lastName: data.agent.lastName,
        agencyId: data.agent.agencyId || null,
        agencySlug: data.agent.agencySlug || null,
        agencyName: data.agent.agencyName || null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    const token = localStorage.getItem(STORAGE_KEY);
    if (token) {
      await agentLogout(token);
    }
    localStorage.removeItem(STORAGE_KEY);
    setAgent(null);
  };

  return (
    <AgentAuthContext.Provider
      value={{
        agent,
        isAuthenticated: !!agent,
        loading,
        error,
        sessionToken,
        login,
        logout,
      }}
    >
      {children}
    </AgentAuthContext.Provider>
  );
}

export function useAgentAuth(): AgentAuthState {
  const ctx = useContext(AgentAuthContext);
  if (!ctx) {
    throw new Error("useAgentAuth must be used within AgentAuthProvider");
  }
  return ctx;
}
