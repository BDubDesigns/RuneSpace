"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { CreditsAmount } from "@/components/ui/CreditsAmount";
import { Feedback } from "@/components/ui/Feedback";
import {
  getTheatreFilm,
  getTheatreScreensAt,
  THEATRE_COPY,
  THEATRE_FILMS,
  THEATRE_TICKET_TIERS,
} from "@/game/content/theatre";
import { getSkillPresentation } from "@/game/content/skill-presentation";
import {
  describeTicketOffer,
  displayedShowings,
  formatCountdown,
  ticketLabel,
  viewerEntry,
} from "@/game/domain/theatre";
import { ActivityPanel } from "@/features/shared/ActivityPanel";
import { usePlay } from "@/features/play/PlayContext";
import { authorizeTheatreViewingAction, buyTheatreTicketAction } from "@/server/actions";
import type { ViewingAuthorization } from "./TheatreViewer";

// The viewer carries the studio's player and stylesheets, so it is fetched only when a player
// actually opens a film, and never on the server.
const TheatreViewer = dynamic(() => import("./TheatreViewer"), { ssr: false });

type Notice = { tone: "success" | "danger" | "muted"; text: string };

/**
 * "The Big Screen" (#491): the Holo Drive-In's programme, tickets, film bonuses and viewer, on the
 * World Location panel. Presentation and intent only. What is showing, what a ticket costs, what
 * the character holds and whether a viewing may start are all the server's: the programme and the
 * character's balances arrive in the Play state, a purchase is one server transaction that judges
 * the showing the player saw against the server's own clock, and every viewing start asks the
 * server again. Nothing here reads a browser time for eligibility; the countdown runs on the
 * synchronized server clock.
 *
 * Renders only for a character standing at a theatre (the server projects the character's theatre
 * facts nowhere else), and so it, and a viewer open inside it, are gone the moment they leave.
 */
