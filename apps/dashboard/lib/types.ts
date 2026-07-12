export interface Store {
  id: string;
  organization_id: string;
  name: string;
  live_mode: boolean;
  created_at: string;
  branding: {
    display_name: string | null;
    logo_url: string | null;
    primary_color: string;
    support_email: string | null;
    success_url: string | null;
    failure_url: string | null;
    custom_message: string | null;
  } | null;
}

export interface Me {
  id: string;
  email: string;
  name: string | null;
  is_platform_admin?: boolean;
  organizations: { id: string; name: string; role: string }[];
}

export interface ApiKey {
  id: string;
  store_id: string;
  mode: string;
  label: string | null;
  display_prefix: string;
  last4: string;
  scopes: string[];
  last_used_at: string | null;
  revoked: boolean;
  created_at: string;
  secret?: string;
}

export interface Payment {
  id: string;
  status: string;
  mode: string;
  amount: string;
  currency: string;
  reference_id: string | null;
  description: string | null;
  created_at: string;
  paid_at: string | null;
}

export interface WebhookEndpoint {
  id: string;
  store_id: string;
  url: string;
  enabled_events: string[];
  disabled: boolean;
  created_at: string;
  signing_secret?: string;
}

export interface WebhookDelivery {
  id: string;
  event_id: string;
  event_type: string | null;
  status: string;
  attempt: number;
  response_status: number | null;
  error: string | null;
  next_attempt_at: string | null;
  created_at: string;
}

export const WEBHOOK_EVENT_TYPES = [
  'payment.created',
  'payment.scanned',
  'payment.completed',
  'payment.expired',
  'payment.failed',
  'payment.cancelled',
];

export interface Overview {
  total_payments: number;
  paid_count: number;
  paid_volume: string;
  pending_count: number;
  failed_count: number;
  expired_count: number;
  success_rate: number;
  month_paid_count: number;
  recent_webhook_failures: number;
}
