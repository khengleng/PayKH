export type PaymentStatus =
  | 'pending'
  | 'scanned'
  | 'paid'
  | 'expired'
  | 'failed'
  | 'cancelled';

export interface CheckoutView {
  id: string;
  status: PaymentStatus;
  amount: string;
  currency: 'USD' | 'KHR';
  reference_id: string | null;
  description: string | null;
  qr_string: string;
  created_at: string;
  expires_at: string;
  paid_at: string | null;
  payee: {
    name: string | null;
    account_id: string;
    bank_code: string | null;
    bank_name: string | null;
    account_type: 'merchant' | 'individual';
  } | null;
  merchant: {
    name: string;
    logo_url: string | null;
    primary_color: string;
    support_email: string | null;
    custom_message: string | null;
    success_url: string | null;
    failure_url: string | null;
  };
}

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

export const TERMINAL: PaymentStatus[] = ['paid', 'expired', 'failed', 'cancelled'];
