/**
 * Milky Waymo's cabin assistant script (#404): a noninteractive, preauthored
 * automated pilot voice. No model, no chat and no audio — only the lines below,
 * chosen by `game/domain/cabin-announcements`.
 *
 * The voice is cheerful, sincere and bureaucratically deadpan. Mid-flight lines
 * are planet-neutral so either direction can use any of them, and none invents a
 * fee, a malfunction, a secret, lore or a human pilot.
 */

/** The fixed greeting, shown from the moment of departure. */
export const CABIN_DEPARTURE_ANNOUNCEMENT =
  "Welcome aboard Milky Waymo! Please sit back, relax, and enjoy your journey. Your pilot is fully automated, thoroughly tested, and legally considered a transportation professional.";

/** The fixed sign-off, with the arrival's own name interpolated. */
export function cabinArrivalAnnouncement(destinationName: string): string {
  return `Congratulations! You have successfully arrived at ${destinationName}. Please collect your belongings and exit the vehicle. Milky Waymo appreciates your business and looks forward to charging you again.`;
}

/** The twelve mid-flight lines the owner's co-author approved. */
export const CHATGPT_CABIN_ANNOUNCEMENTS = [
  "For your comfort, the windows have been calibrated to display approximately what is outside.",
  "Your pilot is fully autonomous and has never asked to take the scenic route.",
  "Our navigation system has considered thousands of possible paths. You're on one of them.",
  "Milky Waymo reminds you that the stars outside are authentic and provided at no additional charge.",
  "Please keep your personal belongings close. The shuttle already has plenty to keep track of.",
  "Your estimated arrival time remains within the accepted range of an estimate.",
  "There is no need to tip your pilot. It has nowhere to put the money.",
  "A gentle reminder that the aisle is for walking, not for contemplating the vastness of space.",
  "We're pleased to report that your cabin remains comfortably attached to the rest of the vehicle.",
  "If you experience a brief feeling of cosmic insignificance, please know that it is not a service-related issue.",
  "We appreciate your patience during this uneventful stretch of the journey. Uneventful is our preferred kind.",
  "Milky Waymo is proud to bring the convenience of public transit to places that really shouldn't have it.",
] as const;

/** The twelve additional lines written for this slice, pending owner review. */
export const CLAUDE_CABIN_ANNOUNCEMENTS = [
  "Please remain seated while the shuttle is in motion. Standing will be available after arrival.",
  "Milky Waymo reminds passengers that the seat belt is most effective when worn.",
  "Our records show that you are currently in transit. We are pleased to confirm this.",
  "The cabin temperature has been set to comfortable. Milky Waymo is proud of this setting.",
  "Please be advised that your destination is getting closer. This is the intended effect.",
  "Milky Waymo is pleased to report that this journey is proceeding in the manner of a journey.",
  "Questions about the trip are welcome. Answers are available upon arrival.",
  "Milky Waymo invites you to enjoy the journey, which is the part between where you were and where you are going.",
  "Your pilot wishes to thank you for riding with Milky Waymo. It practiced the sentence in advance.",
  "Please refrain from leaning on the cabin walls. They are holding up the ceiling.",
  "Thank you for traveling with Milky Waymo. Please continue doing so until arrival.",
  "In the unlikely event of a landing, please remain calm. Landings are planned.",
] as const;

/** The one 24-line pool a journey's five mid-flight announcements are drawn from. */
export const CABIN_ANNOUNCEMENT_POOL: readonly string[] = [
  ...CHATGPT_CABIN_ANNOUNCEMENTS,
  ...CLAUDE_CABIN_ANNOUNCEMENTS,
];

/**
 * Seconds into a journey at which each mid-flight line replaces the one before:
 * 00:30, 01:00, 01:30, 02:00 and 02:30 of the three-minute flight.
 */
export const CABIN_ANNOUNCEMENT_SLOT_SECONDS = [30, 60, 90, 120, 150] as const;
