import type { CustomerSessionState } from "@prisma/client";
import type { CustomerChoice } from "./choice";

export type StateMachineAction =
  | "SEND_GREETING"
  | "SEND_ORDER_FORM"
  | "SEND_REMINDER"
  | "SEND_PAUSE_NOTICE_AND_ALERT_OWNER"
  | "PROCESS_ORDER"
  | "STAY_SILENT";

export interface TransitionInput {
  state: CustomerSessionState;
  text?: string;
  hasOrderForm: boolean;
  choice: CustomerChoice;
  retryCount: number;
  pausedExpired: boolean;
}

export interface TransitionResult {
  nextState: CustomerSessionState;
  action: StateMachineAction;
  nextRetryCount: number;
}

/**
 * Pure state machine transition function (Section 8).
 */
export function transition(input: TransitionInput): TransitionResult {
  let effectiveState = input.state;
  if (effectiveState === "PAUSED_FOR_OWNER" && input.pausedExpired) {
    effectiveState = "ACTIVE";
  }

  const retry = input.retryCount || 0;

  switch (effectiveState) {
    case "INIT": {
      if (input.hasOrderForm) {
        return {
          nextState: "AWAITING_ORDER",
          action: "PROCESS_ORDER",
          nextRetryCount: 0,
        };
      }
      return {
        nextState: "AWAITING_CHOICE",
        action: "SEND_GREETING",
        nextRetryCount: 0,
      };
    }

    case "AWAITING_CHOICE": {
      if (input.hasOrderForm) {
        return {
          nextState: "AWAITING_ORDER",
          action: "PROCESS_ORDER",
          nextRetryCount: 0,
        };
      }
      if (input.choice === "ORDER") {
        return {
          nextState: "AWAITING_ORDER",
          action: "SEND_ORDER_FORM",
          nextRetryCount: 0,
        };
      }
      if (input.choice === "ASK") {
        return {
          nextState: "PAUSED_FOR_OWNER",
          action: "SEND_PAUSE_NOTICE_AND_ALERT_OWNER",
          nextRetryCount: 0,
        };
      }
      // choice === 'UNKNOWN'
      if (retry < 3) {
        return {
          nextState: "AWAITING_CHOICE",
          action: "SEND_REMINDER",
          nextRetryCount: retry + 1,
        };
      }
      // retry >= 3: treat as ASK
      return {
        nextState: "PAUSED_FOR_OWNER",
        action: "SEND_PAUSE_NOTICE_AND_ALERT_OWNER",
        nextRetryCount: 0,
      };
    }

    case "AWAITING_ORDER": {
      if (input.hasOrderForm) {
        return {
          nextState: "AWAITING_ORDER",
          action: "PROCESS_ORDER",
          nextRetryCount: 0,
        };
      }
      if (input.choice === "ASK") {
        return {
          nextState: "PAUSED_FOR_OWNER",
          action: "SEND_PAUSE_NOTICE_AND_ALERT_OWNER",
          nextRetryCount: 0,
        };
      }
      if (retry < 3) {
        return {
          nextState: "AWAITING_ORDER",
          action: "SEND_ORDER_FORM",
          nextRetryCount: retry + 1,
        };
      }
      // retry >= 3: treat as ASK
      return {
        nextState: "PAUSED_FOR_OWNER",
        action: "SEND_PAUSE_NOTICE_AND_ALERT_OWNER",
        nextRetryCount: 0,
      };
    }

    case "PAUSED_FOR_OWNER": {
      // not expired
      if (input.hasOrderForm) {
        return {
          nextState: "AWAITING_ORDER",
          action: "PROCESS_ORDER",
          nextRetryCount: 0,
        };
      }
      return {
        nextState: "PAUSED_FOR_OWNER",
        action: "STAY_SILENT",
        nextRetryCount: retry,
      };
    }

    case "ACTIVE": {
      if (input.hasOrderForm) {
        return {
          nextState: "AWAITING_ORDER",
          action: "PROCESS_ORDER",
          nextRetryCount: 0,
        };
      }
      return {
        nextState: "AWAITING_CHOICE",
        action: "SEND_GREETING",
        nextRetryCount: 0,
      };
    }

    default: {
      return {
        nextState: "AWAITING_CHOICE",
        action: "SEND_GREETING",
        nextRetryCount: 0,
      };
    }
  }
}
