import {
  getTransactionalEmailProviderConfiguration,
  getTransactionalSmsProviderConfiguration,
  parseTransactionalEmailAddress,
  sendTransactionalEmail,
  sendTransactionalSms,
  TransactionalProviderError,
  type ProviderEnvironment,
  type ProviderFetch,
  type TransactionalProviderName,
  type TransactionalProviderResult
} from "@/lib/transactional-providers";

if (typeof window !== "undefined" && process.env.NODE_ENV !== "test") {
  throw new Error("Appointment provider credentials can only be used by server modules.");
}

const TWILIO_WEBHOOK_RETRY_OVERRIDES = "#rc=3&rp=all&ct=2000&rt=5000&tt=15000";

export type AppointmentProviderName = TransactionalProviderName;

export type AppointmentProviderConfiguration = {
  email: {
    configured: boolean;
    provider: "resend" | "sendgrid" | null;
    missing: string[];
  };
  sms: {
    configured: boolean;
    provider: "twilio" | null;
    credentialMode: "api_key" | "auth_token" | null;
    missing: string[];
  };
};

export type AppointmentProviderResult = TransactionalProviderResult;
export { TransactionalProviderError as AppointmentProviderError };

export function getAppointmentProviderConfiguration(
  env: ProviderEnvironment = process.env
): AppointmentProviderConfiguration {
  const emailProvider = getTransactionalEmailProviderConfiguration(env);
  const fromEmail = appointmentFromEmail(env);
  const emailMissing = [
    ...emailProvider.missing,
    !parseTransactionalEmailAddress(fromEmail)
      ? "APPOINTMENT_FROM_EMAIL or TRANSACTIONAL_FROM_EMAIL"
      : undefined
  ].filter((name): name is string => Boolean(name));
  const smsProvider = getTransactionalSmsProviderConfiguration(env);

  return {
    email: {
      configured: emailProvider.configured && emailMissing.length === 0,
      provider: emailProvider.provider,
      missing: emailMissing
    },
    sms: {
      configured: smsProvider.configured,
      provider: smsProvider.provider,
      credentialMode: smsProvider.credentialMode,
      missing: smsProvider.missing
    }
  };
}

export async function sendAppointmentEmail(
  input: {
    to: string;
    subject: string;
    text: string;
    html: string;
    idempotencyKey: string;
  },
  options: {
    env?: ProviderEnvironment;
    fetchImpl?: ProviderFetch;
    timeoutMs?: number;
  } = {}
): Promise<AppointmentProviderResult> {
  const env = options.env ?? process.env;
  const configuration = getAppointmentProviderConfiguration(env);
  const provider = configuration.email.provider ?? "sendgrid";
  if (!configuration.email.configured) {
    throw new TransactionalProviderError({
      provider,
      message: "Email delivery is not configured.",
      code: "not_configured"
    });
  }

  return sendTransactionalEmail({
    from: appointmentFromEmail(env),
    ...input
  }, options);
}

export async function sendAppointmentSms(
  input: {
    to: string;
    body: string;
  },
  options: {
    env?: ProviderEnvironment;
    fetchImpl?: ProviderFetch;
    timeoutMs?: number;
  } = {}
): Promise<AppointmentProviderResult> {
  const env = options.env ?? process.env;
  const configuration = getAppointmentProviderConfiguration(env);
  if (!configuration.sms.configured) {
    throw new TransactionalProviderError({
      provider: "twilio",
      message: "SMS delivery is not configured.",
      code: "not_configured"
    });
  }

  return sendTransactionalSms({
    ...input,
    statusCallback: `${readEnv(env, "TWILIO_WEBHOOK_PUBLIC_URL")}${TWILIO_WEBHOOK_RETRY_OVERRIDES}`
  }, options);
}

function appointmentFromEmail(env: ProviderEnvironment): string {
  return readEnv(env, "APPOINTMENT_FROM_EMAIL")
    || readEnv(env, "TRANSACTIONAL_FROM_EMAIL")
    || readEnv(env, "INVOICE_FROM_EMAIL");
}

function readEnv(env: ProviderEnvironment, name: string): string {
  return String(env[name] ?? "").trim();
}
