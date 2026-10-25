/**
 * The owner-approved copy of Milky Waymo's ticketing kiosk (#404), in one place.
 * The kiosk renders it and the server's refusals quote it, so the words a player
 * reads and the words a refused command returns cannot drift apart.
 */
export const PASSENGER_KIOSK_COPY = {
  brand: "MILKY WAYMO",
  tagline: "Interplanetary Passenger Services",
  status: "AUTOMATED SERVICE ONLINE",
  welcome:
    "Welcome to Milky Waymo! Getting you from here to there, without all that flying yourself nonsense.",
  destinationLabel: "YOUR DESTINATION",
  belongings:
    "Your carried belongings and equipment travel with you. Your personal ship and its cargo remain where you left them.",
  book: (fareCredits: number) => `BOOK PASSAGE — ${fareCredits} CR`,
  confirm: {
    title: "READY FOR TAKEOFF?",
    quote:
      "Excellent choice! Milky Waymo is delighted to provide you with the transportation you have selected.",
    belongings:
      "Your ship and its cargo will remain at their current location. Your carried belongings will accompany you.",
    warning: "Once your shuttle departs, the journey cannot be cancelled.",
    back: "NOT YET",
    board: (fareCredits: number) => `CONFIRM & BOARD — ${fareCredits} CR`,
  },
  insufficient: {
    title: "INSUFFICIENT FUNDS",
    quote:
      "Unfortunately, your available balance is insufficient. Please come back when you have rectified your financial troubles.",
    fare: (fareCredits: number) => `One-way passage costs ${fareCredits} CR.`,
    back: "RETURN TO CHECK-IN",
  },
  locked: {
    title: "SERVICE NOT YET AVAILABLE",
    quote:
      "Milky Waymo looks forward to serving you! Passenger service becomes available after your first successful interplanetary flight aboard your own ship.",
  },
} as const;
