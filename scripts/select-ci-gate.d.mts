export interface PullRequestGateEvent {
  action?: string;
  label?: { name?: string };
  pull_request?: {
    draft?: boolean;
    labels?: Array<{ name?: string }>;
  };
}

export function shouldRunFullGate(input: {
  eventName: string;
  event: PullRequestGateEvent;
}): boolean;

export function shouldRequireMergeGate(input: {
  eventName: string;
  event: PullRequestGateEvent;
}): boolean;

export function shouldRunScreenshotLane(input: {
  eventName: string;
  event: PullRequestGateEvent;
}): boolean;
