"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { authClient } from "@/features/auth/auth-client";
import {
  analyticsStatus,
  identifyAnalyticsAccount,
  resetAnalyticsIdentity,
  startAnalytics,
  syncLandingAttribution,
  syncPrivacySignalCookie,
  trackAnalyticsPageview,
  type AnalyticsPermission,
} from "./analytics-client";
import { AnalyticsConsentPrompt } from "./AnalyticsConsentPrompt";
import { ANALYTICS_CHOICE_EVENT } from "./analytics-policy";

/**
 * Product analytics bootstrap (issue #413), mounted once in the root layout.
 * Outside production or without a configured token it renders nothing. On
 * production it asks the visitor once (the shipped opt-in model) and mounts the
 * runtime below only while analytics is permitted, so until then no session
 * request, SDK download, storage write, or network call is added to the page.
 * The one thing it does before the visitor chooses is remember the landing
 * UTMs and referring domain in memory (issue #421), for the first permitted
 * pageview; a refusal or privacy signal discards them.
 */
export function AnalyticsProvider() {
  const [status, setStatus] = useState<AnalyticsPermission>("unconfigured");

  useEffect(() => {
    const sync = () => {
      syncPrivacySignalCookie();
      // In memory only, and before the status can change: see the function.
      syncLandingAttribution();
      setStatus(analyticsStatus());
    };
    sync();
    window.addEventListener(ANALYTICS_CHOICE_EVENT, sync);
    return () => window.removeEventListener(ANALYTICS_CHOICE_EVENT, sync);
  }, []);

  if (status === "permitted") return <AnalyticsRuntime />;
  if (status === "needs-consent") return <AnalyticsConsentPrompt />;
  return null;
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
  // its template. Only the first permitted pageview of a page load carries
  // attribution, and it is the one remembered from the landing, not read now.
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