export function TheatrePanel() {
  const {
    acceptState,
    enqueueForeground,
    foregroundBusy: busy,
    releaseCommand,
    requestAutoRefresh,
    serverNowMs,
    state,
  } = usePlay();
  const [, startTransition] = useTransition();
  // The first render uses the instant the server stamped on this state, so the server-rendered
  // markup and the first client render agree; the tick below then follows the synchronized clock.
  const [nowMs, setNowMs] = useState(() => Date.parse(state.serverNow));
  const [chosenTierId, setChosenTierId] = useState<string>();
  const [notice, setNotice] = useState<Notice>();
  const [viewerOpen, setViewerOpen] = useState(false);
  const viewerButton = useRef<HTMLButtonElement>(null);
  const confirmation = useRef<HTMLDivElement>(null);

  // The countdown's display tick, on the synchronized server clock rather than the browser's.
  useEffect(() => {
    setNowMs(serverNowMs());
    const timer = window.setInterval(() => setNowMs(serverNowMs()), 1000);
    return () => window.clearInterval(timer);
  }, [serverNowMs]);

  const locationId = state.location.currentLocationId;
  const screen = getTheatreScreensAt(locationId)[0];
  const character = state.theatre.character;
  const projected = screen
    ? state.theatre.screens.find((entry) => entry.screenId === screen.id)
    : undefined;

  // On a phone the confirmation opens below the fold: bring it into view, without animation.
  useEffect(() => {
    if (chosenTierId) confirmation.current?.scrollIntoView({ block: "nearest" });
  }, [chosenTierId]);

  // A new showing makes any half-made choice a choice about the last one.
  const showingIdNow = projected?.now.showingId;
  useEffect(() => {
    setChosenTierId(undefined);
  }, [showingIdNow]);

  // The viewer's start check. A refusal means the server sees the character somewhere or
  // something other than this page does (they walked away in another tab, say). The player is
  // told why first; the fresh state is requested when they close the viewer, because it removes
  // the Big Screen, and the viewer with it, the moment it arrives.
  const characterId = state.characterId;
  const refusedRef = useRef(false);
  const authorize = useCallback(async (): Promise<ViewingAuthorization> => {
    try {
      const result = await authorizeTheatreViewingAction({ characterId });
      if ("error" in result) {
        refusedRef.current = true;
        return { status: "refused", message: result.error };
      }
      if (result.viewing.status === "allowed") {
        return { status: "allowed", filmId: result.viewing.filmId };
      }
      refusedRef.current = true;
      return { status: "refused", message: result.viewing.message };
    } catch {
      return {
        status: "failed",
        message: "Comms interruption. The projector could not confirm your ticket.",
      };
    }
  }, [characterId]);
  const closeViewer = useCallback(() => {
    setViewerOpen(false);
    if (refusedRef.current) {
      refusedRef.current = false;
      requestAutoRefresh();
    }
  }, [requestAutoRefresh]);

  if (!screen || !projected || !character) return null;

  // The programme as the server projected it, until the synchronized clock passes its end. From
  // then until a fresh state arrives (the Play boundary refresh asks for one at the end of every
  // showing) the same schedule rule shows what comes next, and the ticket controls wait.
  const { now, next, stale } = displayedShowings(screen, projected, nowMs);
  const nowFilm = getTheatreFilm(now.filmId);
  const nextFilm = getTheatreFilm(next.filmId);
  const countdown = formatCountdown(Date.parse(now.endsAt) - nowMs);
  const heldTierId = character.heldTiers[now.showingId];
  const heldTier = THEATRE_TICKET_TIERS.find((tier) => tier.id === heldTierId);
  const entry = viewerEntry(character.latestTicket, now.showtimeId);
  const showViewerEntry = entry !== undefined && character.viewer.available;
  const chosenTier = THEATRE_TICKET_TIERS.find((tier) => tier.id === chosenTierId);
  const offer =
    chosenTier && nowFilm
      ? describeTicketOffer({
          tier: chosenTier,
          film: nowFilm,
          remaining: character.buffs[nowFilm.skillId] ?? 0,
          credits: state.credits,
        })
      : undefined;

  function buy() {
    if (!chosenTier || !nowFilm || stale) return;
    const request = { characterId, showingId: now.showingId, tierId: chosenTier.id };
    const filmTitle = nowFilm.title;
    enqueueForeground(() => {
      startTransition(async () => {
        try {
          const result = await buyTheatreTicketAction(request);
          if ("error" in result) {
            setNotice({ tone: "danger", text: result.error });
            return;
          }
          acceptState(result.state);
          const purchase = result.purchase;
          if (purchase.status === "purchased") {
            setChosenTierId(undefined);
            setNotice({
              tone: "success",
              text: `Ticket bought for ${filmTitle}. ${getSkillPresentation(purchase.skillId)?.displayName ?? "Skill"} bonus attempts: ${purchase.buff.remainingBefore} to ${purchase.buff.remainingAfter}.`,
            });
          } else if (
            purchase.reason === "already_purchased" &&
            purchase.heldTierId === request.tierId
          ) {
            // A retry or a second tab finds the first one's receipt: the ticket is already
            // theirs, charged once, so say so rather than report a failure.
            setChosenTierId(undefined);
            setNotice({
              tone: "success",
              text: `You already have this ticket for ${filmTitle}. You were charged once.`,
            });
          } else {
            setChosenTierId(undefined);
            setNotice({ tone: "danger", text: purchase.message });
          }
        } catch {
          setNotice({
            tone: "danger",
            text: "Comms interruption. The Big Screen could not confirm your ticket. Check the showing before trying again: you are never charged twice for one showing.",
          });
          requestAutoRefresh();
        } finally {
          releaseCommand();
        }
      });
    });
  }

  return (
    <ActivityPanel data-theatre-panel title={THEATRE_COPY.sectionHeading}>
      <div className="space-y-2" data-theatre-programme>
        <p className="text-sm text-[color:var(--rs-text-secondary)]" data-now-showing>
          <span className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-primary)]">
            {THEATRE_COPY.nowShowing}
          </span>{" "}
          <span className="font-display text-base font-bold text-[color:var(--rs-text-primary)]">
            {nowFilm?.title}
          </span>
        </p>
        <p className="text-sm text-[color:var(--rs-text-secondary)]" data-up-next>
          <span className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-text-muted)]">
            {THEATRE_COPY.upNext}
          </span>{" "}
          <span className="text-[color:var(--rs-text-primary)]">{nextFilm?.title}</span>
        </p>
        <p className="text-sm text-[color:var(--rs-text-secondary)]" data-theatre-countdown>
          {THEATRE_COPY.nextShowingIn} <span className="tabular-nums">{countdown}</span>
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-2 text-sm" data-theatre-buffs>
        {THEATRE_FILMS.map((film) => (
          <div
            className="rs-bevel-small border border-[color:var(--rs-border-subtle)] bg-[color:var(--rs-surface-control)] px-3 py-2"
            data-theatre-buff={film.skillId}
            key={film.skillId}
          >
            <dt className="text-xs text-[color:var(--rs-text-muted)]">
              {getSkillPresentation(film.skillId)?.displayName ?? film.skillId} bonus attempts
            </dt>
            <dd className="font-display text-lg font-bold tabular-nums text-[color:var(--rs-text-primary)]">
              {character.buffs[film.skillId] ?? 0}
            </dd>
          </div>
        ))}
      </dl>

      {heldTier ? (
        <p
          className="text-sm text-[color:var(--rs-accent-success)]"
          data-theatre-held
          role="status"
        >
          You have a ticket for this showing: {ticketLabel(heldTier)}.
        </p>
      ) : (
        <div className="space-y-2" data-theatre-tickets>
          <p className="text-sm text-[color:var(--rs-text-secondary)]">
            Your Credits: <CreditsAmount amount={state.credits} data-theatre-credits />
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {THEATRE_TICKET_TIERS.map((tier) => {
              const affordable = state.credits >= tier.credits;
              const chosen = chosenTierId === tier.id;
              return (
                <div
                  className={`rs-bevel-small flex flex-col gap-2 border bg-[color:var(--rs-surface-control)] p-3 ${
                    chosen
                      ? "border-[color:var(--rs-accent-primary)]"
                      : "border-[color:var(--rs-border-subtle)]"
                  }`}
                  data-ticket-tier={tier.id}
                  key={tier.id}
                >
                  <p className="font-display text-sm font-bold text-[color:var(--rs-text-primary)]">
                    {ticketLabel(tier)}
                  </p>
                  <p className="text-xs text-[color:var(--rs-text-secondary)]">
                    {tier.capacity} bonus attempts
                  </p>
                  <ActionButton
                    aria-pressed={chosen}
                    disabled={busy || stale || !affordable}
                    intent={chosen ? "primary" : "secondary"}
                    onClick={() => {
                      setNotice(undefined);
                      setChosenTierId(chosen ? undefined : tier.id);
                    }}
                  >
                    {chosen ? "Chosen" : "Choose"}
                  </ActionButton>
                  {!affordable ? (
                    <p className="text-xs text-[color:var(--rs-text-muted)]">Not enough Credits.</p>
                  ) : null}
                </div>
              );
            })}
          </div>
          {stale ? (
            <p className="text-xs text-[color:var(--rs-text-muted)]">Checking the programme...</p>
          ) : null}
          {offer ? (
            <div
              className="space-y-2 border-t border-[color:var(--rs-border-subtle)] pt-3 text-sm"
              data-ticket-confirmation
              ref={confirmation}
              role="group"
              aria-label="Confirm ticket purchase"
            >
              <p className="text-[color:var(--rs-text-primary)]">
                {offer.label} for {nowFilm?.title}.
              </p>
              <p className="text-[color:var(--rs-text-secondary)]" data-ticket-credits>
                Credits: {state.credits} to {offer.creditsAfter}.
              </p>
              <p className="text-[color:var(--rs-text-secondary)]" data-ticket-buff>
                {offer.summary}.
              </p>
              {offer.warning ? (
                <p
                  className="text-[color:var(--rs-accent-mining)]"
                  data-ticket-warning={offer.topUp.outcome}
                >
                  {offer.warning}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <ActionButton
                  disabled={busy || stale || !offer.affordable}
                  intent="primary"
                  loading={busy}
                  onClick={buy}
                >
                  Confirm purchase
                </ActionButton>
                <ActionButton
                  disabled={busy}
                  intent="secondary"
                  onClick={() => setChosenTierId(undefined)}
                >
                  Cancel
                </ActionButton>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {notice ? <Feedback tone={notice.tone}>{notice.text}</Feedback> : null}

      {showViewerEntry ? (
        <ActionButton
          disabled={viewerOpen}
          intent="primary"
          onClick={() => {
            setNotice(undefined);
            setViewerOpen(true);
          }}
          ref={viewerButton}
        >
          {entry.kind === "watch" ? THEATRE_COPY.watchFilm : THEATRE_COPY.replayLastFilm}
        </ActionButton>
      ) : null}

      <p
        className="max-w-2xl text-sm leading-relaxed text-[color:var(--rs-text-secondary)]"
        data-theatre-explanation
      >
        {THEATRE_COPY.ticketExplanation}
      </p>

      {viewerOpen && character.viewer.available ? (
        <TheatreViewer
          authorize={authorize}
          onClose={closeViewer}
          preRollMs={character.viewer.preRollMs}
          returnFocusRef={viewerButton}
          standInAds={character.viewer.standInAds}
        />
      ) : null}
    </ActivityPanel>
  );
}
