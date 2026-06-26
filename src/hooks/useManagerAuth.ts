import { useState, useCallback } from "react";
import { managerLogin as apiManagerLogin } from "../lib/api";
import type { ManagerSession } from "../lib/api";

const TOKEN_KEY = "manager_token";
const SESSION_KEY = "manager_session";

export interface ManagerProfile {
  managerId: string;
  username: string;
  displayName: string;
  agencyId: string;
  agencySlug: string;
  agencyName: string;
}

function readStoredProfile(): ManagerProfile | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ManagerProfile;
  } catch {
    return null;
  }
}

// NOTE: the API contract does not expose a manager verify-session endpoint,
// so we trust the locally cached session until a request 401s. If a verify
// endpoint is added later, wire it here mirroring useAdminAuth.
export function useManagerAuth() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [manager, setManager] = useState<ManagerProfile | null>(() => readStoredProfile());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const isAuthenticated = !!token && !!manager;

  const login = useCallback(async (username: string, password: string) => {
    setLoading(true);
    setError("");
    try {
      const session: ManagerSession = await apiManagerLogin(username, password);
      const profile: ManagerProfile = {
        managerId: session.manager_id,
        username: session.username,
        displayName: session.display_name,
        agencyId: session.agency_id,
        agencySlug: session.agency_slug,
        agencyName: session.agency_name,
      };
      localStorage.setItem(TOKEN_KEY, session.token);
      localStorage.setItem(SESSION_KEY, JSON.stringify(profile));
      setToken(session.token);
      setManager(profile);
      return profile;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(SESSION_KEY);
    setToken(null);
    setManager(null);
  }, []);

  return { token, manager, isAuthenticated, loading, error, login, logout };
}
