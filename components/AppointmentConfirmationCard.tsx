"use client";

import {
  CheckCircle2,
  ChevronDown,
  Clock3,
  History,
  Mail,
  MessageSquare,
  RefreshCw,
  Send,
  TriangleAlert
} from "lucide-react";
import { useEffect, useId, useState } from "react";
import { formatDateTime } from "@/lib/date";
import { notificationStatusLabel } from "@/lib/appointment-confirmations";
import type { AppointmentNotificationSummary } from "@/lib/types";
import styles from "./AppointmentConfirmationCard.module.css";

type AppointmentConfirmationCardProps = {
  notifications: AppointmentNotificationSummary[];
  loading: boolean;
  busy: boolean;
  error?: string;
  canManage: boolean;
  activeJob: boolean;
  onRetry: () => void;
  onResend: () => void;
};

type OverallStatus = {
  label: string;
  description: string;
  tone: "neutral" | "info" | "good" | "warn" | "bad";
};

export function AppointmentConfirmationCard({
  notifications,
  loading,
  busy,
  error,
  canManage,
  activeJob,
  onRetry,
  onResend
}: AppointmentConfirmationCardProps) {
  const titleId = useId();
  const orderedNotifications = [...notifications].sort(
    (a, b) => notificationTimestamp(b) - notificationTimestamp(a)
  );
  const latestByChannel = new Map<string, AppointmentNotificationSummary>();

  for (const notification of orderedNotifications) {
    const channel = String(notification.channel);
    if (!latestByChannel.has(channel)) latestByChannel.set(channel, notification);
  }

  const latestNotifications = [...latestByChannel.values()].sort(
    (a, b) => channelOrder(a.channel) - channelOrder(b.channel)
  );
  const overallStatus = getOverallStatus(latestNotifications, loading);
  const hasFailedChannel = latestNotifications.some((notification) => isFailed(notification.status));
  const hasRetryableFailedChannel = latestNotifications.some(
    (notification) => isFailed(notification.status) && !isRetryBlocked(notification)
  );
  const hasUnknownSmsDelivery = latestNotifications.some(
    (notification) => notification.lastErrorCode === "sms_delivery_state_unknown"
  );
  const hasAcceptedChannel = latestNotifications.some((notification) => isAccepted(notification.status));
  const hasPendingChannel = latestNotifications.some((notification) => isPending(notification.status));
  const onlyInactiveChannels = latestNotifications.length > 0 && latestNotifications.every((notification) => {
    const status = statusKey(notification.status);
    return status === "suppressed" || status === "cancelled";
  });
  const canRetry = canManage && activeJob && hasRetryableFailedChannel && !loading && !error;
  const canSendOrResend = canManage
    && activeJob
    && !loading
    && !error
    && !hasRetryableFailedChannel
    && !hasUnknownSmsDelivery
    && !hasPendingChannel
    && (hasFailedChannel || hasAcceptedChannel || onlyInactiveChannels || notifications.length === 0);
  const [expanded, setExpanded] = useState(Boolean(error || hasFailedChannel));
  useEffect(() => {
    if (error || hasFailedChannel) setExpanded(true);
  }, [error, hasFailedChannel]);

  return (
    <section className={styles.card} aria-labelledby={titleId}>
      <details
        className={styles.disclosure}
        open={expanded}
        onToggle={(event) => setExpanded(event.currentTarget.open)}
      >
        <summary className={styles.summary}>
          <span className={styles.icon} aria-hidden="true"><Send size={19} /></span>
          <span className={styles.heading}>
            <strong id={titleId}>Customer confirmation</strong>
            <small>{overallStatus.description}</small>
          </span>
          <span className={styles.status} data-tone={overallStatus.tone} aria-live="polite">
            <OverallStatusIcon tone={overallStatus.tone} />
            {overallStatus.label}
          </span>
          <ChevronDown className={styles.chevron} size={18} aria-hidden="true" />
        </summary>

        <div className={styles.body}>
          {error ? (
            <div className={styles.error} role="alert">
              <TriangleAlert size={19} aria-hidden="true" />
              <span><strong>Confirmation needs attention</strong><small>{error}</small></span>
            </div>
          ) : null}

          {loading ? (
            <div className={styles.loading} role="status">
              <span className={styles.spinner} aria-hidden="true" />
              Checking confirmation status…
            </div>
          ) : latestNotifications.length === 0 ? (
            <div className={styles.empty}>
              <MessageSquare size={20} aria-hidden="true" />
              <span><strong>No confirmation activity yet</strong><small>The appointment does not have a queued or accepted customer confirmation.</small></span>
            </div>
          ) : (
            <div className={styles.channels}>
              {latestNotifications.map((notification) => (
                <article className={styles.channel} data-status={statusKey(notification.status)} key={String(notification.channel)}>
                  <span className={styles.channelIcon} aria-hidden="true">
                    {notification.channel === "email" ? <Mail size={18} /> : <MessageSquare size={18} />}
                  </span>
                  <span className={styles.channelCopy}>
                    <strong>{channelLabel(notification.channel)} · {notification.maskedDestination}</strong>
                    <small>{notificationTimeLabel(notification)}</small>
                    {notification.errorMessage ? <small className={styles.channelError} role="alert">{notification.errorMessage}</small> : null}
                  </span>
                  <span className={styles.channelStatus}>{notificationDisplayStatus(notification)}</span>
                </article>
              ))}
            </div>
          )}

          {canRetry || canSendOrResend ? (
            <div className={styles.actions}>
              {canRetry ? (
                <button className={styles.primaryAction} type="button" onClick={onRetry} disabled={busy}>
                  <RefreshCw size={17} aria-hidden="true" />
                  {busy ? "Retrying…" : "Retry failed confirmation"}
                </button>
              ) : null}
              {canSendOrResend ? (
                <button className={styles.action} type="button" onClick={onResend} disabled={busy}>
                  <Send size={17} aria-hidden="true" />
                  {busy
                    ? "Sending…"
                    : notifications.length === 0
                      ? "Send confirmation"
                      : hasFailedChannel
                        ? "Send a new confirmation"
                        : "Resend confirmation"}
                </button>
              ) : null}
            </div>
          ) : !activeJob && notifications.length > 0 ? (
            <p className={styles.readonly}>This job is closed. Confirmation history is read-only.</p>
          ) : null}

          {orderedNotifications.length > 0 ? (
            <details className={styles.history}>
              <summary><span><History size={17} aria-hidden="true" />Confirmation history</span><small>{orderedNotifications.length} {orderedNotifications.length === 1 ? "event" : "events"}</small></summary>
              <div className={styles.historyList}>
                {orderedNotifications.map((notification, index) => (
                  <article className={styles.historyRow} key={`${notification.id}-${notification.channel}-${index}`}>
                    <span className={styles.historyIcon} aria-hidden="true">
                      {notification.channel === "email" ? <Mail size={16} /> : <MessageSquare size={16} />}
                    </span>
                    <span className={styles.historyCopy}>
                      <strong>{eventTypeLabel(notification.eventType)} · {channelLabel(notification.channel)}</strong>
                      <small>{notification.maskedDestination}</small>
                      {notification.errorMessage ? <small className={styles.channelError}>{notification.errorMessage}</small> : null}
                    </span>
                    <span className={styles.historyMeta}><strong>{notificationDisplayStatus(notification)}</strong><small>{formatDateTime(activityAt(notification))}</small></span>
                  </article>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      </details>
    </section>
  );
}

function OverallStatusIcon({ tone }: { tone: OverallStatus["tone"] }) {
  if (tone === "good") return <CheckCircle2 size={21} aria-hidden="true" />;
  if (tone === "bad" || tone === "warn") return <TriangleAlert size={21} aria-hidden="true" />;
  return <Clock3 size={21} aria-hidden="true" />;
}

function getOverallStatus(latest: AppointmentNotificationSummary[], loading: boolean): OverallStatus {
  if (loading) {
    return { label: "Checking", description: "Loading the latest activity.", tone: "info" };
  }
  if (latest.length === 0) {
    return { label: "Not sent", description: "No customer confirmation is recorded.", tone: "neutral" };
  }

  const acceptedCount = latest.filter((notification) => isAccepted(notification.status)).length;
  const deliveredCount = latest.filter(isDelivered).length;
  const failedCount = latest.filter((notification) => isFailed(notification.status)).length;
  const pendingCount = latest.filter((notification) => isPending(notification.status)).length;
  const suppressedCount = latest.filter((notification) => statusKey(notification.status) === "suppressed").length;

  if (failedCount > 0 && acceptedCount > 0) {
    return { label: "Partially accepted", description: "One channel was accepted; another needs attention.", tone: "warn" };
  }
  if (failedCount > 0) {
    return { label: "Needs attention", description: "The latest confirmation could not be sent.", tone: "bad" };
  }
  if (pendingCount > 0) {
    return { label: "Sending", description: "The latest confirmation is queued or processing.", tone: "info" };
  }
  if (acceptedCount === latest.length) {
    return deliveredCount === latest.length
      ? { label: "Delivered", description: "The latest confirmation reached every enabled channel.", tone: "good" }
      : { label: "Accepted", description: "The delivery provider accepted the latest confirmation.", tone: "good" };
  }
  if (acceptedCount > 0 && acceptedCount + suppressedCount === latest.length) {
    return { label: "Partially accepted", description: "One channel was accepted; another was suppressed.", tone: "warn" };
  }
  if (suppressedCount === latest.length) {
    return { label: "Not sent", description: "The latest confirmation was suppressed.", tone: "warn" };
  }
  return { label: "Status available", description: "Review the latest channel activity below.", tone: "neutral" };
}

function notificationTimeLabel(notification: AppointmentNotificationSummary): string {
  if (isAccepted(notification.status)) {
    const activityTime = isDelivered(notification)
      ? notification.providerStatusAt ?? notification.acceptedAt ?? notification.queuedAt
      : notification.acceptedAt ?? notification.queuedAt;
    return `${isDelivered(notification) ? "Delivered" : "Accepted"} ${formatDateTime(activityTime)}`;
  }
  if (isFailed(notification.status)) {
    return `Failed ${formatDateTime(notification.failedAt ?? notification.queuedAt)}`;
  }
  if (isPending(notification.status)) {
    return `Queued ${formatDateTime(notification.queuedAt)}`;
  }
  return `${notificationStatusLabel(notification.status)} ${formatDateTime(activityAt(notification))}`;
}

function activityAt(notification: AppointmentNotificationSummary): string {
  return notification.providerStatusAt ?? notification.failedAt ?? notification.acceptedAt ?? notification.queuedAt;
}

function notificationDisplayStatus(notification: AppointmentNotificationSummary): string {
  if (isDelivered(notification)) return "Delivered";
  return notificationStatusLabel(notification.status);
}

function isDelivered(notification: AppointmentNotificationSummary): boolean {
  const providerStatus = String(notification.providerStatus ?? "").toLowerCase();
  return isAccepted(notification.status) && (providerStatus === "delivered" || providerStatus === "read");
}

function notificationTimestamp(notification: AppointmentNotificationSummary): number {
  const timestamp = Date.parse(notification.queuedAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function channelOrder(channel: AppointmentNotificationSummary["channel"]): number {
  if (channel === "sms") return 0;
  if (channel === "email") return 1;
  return 2;
}

function channelLabel(channel: AppointmentNotificationSummary["channel"]): string {
  if (channel === "sms") return "Text message";
  if (channel === "email") return "Email";
  return String(channel).replaceAll("_", " ");
}

function eventTypeLabel(eventType: AppointmentNotificationSummary["eventType"]): string {
  if (eventType === "confirmation") return "Confirmation";
  if (eventType === "reschedule") return "Schedule update";
  if (eventType === "cancellation") return "Cancellation";
  if (eventType === "manual_resend") return "Resent confirmation";
  return String(eventType).replaceAll("_", " ");
}

function statusKey(status: AppointmentNotificationSummary["status"]): string {
  return String(status).toLowerCase().replaceAll("_", "-");
}

function isAccepted(status: AppointmentNotificationSummary["status"]): boolean {
  const key = statusKey(status);
  return key === "accepted" || key === "sent";
}

function isFailed(status: AppointmentNotificationSummary["status"]): boolean {
  return statusKey(status) === "failed";
}

function isPending(status: AppointmentNotificationSummary["status"]): boolean {
  const key = statusKey(status);
  return key === "queued" || key === "sending" || key === "processing";
}

function isRetryBlocked(notification: AppointmentNotificationSummary): boolean {
  return notification.lastErrorCode === "sms_delivery_state_unknown"
    || notification.lastErrorCode === "attempt_limit_reached"
    || notification.lastErrorCode === "provider_permanent_failure"
    || notification.lastErrorCode === "sms_recipient_opted_out"
    || notification.lastErrorCode === "twilio_21610";
}
