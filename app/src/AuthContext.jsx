import { createContext, useContext, useState, useEffect, useCallback } from "react";
import {
  supabase,
  getCurrentUser,
  getSession,
  onAuthStateChange,
  signIn as supabaseSignIn,
  signUp as supabaseSignUp,
  signOut as supabaseSignOut,
  resetPassword as supabaseResetPassword,
  updatePassword as supabaseUpdatePassword,
} from "./supabase";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    const current = await getCurrentUser();
    setUser(current);
    return current;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const s = await getSession();
        if (cancelled) return;
        setSession(s);
        if (s) {
          const u = await getCurrentUser();
          if (!cancelled) setUser(u);
        }
      } catch (e) {
        console.error("AuthContext init error:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    init();

    const { data: sub } = onAuthStateChange((event, s) => {
      if (cancelled) return;
      setSession(s);
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        setUser(s?.user ?? null);
      } else if (event === "SIGNED_OUT") {
        setUser(null);
        setSession(null);
      }
    });

    return () => {
      cancelled = true;
      sub?.unsubscribe?.();
    };
  }, []);

  const signIn = useCallback(async (email, password) => {
    const { data, error } = await supabaseSignIn(email, password);
    if (data?.user) setUser(data.user);
    return { data, error };
  }, []);

  const signUp = useCallback(async (email, password, username) => {
    const { data, error } = await supabaseSignUp(email, password, username);
    return { data, error };
  }, []);

  const signOut = useCallback(async () => {
    await supabaseSignOut();
    setUser(null);
    setSession(null);
  }, []);

  const resetPassword = useCallback(async (email) => {
    return await supabaseResetPassword(email);
  }, []);

  const updatePassword = useCallback(async (newPassword) => {
    return await supabaseUpdatePassword(newPassword);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        signIn,
        signUp,
        signOut,
        resetPassword,
        updatePassword,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
