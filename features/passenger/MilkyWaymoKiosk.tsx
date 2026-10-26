"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { TypewriterText } from "@/features/dialogue/TypewriterText";
import { usePlay } from "@/features/play/PlayContext";
import {
  flightVisualsSettled,
  waitForFlightVisuals,
  warmFlightCinematic,
} from "@/features/ship/flight-cinematic-images";
import { getLocation, getLocationPlanetId } from "@/game/content/locations";
import { getPlanetPresentation } from "@/game/content/planets";
import { PASSENGER_KIOSK_COPY as COPY } from "@/game/content/passenger-kiosk";
import { passengerRouteFrom } from "@/game/content/passenger-routes";
import { bookPassageAction } from "@/server/actions";

type Screen = "welcome" | "confirm" | "insufficient";

/** "3 minutes", "1 minute", "3 min 30 s": the journey's authored duration, never rounded up. */
export function passengerDurationLabel(durationMs: number): string {
  const totalSeconds = Math.round(durationMs / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds} seconds`;
  const whole = `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  return seconds === 0 ? whole : `${whole} ${seconds} s`;
}

/**
 * Milky Waymo's ticketing kiosk (#404): the activity of the two check-in Local
 * Places, one shared implementation whose destination is the opposite landing hub
 * from wherever it stands.
 *
 * It is a customer-facing machine, so it deliberately does not wear RuneSpace's
 * dark skin: a rounded white cabinet and a vivid blue touchscreen in the approved
 * logo's colours (`.mw-kiosk` in app/globals.css). Everything on it is a
 * presentation of server-projected facts: whether the service is unlocked, the
 * fare, the duration and the balance all come from `state.passenger` and
 * `state.credits`. The kiosk decides nothing. BOOK PASSAGE only opens the
 * confirmation; the one confirmed command is what charges and departs, and the
 * server re-checks the place, the unlock, the character's state and the balance
 * before it does, so a stale or forged tap can neither overcharge nor board.
 *
 * Only the welcome line types itself (the dialogue treatment); fares, balances,
 * controls and warnings appear immediately. The art for the flight is warmed
 * while the player decides, so takeoff never opens on a blank frame.
 */
