"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { authClient } from "@/features/auth/auth-client";
import {
  analyticsPermitted,
  identifyAnalyticsAccount,
  resetAnalyticsIdentity,
  startAnalytics,
  trackAnalyticsPageview,
} from "./analytics-client";
import { ANALYTICS_CHOICE_EVENT } from "./analytics-policy";

/**
 * Product analytics bootstrap (issue #413), mounted once in the root layout.
 * It renders nothing. Outside production, without a configured token, or after
 * the visitor opts out, it never mounts the runtime below, so no session
 * request, SDK download, or network call is added to the page.
 */
export function AnalyticsProvider() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const sync = () => setEnabled(analyticsPermitted());
    sync();
    window.addEventListener(ANALYTICS_CHOICE_EVENT, sync);
    return () => window.removeEventListener(ANALYTICS_CHOICE_EVENT, sync);
  }, []);

  return enabled ? <AnalyticsRuntime /> : null;
}

function AnalyticsRuntime() {
  const pathname = usePathname();
  const { data: session, isPending } = authClient.useSession();
  const userId = session?.user?.id;
  const landing = useRef(true);

  useEffect(() => {
    void startAnalytics();
  }, []);

  // One pageview per real route change. The query string is never an input, so
  // `?surface=map` and rerenders do not repeat it, and a Play route reports as
  // its template. Only the first pageview of a page load carries attribution.
  useEffect(() => {
    trackAnalyticsPageview(pathname, landing.current);
    landing.current = false;
  }, [pathname]);

  // Identify by the stable Better Auth user ID once a session exists; drop the
  // identity when it ends (sign-out, expiry). Never email or Player name.
  useEffect(() => {
    if (isPending) return;
    if (userId) identifyAnalyticsAccount(userId);
    else resetAnalyticsIdentity();
  }, [isPending, userId]);

  return null;
}
