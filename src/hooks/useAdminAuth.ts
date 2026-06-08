import { useState, useCallback, useEffect } from "react";
import {
  adminLogin as apiLogin,
  adminLogout as apiLogout,
  adminVerifySession,
} from "../lib/api";

const TOKEN_KEY = "admin_token";
const EMAIL_KEY = "admin_email";
const ROLE_KEY = "admin_role";
const AGENCY_SLUG_KEY = "admin_agency_slug";
const AGENCY_ID_KEY = "admin_agency_id";
const AGENCY_NAME_KEY = "admin_agency_name";

export type AdminRole = "global_admin" | "agency_admin";

export function useAdminAuth() {
  const [token, setToken] = useState<string | null>(
    localStorage.getItem(TOKEN_KEY)
  );
  const [email, setEmail] = useState<string | null>(
    localStorage.getItem(EMAIL_KEY)
  );
  const [role, setRole] = useState<AdminRole | null>(
    (localStorage.getItem(ROLE_KEY) as AdminRole) || null
  );
  const [agencySlug, setAgencySlug] = useState<string | null>(
    localStorage.getItem(AGENCY_SLUG_KEY)
  );
  const [agencyId, setAgencyId] = useState<string | null>(
    localStorage.getItem(AGENCY_ID_KEY)
  );
  const [agencyName, setAgencyName] = useState<string | null>(
    localStorage.getItem(AGENCY_NAME_KEY)
  );
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(!!localStorage.getItem(TOKEN_KEY));
  const [error, setError] = useState("");

  const isAuthenticated = !!token;
  const isGlobalAdmin = role === "global_admin";

  // Verify session on mount to refresh role/agency info
  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (!stored) {
      setVerifying(false);
      return;
    }
    adminVerifySession(stored)
      .then((res) => {
        setRole(res.role);
        setAgencySlug(res.agency_slug || null);
        setAgencyId(res.agency_id || null);
        setAgencyName(res.agency_name || null);
        localStorage.setItem(ROLE_KEY, res.role);
        if (res.agency_slug) localStorage.setItem(AGENCY_SLUG_KEY, res.agency_slug);
        if (res.agency_id) localStorage.setItem(AGENCY_ID_KEY, res.agency_id);
        if (res.agency_name) localStorage.setItem(AGENCY_NAME_KEY, res.agency_name);
      })
      .catch(() => {
        // Session expired
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(EMAIL_KEY);
        localStorage.removeItem(ROLE_KEY);
        localStorage.removeItem(AGENCY_SLUG_KEY);
        localStorage.removeItem(AGENCY_ID_KEY);
        localStorage.removeItem(AGENCY_NAME_KEY);
        setToken(null);
        setEmail(null);
        setRole(null);
        setAgencySlug(null);
        setAgencyId(null);
        setAgencyName(null);
      })
      .finally(() => setVerifying(false));
  }, []);

  const login = useCallback(async (loginEmail: string, password: string) => {
    setLoading(true);
    setError("");
    try {
      const result = await apiLogin(loginEmail, password);
      localStorage.setItem(TOKEN_KEY, result.token);
      localStorage.setItem(EMAIL_KEY, loginEmail);
      localStorage.setItem(ROLE_KEY, result.role || "global_admin");
      if (result.agency_slug) localStorage.setItem(AGENCY_SLUG_KEY, result.agency_slug);
      if (result.agency_id) localStorage.setItem(AGENCY_ID_KEY, result.agency_id);
      if (result.agency_name) localStorage.setItem(AGENCY_NAME_KEY, result.agency_name);
      setToken(result.token);
      setEmail(loginEmail);
      setRole(result.role || "global_admin");
      setAgencySlug(result.agency_slug || null);
      setAgencyId(result.agency_id || null);
      setAgencyName(result.agency_name || null);
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EMAIL_KEY);
    localStorage.removeItem(ROLE_KEY);
    localStorage.removeItem(AGENCY_SLUG_KEY);
    localStorage.removeItem(AGENCY_ID_KEY);
    localStorage.removeItem(AGENCY_NAME_KEY);
    const currentToken = token;
    setToken(null);
    setEmail(null);
    setRole(null);
    setAgencySlug(null);
    setAgencyId(null);
    setAgencyName(null);
    if (currentToken) {
      try {
        await apiLogout(currentToken);
      } catch {
        /* ignore */
      }
    }
  }, [token]);

  return {
    token,
    email,
    role,
    agencySlug,
    agencyId,
    agencyName,
    isAuthenticated,
    isGlobalAdmin,
    loading,
    verifying,
    error,
    login,
    logout,
  };
}