export function MilkyWaymoKiosk({ localPlaceId }: { localPlaceId: string }) {
  const { acceptState, enqueueForeground, foregroundBusy, releaseCommand, state } = usePlay();
  const route = passengerRouteFrom(state.location.currentLocationId);
  const [screen, setScreen] = useState<Screen>("welcome");
  const [feedback, setFeedback] = useState<string>();
  const [preparing, setPreparing] = useState(false);
  const [boarding, setBoarding] = useState(false);
  // The welcome line types once per visit; coming back from another screen shows it whole.
  const [welcomeTyped, setWelcomeTyped] = useState(false);
  const [, startTransition] = useTransition();
  const headingId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const routeId = route?.id;
  useEffect(() => {
    if (routeId) warmFlightCinematic(routeId);
  }, [routeId]);

  // A new screen is a new thing to read: its title takes focus, so keyboard and
  // screen-reader users land on it instead of on a control that has gone away.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    titleRef.current?.focus();
  }, [screen]);

  useEffect(() => {
    if (screen === "welcome") {
      const timer = window.setTimeout(() => setWelcomeTyped(true), 0);
      return () => window.clearTimeout(timer);
    }
  }, [screen]);

  if (!route || route.checkInLocalPlaceId !== localPlaceId) return null;
  const routeIdentity = route.id;
  const destinationName =
    getLocation(route.destinationLocationId)?.displayName ?? route.destinationLocationId;
  const destinationPlanetId = getLocationPlanetId(route.destinationLocationId);
  const destinationPlanetName = destinationPlanetId
    ? getPlanetPresentation(destinationPlanetId).displayName
    : undefined;
  const { fareCredits, durationMs, unlocked } = state.passenger;
  const duration = passengerDurationLabel(durationMs);
  const credits = state.credits;
  const busy = foregroundBusy || preparing || boarding;

  function showScreen(next: Screen) {
    setFeedback(undefined);
    setScreen(next);
  }

  function requestBoard() {
    if (busy) return;
    setFeedback(undefined);
    if (flightVisualsSettled(routeIdentity)) {
      board();
      return;
    }
    setPreparing(true);
    void waitForFlightVisuals(routeIdentity).then(() => {
      // Leaving the place while waiting abandons the tap: nothing was sent.
      if (!mounted.current) return;
      setPreparing(false);
      board();
    });
  }

  function board() {
    enqueueForeground(() => {
      setBoarding(true);
      setFeedback(undefined);
      startTransition(async () => {
        try {
          const result = await bookPassageAction({
            characterId: state.characterId,
            localPlaceId,
          });
          if ("error" in result) {
            setFeedback(result.error);
            return;
          }
          acceptState(result.state);
          if (result.booking.status === "refused") {
            if (result.booking.reason === "insufficient_credits") setScreen("insufficient");
            else setFeedback(result.booking.message);
          }
        } catch {
          setFeedback(
            "Comms interruption. Your booking could not be confirmed; check your balance.",
          );
        } finally {
          setBoarding(false);
          releaseCommand();
        }
      });
    });
  }

  return (
    <section
      aria-labelledby={headingId}
      className="mw-kiosk"
      data-milky-waymo-kiosk={localPlaceId}
      data-kiosk-screen={unlocked ? screen : "locked"}
    >
      <div className="mw-kiosk__cabinet">
        <header className="mw-kiosk__top">
          <div className="mw-kiosk__brand">
            <h2 className="m-0" id={headingId}>
              <Image
                alt="Milky Waymo"
                className="mw-kiosk__logo"
                height={332}
                priority
                src="/branding/milky-waymo-logo.webp"
                width={720}
              />
            </h2>
            <p className="mw-kiosk__tagline">{COPY.tagline}</p>
          </div>
          <p className="mw-kiosk__status" data-kiosk-status role="status">
            <span aria-hidden="true" className="mw-kiosk__lamp" />
            {COPY.status}
          </p>
        </header>

        <div className="mw-kiosk__bezel">
          <div className="mw-kiosk__screen" data-kiosk-screen-surface>
            {!unlocked ? (
              <LockedScreen titleRef={titleRef} />
            ) : screen === "confirm" ? (
              <ConfirmScreen
                boarding={boarding}
                busy={busy}
                destinationName={destinationName}
                destinationPlanetName={destinationPlanetName}
                duration={duration}
                fareCredits={fareCredits}
                feedback={feedback}
                onBack={() => showScreen("welcome")}
                onBoard={requestBoard}
                preparing={preparing}
                titleRef={titleRef}
              />
            ) : screen === "insufficient" ? (
              <InsufficientScreen
                credits={credits}
                fareCredits={fareCredits}
                onBack={() => showScreen("welcome")}
                titleRef={titleRef}
              />
            ) : (
              <WelcomeScreen
                busy={busy}
                credits={credits}
                destinationName={destinationName}
                destinationPlanetName={destinationPlanetName}
                duration={duration}
                fareCredits={fareCredits}
                onBook={() => showScreen(credits >= fareCredits ? "confirm" : "insufficient")}
                welcomeTyped={welcomeTyped}
              />
            )}
          </div>
        </div>

        <div aria-hidden="true" className="mw-kiosk__base">
          <span className="mw-kiosk__slot" />
          <span className="mw-kiosk__reader">
            <svg fill="none" height="18" viewBox="0 0 24 24" width="18">
              <path
                d="M7 9a5 5 0 0 1 0 6M11 6.5a9 9 0 0 1 0 11M15 4a13 13 0 0 1 0 16"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="2"
              />
            </svg>
          </span>
          <span className="mw-kiosk__slot" />
        </div>
      </div>
    </section>
  );
}

type TitleRef = React.RefObject<HTMLHeadingElement | null>;

function ScreenTitle({ children, titleRef }: { children: string; titleRef: TitleRef }) {
  return (
    <h3 className="mw-kiosk__title" ref={titleRef} tabIndex={-1}>
      {children}
    </h3>
  );
}

function LockedScreen({ titleRef }: { titleRef: TitleRef }) {
  return (
    <div data-kiosk-locked>
      <ScreenTitle titleRef={titleRef}>{COPY.locked.title}</ScreenTitle>
      <p className="mw-kiosk__quote">{COPY.locked.quote}</p>
    </div>
  );
}

function WelcomeScreen({
  busy,
  credits,
  destinationName,
  destinationPlanetName,
  duration,
  fareCredits,
  onBook,
  welcomeTyped,
}: {
  busy: boolean;
  credits: number;
  destinationName: string;
  destinationPlanetName: string | undefined;
  duration: string;
  fareCredits: number;
  onBook: () => void;
  welcomeTyped: boolean;
}) {
  return (
    <div data-kiosk-welcome>
      <TypewriterText
        className="mw-kiosk__quote"
        initiallyComplete={welcomeTyped}
        text={COPY.welcome}
      />
      <div className="mw-kiosk__destination">
        <p className="mw-kiosk__eyebrow">{COPY.destinationLabel}</p>
        <p className="mw-kiosk__destination-name" data-kiosk-destination>
          {destinationName}
        </p>
        {destinationPlanetName ? (
          <p className="mw-kiosk__eyebrow" data-kiosk-planet>
            {destinationPlanetName}
          </p>
        ) : null}
      </div>
      <dl className="mw-kiosk__facts">
        <div className="mw-kiosk__fact">
          <dt>One-way fare</dt>
          <dd data-kiosk-fare>{fareCredits} CR</dd>
        </div>
        <div className="mw-kiosk__fact">
          <dt>Estimated travel time</dt>
          <dd data-kiosk-duration>{duration}</dd>
        </div>
        <div className="mw-kiosk__fact">
          <dt>Your available Credits</dt>
          <dd data-kiosk-credits>{credits.toLocaleString("en-US")} CR</dd>
        </div>
      </dl>
      <p className="mw-kiosk__note" data-kiosk-belongings>
        {COPY.belongings}
      </p>
      <div className="mw-kiosk__actions">
        <button
          className="mw-kiosk__button mw-kiosk__button--primary"
          data-kiosk-book
          disabled={busy}
          onClick={onBook}
          type="button"
        >
          {COPY.book(fareCredits)}
        </button>
      </div>
    </div>
  );
}

function ConfirmScreen({
  boarding,
  busy,
  destinationName,
  destinationPlanetName,
  duration,
  fareCredits,
  feedback,
  onBack,
  onBoard,
  preparing,
  titleRef,
}: {
  boarding: boolean;
  busy: boolean;
  destinationName: string;
  destinationPlanetName: string | undefined;
  duration: string;
  fareCredits: number;
  feedback: string | undefined;
  onBack: () => void;
  onBoard: () => void;
  preparing: boolean;
  titleRef: TitleRef;
}) {
  return (
    <div data-kiosk-confirm>
      <ScreenTitle titleRef={titleRef}>{COPY.confirm.title}</ScreenTitle>
      <p className="mw-kiosk__quote">{COPY.confirm.quote}</p>
      <div className="mw-kiosk__destination">
        <p className="mw-kiosk__eyebrow">{COPY.destinationLabel}</p>
        <p className="mw-kiosk__destination-name" data-kiosk-destination>
          {destinationName}
        </p>
        {destinationPlanetName ? (
          <p className="mw-kiosk__eyebrow" data-kiosk-planet>
            {destinationPlanetName}
          </p>
        ) : null}
      </div>
      <dl className="mw-kiosk__facts mw-kiosk__facts--pair">
        <div className="mw-kiosk__fact">
          <dt>One-way fare</dt>
          <dd data-kiosk-fare>{fareCredits} CR</dd>
        </div>
        <div className="mw-kiosk__fact">
          <dt>Estimated travel time</dt>
          <dd data-kiosk-duration>{duration}</dd>
        </div>
      </dl>
      <p className="mw-kiosk__note" data-kiosk-belongings>
        {COPY.confirm.belongings}
      </p>
      <p className="mw-kiosk__warning" data-kiosk-warning>
        <svg aria-hidden="true" fill="none" height="22" viewBox="0 0 24 24" width="22">
          <path
            d="M12 3 2.5 20h19L12 3Zm0 6.5v5m0 3v.01"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
          />
        </svg>
        <span>{COPY.confirm.warning}</span>
      </p>
      <div className="mw-kiosk__actions mw-kiosk__actions--pair">
        <button
          className="mw-kiosk__button mw-kiosk__button--secondary"
          data-kiosk-not-yet
          disabled={busy}
          onClick={onBack}
          type="button"
        >
          {COPY.confirm.back}
        </button>
        <button
          className="mw-kiosk__button mw-kiosk__button--primary"
          data-kiosk-board
          disabled={busy}
          onClick={onBoard}
          type="button"
        >
          {preparing
            ? "PREPARING FLIGHT…"
            : boarding
              ? "BOARDING…"
              : COPY.confirm.board(fareCredits)}
        </button>
      </div>
      {feedback ? (
        <p className="mw-kiosk__feedback" data-kiosk-feedback role="alert">
          {feedback}
        </p>
      ) : null}
    </div>
  );
}

function InsufficientScreen({
  credits,
  fareCredits,
  onBack,
  titleRef,
}: {
  credits: number;
  fareCredits: number;
  onBack: () => void;
  titleRef: TitleRef;
}) {
  return (
    <div data-kiosk-insufficient>
      <ScreenTitle titleRef={titleRef}>{COPY.insufficient.title}</ScreenTitle>
      <p className="mw-kiosk__quote">{COPY.insufficient.quote}</p>
      <dl className="mw-kiosk__facts mw-kiosk__facts--pair">
        <div className="mw-kiosk__fact">
          <dt>One-way fare</dt>
          <dd data-kiosk-fare>{fareCredits} CR</dd>
        </div>
        <div className="mw-kiosk__fact">
          <dt>Your available Credits</dt>
          <dd data-kiosk-credits>{credits.toLocaleString("en-US")} CR</dd>
        </div>
      </dl>
      <p className="mw-kiosk__note">{COPY.insufficient.fare(fareCredits)}</p>
      <div className="mw-kiosk__actions">
        <button
          className="mw-kiosk__button mw-kiosk__button--primary"
          data-kiosk-return
          onClick={onBack}
          type="button"
        >
          {COPY.insufficient.back}
        </button>
      </div>
    </div>
  );
}
